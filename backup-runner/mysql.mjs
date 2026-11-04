// WA-AKG MySQL logical backup: a separate private encrypted archive.
// MySQL credentials never appear in args/logs; plain SQL is not saved to disk.
import {spawn} from 'node:child_process';
import {randomBytes,createHash,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {createGzip,createGunzip} from 'node:zlib';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,
 CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand}
 from '@aws-sdk/client-s3';

const required=k=>{if(!process.env[k])throw new Error('Missing '+k);return process.env[k];};
const pass=required('SOCIO_BACKUP_PASSPHRASE');
if(pass.length<40)throw new Error('Backup passphrase too short');
const mysql=new URL(required('SOCIO_MYSQL_SOURCE_URL'));
if(mysql.protocol!=='mysql:'||!mysql.hostname||!mysql.pathname.slice(1))throw new Error('Invalid source MySQL URL');
const endpoint=required('SOCIO_BACKUP_S3_ENDPOINT');
if(!endpoint.startsWith('https://'))throw new Error('Remote backup must use HTTPS');
const bucket=required('SOCIO_BACKUP_S3_BUCKET');
const s3=new S3Client({endpoint,region:required('SOCIO_BACKUP_S3_REGION'),
 forcePathStyle:false,maxAttempts:2,credentials:{
  accessKeyId:required('SOCIO_BACKUP_S3_ACCESS_KEY'),
  secretAccessKey:required('SOCIO_BACKUP_S3_SECRET_KEY')}});
const keyFor=(salt)=>scryptSync(pass,Buffer.from(salt,'hex'),32);
const digest=async file=>{
 const h=createHash('sha256');
 await pipeline(createReadStream(file),new Writable({write(x,enc,next){h.update(x);next();}}));
 return h.digest('hex');
};
const stageSafe=code=>String(code||'BACKUP_FAILED').slice(0,70);
let stage='start';
async function upload(path,key,bytes){
 if(bytes<=5*1024*1024){
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:await readFile(path),
   ContentLength:bytes,ContentType:'application/octet-stream'}));return;
 }
 const multi=await s3.send(new CreateMultipartUploadCommand({Bucket:bucket,Key:key,
  ContentType:'application/octet-stream'}));
 if(!multi.UploadId)throw new Error('S3 multipart upload id missing');
 const parts=[];let partNo=0;
 try{
  for await(const chunk of createReadStream(path,{highWaterMark:6*1024*1024})){
   const part=await s3.send(new UploadPartCommand({Bucket:bucket,Key:key,
    UploadId:multi.UploadId,PartNumber:++partNo,Body:chunk,ContentLength:chunk.length}));
   if(!part.ETag)throw new Error('S3 part ETag missing');
   parts.push({PartNumber:partNo,ETag:part.ETag});
  }
  await s3.send(new CompleteMultipartUploadCommand({Bucket:bucket,Key:key,
   UploadId:multi.UploadId,MultipartUpload:{Parts:parts}}));
 }catch(err){
  await s3.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:multi.UploadId})).catch(()=>{});
  throw err;
 }
}
async function verify(file,meta){
 const d=createDecipheriv('aes-256-gcm',keyFor(meta.salt),Buffer.from(meta.iv,'hex'));
 d.setAuthTag(Buffer.from(meta.tag,'hex'));
 let count=0;
 await pipeline(createReadStream(file),d,createGunzip(),new Writable({
  write(chunk,enc,next){count+=chunk.length;next();}
 }));
 if(count<50)throw new Error('MySQL dump is unexpectedly small');
}
async function main(){
 const tmp=await mkdtemp(join(tmpdir(),'socio-mysql-')),local=join(tmp,'mysql.enc'),
  remote=join(tmp,'roundtrip.enc');
 const salt=randomBytes(16).toString('hex'),iv=randomBytes(12).toString('hex'),
  cipher=createCipheriv('aes-256-gcm',keyFor(salt),Buffer.from(iv,'hex'));
 const date=new Date().toISOString(),key='mysql/'+date.slice(0,10)+'/socio-'+
  date.replace(/[:.]/g,'-')+'-'+randomBytes(5).toString('hex')+'.sql.gz.enc';
 const database=decodeURIComponent(mysql.pathname.slice(1));
 const args=['--host='+mysql.hostname,'--port='+(mysql.port||'3306'),
  '--user='+decodeURIComponent(mysql.username),'--single-transaction','--quick',
  '--skip-lock-tables','--hex-blob','--default-character-set=utf8mb4','--databases',database];
 let proc;
 try{
  const env={...process.env,MYSQL_PWD:decodeURIComponent(mysql.password)};
  stage='mysqldump';
  proc=spawn('mariadb-dump',args,{env,stdio:['ignore','pipe','pipe']});
  let errorTail='';proc.stderr.on('data',x=>{errorTail+=x.toString();errorTail=errorTail.slice(-300)});
  const done=new Promise((resolve,reject)=>{
   proc.once('error',reject);
   proc.once('close',code=>code===0?resolve():reject(new Error('MariaDB dump command failed with code '+code)));
  });
  const limit=1073741824;let uncompressed=0;
  const bounded=new Writable({write(x,enc,next){uncompressed+=x.length;next();}});
  // Keep SQL streaming: zip first, encrypt second, ciphertext only on disk.
  // The gzip stream receives raw SQL; large backups never fit in a JS Buffer.
  const {Transform}=await import('node:stream');
  const meter=new Transform({transform(x,enc,next){
   uncompressed+=x.length;
   next(uncompressed>limit?new Error('MySQL dump exceeds configured limit'):null,x);
  }});
  try{await Promise.all([pipeline(proc.stdout,meter,createGzip({level:6}),cipher,
   createWriteStream(local,{flags:'wx',mode:0o600})),done]);}
  catch(err){proc.kill('SIGTERM');throw err;}
  stage='verify-local';
  const size=(await stat(local)).size;
  const meta={format:'socio-disaster-v1',scope:'mysql',algorithm:'aes-256-gcm',
   createdAt:date,salt,iv,tag:cipher.getAuthTag().toString('hex'),
   bytes:size,sha256:await digest(local),compressed:'gzip',
   uncompressedBytes:uncompressed};
  await verify(local,meta);
  stage='upload';
  await upload(local,key,size);
  const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
  if(Number(head.ContentLength)!==size)throw new Error('Remote MySQL backup size mismatch');
  stage='verify-remote';
  const result=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
  await pipeline(result.Body,createWriteStream(remote,{flags:'wx',mode:0o600}));
  if((await digest(remote))!==meta.sha256)throw new Error('Remote MySQL backup hash mismatch');
  await verify(remote,meta);
  stage='manifest';
  const manifest=Buffer.from(JSON.stringify({...meta,archiveKey:key,verifiedRemote:true})+'\n');
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key+'.json',
   Body:manifest,ContentLength:manifest.length,ContentType:'application/json'}));
  console.log(JSON.stringify({ok:true,scope:'mysql',encrypted:true,remoteVerified:true,
   bytes:size,uncompressedBytes:uncompressed,objectKey:key}));
 }finally{
  if(proc?.exitCode===null)proc.kill('SIGTERM');
  await rm(tmp,{recursive:true,force:true}).catch(()=>{});
  s3.destroy();
 }
}
main().catch(e=>{
 console.error(JSON.stringify({ok:false,code:'MYSQL_BACKUP_FAILED',stage,
  reason:stageSafe(e?.code||e?.name||'unknown')}));
 process.exitCode=1;
});
