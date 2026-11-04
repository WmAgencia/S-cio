// Sócio — independent encrypted database backup job. One run, one immutable object.
// PostgreSQL 18 custom dump is encrypted before disk and independently verified
// from the remote S3 bucket. No raw SQL or unencrypted dumps leave the process.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createCipheriv,createDecipheriv,scryptSync,createHash} from 'node:crypto';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform,Writable} from 'node:stream';
import {Client} from 'pg';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,CreateMultipartUploadCommand,UploadPartCommand,CompleteMultipartUploadCommand,AbortMultipartUploadCommand} from '@aws-sdk/client-s3';

const execFileAsync=promisify(execFile);
let stage='initialize';
console.info('[socio-backup] starting encrypted PostgreSQL 18 snapshot');
const need=(v,label)=>{if(!v)throw new Error('Configuration missing: '+label);return v;};
const database=need(process.env.SOCIO_BACKUP_SOURCE_DATABASE_URL,'SOCIO_BACKUP_SOURCE_DATABASE_URL');
if(database.includes('${{'))throw new Error('Railway source database reference was not resolved');
const secret=need(process.env.SOCIO_BACKUP_PASSPHRASE,'SOCIO_BACKUP_PASSPHRASE');
const bucket=need(process.env.SOCIO_BACKUP_S3_BUCKET,'SOCIO_BACKUP_S3_BUCKET');
if(secret.length<40)throw new Error('Backup passphrase must have 40+ characters');
const endpoint=need(process.env.SOCIO_BACKUP_S3_ENDPOINT,'SOCIO_BACKUP_S3_ENDPOINT');
const region=need(process.env.SOCIO_BACKUP_S3_REGION,'SOCIO_BACKUP_S3_REGION');
const accessKeyId=need(process.env.SOCIO_BACKUP_S3_ACCESS_KEY,'SOCIO_BACKUP_S3_ACCESS_KEY');
const secretAccessKey=need(process.env.SOCIO_BACKUP_S3_SECRET_KEY,'SOCIO_BACKUP_S3_SECRET_KEY');
if(!endpoint.startsWith('https://'))throw new Error('Backup bucket must have HTTPS endpoint');
const url=new URL(database);
if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname.slice(1))
 throw new Error('Invalid source database URL');
if(url.hostname.endsWith('.supabase.co')||url.hostname.endsWith('.pooler.supabase.com'))
 throw new Error('Backup worker is tied to Railway source; refusing Supabase destination');
const s3=new S3Client({endpoint,region,forcePathStyle:false,credentials:{accessKeyId,secretAccessKey},maxAttempts:2});
const pgEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',
 PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),
 PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:'12',
 PGSSLMODE:url.searchParams.get('sslmode')||'prefer'};
function start(name,args,env,stdin='ignore'){
 const proc=spawn(name,args,{env,stdio:[stdin,'pipe','pipe']});
 let stderr='';
 proc.stderr.on('data',x=>{stderr+=x.toString();stderr=stderr.slice(-300)});
 const done=new Promise((resolve,reject)=>{
  proc.once('error',reject);
  proc.once('close',code=>code===0?resolve():reject(new Error(name+' exited with code '+code)));
 });
 return {proc,done};
}
function encryptionKey(salt){return scryptSync(secret,Buffer.from(salt,'hex'),32);}
async function sha256(path){
 const h=createHash('sha256');
 await pipeline(createReadStream(path),new Writable({write(chunk,encoding,done){h.update(chunk);done();}}));
 return h.digest('hex');
}
async function authenticateFile(path,meta){
 const d=createDecipheriv('aes-256-gcm',encryptionKey(meta.salt),Buffer.from(meta.iv,'hex'));
 d.setAuthTag(Buffer.from(meta.tag,'hex'));
 await pipeline(createReadStream(path),d,new Writable({write(chunk,encoding,done){done();}}));
}
async function uploadEncrypted(path,key,size){
 // Buffer upload for small archives, multipart for larger archives.
 // Never send plaintext or hold the whole database in memory.
 if(size<=5*1024*1024){
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,
   Body:await readFile(path),ContentLength:size,ContentType:'application/octet-stream'}));
  return;
 }
 const created=await s3.send(new CreateMultipartUploadCommand({
  Bucket:bucket,Key:key,ContentType:'application/octet-stream'}));
 if(!created.UploadId)throw new Error('Multipart upload did not return an id');
 const parts=[];let n=0;
 try{
  for await(const bytes of createReadStream(path,{highWaterMark:6*1024*1024})){
   const part=await s3.send(new UploadPartCommand({
    Bucket:bucket,Key:key,UploadId:created.UploadId,PartNumber:++n,
    Body:bytes,ContentLength:bytes.length}));
   if(!part.ETag)throw new Error('Multipart S3 upload missing part ETag');
   parts.push({PartNumber:n,ETag:part.ETag});
  }
  await s3.send(new CompleteMultipartUploadCommand({
   Bucket:bucket,Key:key,UploadId:created.UploadId,MultipartUpload:{Parts:parts}}));
 }catch(error){
  await s3.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:key,UploadId:created.UploadId})).catch(()=>{});
  throw error;
 }
}

async function archiveList(path,meta){
 const d=createDecipheriv('aes-256-gcm',encryptionKey(meta.salt),Buffer.from(meta.iv,'hex'));
 d.setAuthTag(Buffer.from(meta.tag,'hex'));
 const job=start('pg_restore',['--list'],pgEnv,'pipe');
 job.proc.stdout.resume();
 try{await Promise.all([pipeline(createReadStream(path),d,job.proc.stdin),job.done]);}
 catch(error){job.proc.kill('SIGTERM');throw error;}
}
async function main(){
 stage='database-connect';
 const db=new Client({connectionString:database,connectionTimeoutMillis:12000});
 await db.connect();
 try{
  stage='database-version';
  const version=await db.query('SHOW server_version_num');
  const major=Math.floor(Number(version.rows[0].server_version_num)/10000);
  const {stdout}=await execFileAsync('pg_dump',['--version']);
  const dumpMajor=Number(stdout.match(/PostgreSQL\)\s+(\d+)/)?.[1]);
  if(major!==18||dumpMajor!==18)throw new Error('Postgres backup client/server must be v18');
 }finally{await db.end();}
 stage='temp-directory';
 const folder=await mkdtemp(join(tmpdir(),'socio-dr-')),encrypted=join(folder,'archive.enc'),downloaded=join(folder,'roundtrip.enc');
 const createdAt=new Date().toISOString(),salt=randomBytes(16).toString('hex'),
  iv=randomBytes(12).toString('hex'),suffix=randomBytes(7).toString('hex');
 const cipher=createCipheriv('aes-256-gcm',encryptionKey(salt),Buffer.from(iv,'hex'));
 const maxBytes=Number(process.env.SOCIO_BACKUP_MAX_PLAINTEXT_BYTES||1073741824);
 if(!Number.isFinite(maxBytes)||maxBytes<1048576||maxBytes>10737418240)
  throw new Error('Invalid maximum backup size');
 const limit=new Transform({transform(chunk,enc,next){
  this.bytes=(this.bytes||0)+chunk.length;
  next(this.bytes>maxBytes?new Error('Database dump exceeded configured size limit'):null,chunk);
 }});
 const objectKey='postgres/'+createdAt.slice(0,10)+'/socio-'+createdAt.replace(/[:.]/g,'-')+'-'+suffix+'.dump.enc';
 let job;
 try{
  stage='pg-dump';
  job=start('pg_dump',['--format=custom','--no-owner','--no-privileges','--compress=6'],pgEnv);
  try{await Promise.all([
   pipeline(job.proc.stdout,limit,cipher,createWriteStream(encrypted,{flags:'wx',mode:0o600})),
   job.done
  ]);}
  catch(error){job.proc.kill('SIGTERM');throw error;}
  stage='local-verification';
  const bytes=(await stat(encrypted)).size;
  const meta={format:'socio-disaster-v1',scope:'postgres',algorithm:'aes-256-gcm',
   createdAt,sourceMajor:18,salt,iv,tag:cipher.getAuthTag().toString('hex'),
   bytes,sha256:await sha256(encrypted),mediaIncluded:false,mysqlIncluded:false};
  await authenticateFile(encrypted,meta);
  await archiveList(encrypted,meta);
  stage='s3-upload';
  await uploadEncrypted(encrypted,objectKey,bytes);
  stage='s3-readback';
  const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:objectKey}));
  if(Number(head.ContentLength)!==bytes)throw new Error('Remote archive length mismatch');
  const downloadedResponse=await s3.send(new GetObjectCommand({Bucket:bucket,Key:objectKey}));
  await pipeline(downloadedResponse.Body,createWriteStream(downloaded,{flags:'wx',mode:0o600}));
  if((await sha256(downloaded))!==meta.sha256)throw new Error('Remote backup hash mismatch');
  await authenticateFile(downloaded,meta);
  await archiveList(downloaded,meta);
  stage='publish-manifest';
  const manifest=Buffer.from(JSON.stringify({...meta,verifiedRemote:true,archiveKey:objectKey})+'\n');
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:objectKey+'.json',
   Body:manifest,ContentLength:manifest.length,ContentType:'application/json'}));
  console.log(JSON.stringify({ok:true,scope:'postgres',encrypted:true,
   remoteVerified:true,archiveListed:true,bytes,objectKey}));
 }finally{
  if(job?.proc.exitCode===null)job.proc.kill('SIGTERM');
  await rm(folder,{force:true,recursive:true}).catch(()=>{});
  s3.destroy();
 }
}
main().catch(error=>{
 // Error messages cannot contain credentials or customer contents.
 console.error(JSON.stringify({ok:false,code:'BACKUP_FAILED',stage,reason:String(error?.code||error?.message||'unknown').slice(0,110)}));
 process.exitCode=1;
});
