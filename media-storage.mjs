// Private media storage for Sócio products. The frontend never receives S3
// credentials or a public object URL. Test-only in-memory driver is isolated.
import {randomUUID} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const storedTest=new Map();
let cachedS3;
const hex=x=>x.toString('hex');
export function mediaConfigured(env=process.env){
 return env.NODE_ENV==='test'&&env.SOCIO_STORAGE_DRIVER==='memory' ||
  Boolean(env.SOCIO_S3_ENDPOINT&&env.SOCIO_S3_BUCKET&&env.SOCIO_S3_ACCESS_KEY&&env.SOCIO_S3_SECRET_KEY&&env.SOCIO_S3_REGION);
}
function useMemory(env=process.env){return env.NODE_ENV==='test'&&env.SOCIO_STORAGE_DRIVER==='memory';}
async function s3(env=process.env){
 if(!mediaConfigured(env))throw fail(503,'Armazenamento de imagens ainda não configurado.');
 if(!cachedS3){
  const lib=await import('@aws-sdk/client-s3');
  const client=new lib.S3Client({endpoint:env.SOCIO_S3_ENDPOINT,region:env.SOCIO_S3_REGION,
   credentials:{accessKeyId:env.SOCIO_S3_ACCESS_KEY,secretAccessKey:env.SOCIO_S3_SECRET_KEY},
   forcePathStyle:false,maxAttempts:2});
  cachedS3={client,lib};
 }
 return cachedS3;
}
export function imageKey(tenantId,productId){
 if(!/^[a-f0-9-]{36}$/.test(tenantId)||!/^[a-f0-9-]{36}$/.test(productId))throw fail(422,'Identificador de produto inválido.');
 return tenantId+'/'+productId+'/'+randomUUID()+'.jpg';
}
export async function normalizeImage(base64){
 if(typeof base64!=='string'||base64.length>4200000||base64.length<64||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
  throw fail(422,'Imagem inválida ou muito grande. Limite de 3 MB.');
 const raw=Buffer.from(base64,'base64');
 if(raw.length>3000000||raw.length<40)throw fail(422,'Imagem inválida ou muito grande.');
 let output;
 try{
  const sharp=(await import('sharp')).default;
  const img=sharp(raw,{limitInputPixels:18000000,failOn:'warning',animated:false});
  const info=await img.metadata();
  if(!['jpeg','png','webp'].includes(info.format))throw new Error('unsupported');
  if(!info.width||!info.height||info.width<20||info.height<20)throw new Error('too-small');
  output=await img.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true})
   .flatten({background:'#ffffff'}).jpeg({quality:84,mozjpeg:true}).toBuffer();
 }catch{throw fail(422,'Imagem não reconhecida. Envie JPG, PNG ou WebP de pelo menos 20×20 pixels.');}
 if(output.length>2200000)throw fail(422,'Imagem resultante muito grande; tente um arquivo menor.');
 return {bytes:output,contentType:'image/jpeg'};
}
export async function putPrivateImage(key,bytes,env=process.env){
 if(!key||!Buffer.isBuffer(bytes))throw fail(422,'Arquivo inválido.');
 if(useMemory(env)){storedTest.set(key,Buffer.from(bytes));return;}
 const {client,lib}=await s3(env);
 await client.send(new lib.PutObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key,Body:bytes,
  ContentType:'image/jpeg',CacheControl:'private, no-store'}));
}
export async function getPrivateImage(key,env=process.env){
 if(useMemory(env)){
  const bytes=storedTest.get(key);
  if(!bytes)throw fail(404,'Imagem não encontrada.');
  return bytes;
 }
 const {client,lib}=await s3(env);
 try{
  const result=await client.send(new lib.GetObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key}));
  return Buffer.from(await result.Body.transformToByteArray());
 }catch(error){
  if(error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404)throw fail(404,'Imagem não encontrada.');
  throw fail(503,'Não foi possível recuperar a imagem.');
 }
}
export async function deletePrivateImage(key,env=process.env){
 if(useMemory(env)){storedTest.delete(key);return;}
 const {client,lib}=await s3(env);
 await client.send(new lib.DeleteObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key}));
}
export async function checkMediaStorage(env=process.env){
 if(!mediaConfigured(env))return {configured:false,reachable:false,readWrite:false};
 if(useMemory(env))return {configured:true,reachable:true,readWrite:true};
 const {client,lib}=await s3(env),key='health/'+randomUUID()+'.jpg';
 try{
  await client.send(new lib.HeadBucketCommand({Bucket:env.SOCIO_S3_BUCKET}));
  const probe=Buffer.from('ffd8ffd9','hex');
  try{
   await client.send(new lib.PutObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key,Body:probe,ContentType:'image/jpeg'}));
   const got=await client.send(new lib.GetObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key}));
   const bytes=Buffer.from(await got.Body.transformToByteArray());
   return {configured:true,reachable:true,readWrite:bytes.equals(probe)};
  }finally{
   try{await client.send(new lib.DeleteObjectCommand({Bucket:env.SOCIO_S3_BUCKET,Key:key}));}catch{}
  }
 }catch{return {configured:true,reachable:false,readWrite:false};}
}
