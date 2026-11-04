// Human-initiated, fail-closed isolated PostgreSQL 18 restore rehearsal.
// Never restores into the application production database; target database
// must already exist, be empty and start with socio_restore_test_.
import {Client} from 'pg';
import {createDecipheriv,scryptSync,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const requireEnv=(k)=>{if(!process.env[k])throw new Error('Missing '+k);return process.env[k];};
async function main(){
 const passphrase=requireEnv('SOCIO_BACKUP_PASSPHRASE');
 if(passphrase.length<40)throw new Error('Passphrase too short');
 if(process.env.SOCIO_RESTORE_CONFIRM!=='YES_DISPOSABLE_DATABASE')
  throw new Error('Refusing restore without explicit disposable-database confirmation');
 const archiveKey=requireEnv('SOCIO_RESTORE_ARCHIVE_KEY');
 if(!/^postgres\/\d{4}-\d\d-\d\d\/socio-[a-z0-9T-]+\.dump\.enc$/.test(archiveKey))
  throw new Error('Invalid archive object key');
 const sourceUrl=new URL(requireEnv('SOCIO_BACKUP_SOURCE_DATABASE_URL'));
 const targetUrl=new URL(requireEnv('SOCIO_RESTORE_TEST_DATABASE_URL'));
 const targetName=decodeURIComponent(targetUrl.pathname.slice(1));
 if(!/^socio_restore_test_[a-z0-9_]{5,50}$/.test(targetName)||
   !['postgres:','postgresql:'].includes(targetUrl.protocol))
  throw new Error('Restore destination must be a named disposable PostgreSQL database');
 if(sourceUrl.hostname===targetUrl.hostname&&sourceUrl.pathname===targetUrl.pathname)
  throw new Error('Cannot restore to source database');
 if(targetUrl.hostname.endsWith('.supabase.co')||targetUrl.hostname.endsWith('.pooler.supabase.com'))
  throw new Error('Cannot restore into managed Supabase through this tool');
 const endpoint=requireEnv('SOCIO_BACKUP_S3_ENDPOINT');
 if(!endpoint.startsWith('https://'))throw new Error('Backup endpoint must be HTTPS');
 const s3=new S3Client({endpoint,region:requireEnv('SOCIO_BACKUP_S3_REGION'),
  forcePathStyle:false,maxAttempts:2,credentials:{
   accessKeyId:requireEnv('SOCIO_BACKUP_S3_ACCESS_KEY'),
   secretAccessKey:requireEnv('SOCIO_BACKUP_S3_SECRET_KEY')}});
 const bucket=requireEnv('SOCIO_BACKUP_S3_BUCKET');
 let dir;
 try{
  const manifestResponse=await s3.send(new GetObjectCommand({Bucket:bucket,Key:archiveKey+'.json'}));
  const raw=await manifestResponse.Body.transformToString();
  if(raw.length>4000)throw new Error('Manifest exceeds safe size');
  const meta=JSON.parse(raw);
  if(meta.format!=='socio-disaster-v1'||meta.scope!=='postgres'||meta.algorithm!=='aes-256-gcm'||
    meta.verifiedRemote!==true||meta.archiveKey!==archiveKey||
    !/^[a-f0-9]{32}$/.test(meta.salt)||!/^[a-f0-9]{24}$/.test(meta.iv)||
    !/^[a-f0-9]{32}$/.test(meta.tag)||!/^[a-f0-9]{64}$/.test(meta.sha256)||
    !Number.isSafeInteger(meta.bytes)||meta.bytes<1024||meta.bytes>10737418240)
   throw new Error('Invalid or unverified archive manifest');
  dir=await mkdtemp(join(tmpdir(),'socio-rehearsal-'));
  const path=join(dir,'encrypted.dump');
  const obj=await s3.send(new GetObjectCommand({Bucket:bucket,Key:archiveKey}));
  await pipeline(obj.Body,createWriteStream(path,{flags:'wx',mode:0o600}));
  if((await stat(path)).size!==meta.bytes)throw new Error('Archive size mismatch');
  const hasher=createHash('sha256');
  await pipeline(createReadStream(path),new Writable({write(chunk,enc,next){hasher.update(chunk);next();}}));
  if(hasher.digest('hex')!==meta.sha256)throw new Error('Remote archive hash mismatch');
  const decrypt=()=>{const d=createDecipheriv('aes-256-gcm',
   scryptSync(passphrase,Buffer.from(meta.salt,'hex'),32),Buffer.from(meta.iv,'hex'));
   d.setAuthTag(Buffer.from(meta.tag,'hex'));return d;};
  // Authenticate ciphertext BEFORE opening any write connection to target.
  await pipeline(createReadStream(path),decrypt(),
   new Writable({write(chunk,enc,next){next();}}));
  const client=new Client({connectionString:targetUrl.href,connectionTimeoutMillis:10000});
  await client.connect();
  try{
   const check=await client.query(
    "SELECT count(*)::int AS tables FROM information_schema.tables "+
    "WHERE table_schema='public' AND table_type='BASE TABLE'");
   if(check.rows[0].tables!==0)throw new Error('Target database is not empty');
   const pgEnv={...process.env,PGHOST:targetUrl.hostname,PGPORT:targetUrl.port||'5432',
    PGDATABASE:targetName,PGUSER:decodeURIComponent(targetUrl.username),
    PGPASSWORD:decodeURIComponent(targetUrl.password),PGCONNECT_TIMEOUT:'12',
    PGSSLMODE:targetUrl.searchParams.get('sslmode')||'prefer'};
   const proc=spawn('pg_restore',['--no-owner','--no-privileges','--single-transaction','--exit-on-error'],
    {env:pgEnv,stdio:['pipe','ignore','pipe']});
   proc.stderr.resume();
   const completed=new Promise((resolve,reject)=>{
    proc.once('error',reject);
    proc.once('close',code=>code===0?resolve():reject(new Error('pg_restore exited with code '+code)));
   });
   try{await Promise.all([pipeline(createReadStream(path),decrypt(),proc.stdin),completed]);}
   catch(error){proc.kill('SIGTERM');throw error;}
   const counts=await client.query(
    "SELECT (SELECT count(*)::int FROM public.tenants) AS tenants,"+
    "(SELECT count(*)::int FROM public.users) AS users,"+
    "(SELECT count(*)::int FROM public.conversations) AS conversations,"+
    "(SELECT count(*)::int FROM public.messages) AS messages");
   console.log(JSON.stringify({ok:true,restored:true,disposableTarget:targetName,
    archiveKey,counts:counts.rows[0]}));
  }finally{await client.end();}
 }finally{
  await s3.destroy();
  if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
}
main().catch(err=>{
 console.error(JSON.stringify({ok:false,code:'REHEARSAL_FAILED',
  reason:String(err?.message||'failed').slice(0,120)}));
 process.exitCode=1;
});
