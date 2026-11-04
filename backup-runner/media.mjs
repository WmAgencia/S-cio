// Sócio private product-media disaster snapshot.
// Read original private Railway S3 objects, encrypt independently per object,
// upload to a different private Railway bucket, read back, decrypt and verify.
// Never log content, tenant IDs, object names or credentials.
import {randomBytes,scryptSync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';

const env=(k)=>{const value=process.env[k];if(!value)throw new Error('Missing configuration: '+k);return value;};
const pass=env('SOCIO_BACKUP_PASSPHRASE');
if(pass.length<40)throw new Error('Backup passphrase must have 40+ characters');
const endpoint=env('SOCIO_MEDIA_S3_ENDPOINT'),destEndpoint=env('SOCIO_BACKUP_S3_ENDPOINT');
if(!endpoint.startsWith('https://')||!destEndpoint.startsWith('https://'))throw new Error('S3 must use HTTPS');
const fromBucket=env('SOCIO_MEDIA_S3_BUCKET'),toBucket=env('SOCIO_BACKUP_S3_BUCKET');
if(fromBucket===toBucket&&endpoint===destEndpoint)throw new Error('Backup must be in an independent bucket');
const client=(endpoint,region,accessKeyId,secretAccessKey)=>
 new S3Client({endpoint,region,forcePathStyle:false,maxAttempts:2,credentials:{accessKeyId,secretAccessKey}});
const source=client(endpoint,env('SOCIO_MEDIA_S3_REGION'),env('SOCIO_MEDIA_S3_ACCESS_KEY'),env('SOCIO_MEDIA_S3_SECRET_KEY'));
const backup=client(destEndpoint,env('SOCIO_BACKUP_S3_REGION'),env('SOCIO_BACKUP_S3_ACCESS_KEY'),env('SOCIO_BACKUP_S3_SECRET_KEY'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(5).toString('hex');
const productKey=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i;
const maxFiles=10000,maxBytes=1073741824,maxObject=5242880;

let phase='start';
async function main(){
 const list=[];let continuation,files=0,bytes=0,ignored=0;
 do{
  phase='list-source';
  const page=await source.send(new ListObjectsV2Command({Bucket:fromBucket,ContinuationToken:continuation,MaxKeys:500}));
  for(const item of page.Contents||[]){
   const key=item.Key||'';
   if(key.startsWith('health/'))continue;
   if(!productKey.test(key))throw new Error('Unexpected object outside the private product-media namespace');
   if(item.Size<1||item.Size>maxObject)throw new Error('Product-media object exceeds safe size');
   if(++files>maxFiles||(bytes+=item.Size)>maxBytes)throw new Error('Snapshot exceeded safe file/byte limits');
   list.push({key,size:item.Size});
  }
  continuation=page.IsTruncated?page.NextContinuationToken:undefined;
  if(page.IsTruncated&&!continuation)throw new Error('Incomplete source bucket listing');
 }while(continuation);
 const snapshots=[];
 for(const item of list){
  phase='download-source';
  const rawSource=await source.send(new GetObjectCommand({Bucket:fromBucket,Key:item.key}));
  const plain=Buffer.from(await rawSource.Body.transformToByteArray());
  if(plain.length!==item.size)throw new Error('Source media changed during snapshot');
  const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(pass,salt,32);
  const enc=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([enc.update(plain),enc.final()]);
  const targetKey='media/'+runId+'/'+item.key+'.enc';
  phase='upload-encrypted';
  await backup.send(new PutObjectCommand({Bucket:toBucket,Key:targetKey,
   Body:ciphertext,ContentLength:ciphertext.length,ContentType:'application/octet-stream'}));
  const meta={sourceKey:item.key,archiveKey:targetKey,bytes:item.size,
   ciphertextSha256:hash(ciphertext),plaintextSha256:hash(plain),
   salt:salt.toString('hex'),iv:iv.toString('hex'),tag:enc.getAuthTag().toString('hex')};
  phase='verify-remote';
  const head=await backup.send(new HeadObjectCommand({Bucket:toBucket,Key:targetKey}));
  if(Number(head.ContentLength)!==ciphertext.length)throw new Error('Remote media length mismatch');
  const remote=await backup.send(new GetObjectCommand({Bucket:toBucket,Key:targetKey}));
  const remoteEncrypted=Buffer.from(await remote.Body.transformToByteArray());
  if(hash(remoteEncrypted)!==meta.ciphertextSha256)throw new Error('Remote media hash mismatch');
  const dec=createDecipheriv('aes-256-gcm',key,iv);
  dec.setAuthTag(enc.getAuthTag());
  const decrypted=Buffer.concat([dec.update(remoteEncrypted),dec.final()]);
  if(hash(decrypted)!==meta.plaintextSha256)throw new Error('Decrypted media differs from source');
  snapshots.push(meta);
 }
 phase='manifest';
 const manifest={format:'socio-product-media-backup-v1',createdAt:new Date().toISOString(),
  completed:true,sourceBucket:fromBucket,targetBucket:toBucket,
  files:snapshots.length,bytes,contents:snapshots};
 const payload=Buffer.from(JSON.stringify(manifest));
 if(payload.length>10*1024*1024)throw new Error('Manifest exceeds 10MB');
 const manifestKey='media/manifests/'+runId+'.json';
 await backup.send(new PutObjectCommand({Bucket:toBucket,Key:manifestKey,
  Body:payload,ContentLength:payload.length,ContentType:'application/json'}));
 phase='verify-manifest';
 const check=await backup.send(new GetObjectCommand({Bucket:toBucket,Key:manifestKey}));
 if(hash(Buffer.from(await check.Body.transformToByteArray()))!==hash(payload))
  throw new Error('Media manifest read-back failed');
 console.log(JSON.stringify({ok:true,scope:'media',verified:true,files:snapshots.length,bytes,
  manifest:manifestKey}));
}
main().catch(e=>{
 console.error(JSON.stringify({ok:false,code:'MEDIA_BACKUP_FAILED',phase,
  reason:String(e?.code||e?.name||'unknown').slice(0,70)}));
 process.exitCode=1;
}).finally(()=>{source.destroy();backup.destroy();});
