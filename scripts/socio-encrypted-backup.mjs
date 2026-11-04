#!/usr/bin/env node
// Encrypted, operator-invoked PostgreSQL backup and isolated restore rehearsal.
// Does NOT schedule backups, upload archives, alter production DB or back up S3 media.
import {randomBytes,createHash,createCipheriv,createDecipheriv,scryptSync} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rm,stat,chmod} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {Client} from 'pg';

const bad=message=>{throw new Error(message);};
const secret=process.env.SOCIO_BACKUP_PASSPHRASE;
const command=process.argv[2];
const validateSecret=()=>{
 if(typeof secret!=='string'||secret.length<32)bad('SOCIO_BACKUP_PASSPHRASE precisa ter 32+ caracteres.');
};
function parseDb(source){
 if(!source)bad('URL do PostgreSQL ausente.');
 let u;
 try{u=new URL(source);}catch{bad('URL de banco inválida.');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname||!u.pathname||u.pathname==='/')
  bad('Informe URL do PostgreSQL com host e nome da base.');
 return u;
}
function connectionEnv(source){
 const u=parseDb(source);
 const vars={...process.env,PGHOST:u.hostname,PGDATABASE:decodeURIComponent(u.pathname.slice(1)),
  PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username||'postgres'),
  PGPASSWORD:decodeURIComponent(u.password||'')};
 const ssl=u.searchParams.get('sslmode');
 if(ssl)vars.PGSSLMODE=ssl;
 return vars;
}
function commandStream(command,args,env){
 const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});
 let error='',status;
 child.stderr.on('data',chunk=>{error+=chunk.toString().slice(0,500);error=error.slice(-800);});
 const exited=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',(code)=>code===0?resolve():reject(new Error(command+' falhou (código '+code+').')));
 });
 return {child,exited};
}
const key=salt=>scryptSync(secret,Buffer.from(salt,'hex'),32);
async function checksum(path){
 const hash=createHash('sha256');
 await pipeline(createReadStream(path),new Writable({write(chunk,enc,next){hash.update(chunk);next();}}));
 return hash.digest('hex');
}
async function verify(path){
 validateSecret();
 if(!path||!isAbsolute(path))bad('Use um caminho absoluto para o arquivo .enc.');
 const manifest=JSON.parse(await readFile(path+'.json','utf8'));
 if(manifest.format!=='socio-pg-encrypted-v1'||manifest.algorithm!=='aes-256-gcm'||!/^[0-9a-f]{32}$/.test(manifest.salt||'')||
  !/^[0-9a-f]{24}$/.test(manifest.iv||'')||!/^[0-9a-f]{32}$/.test(manifest.tag||''))
  bad('Manifesto de backup inválido.');
 const info=await stat(path);
 if(info.size!==manifest.bytes||(await checksum(path))!==manifest.sha256)
  bad('Integridade do arquivo de backup não confere.');
 const decipher=createDecipheriv('aes-256-gcm',key(manifest.salt),Buffer.from(manifest.iv,'hex'));
 decipher.setAuthTag(Buffer.from(manifest.tag,'hex'));
 await pipeline(createReadStream(path),decipher,new Writable({write(chunk,enc,next){next();}}));
 return manifest;
}
async function backup(){
 validateSecret();
 const db=process.env.DATABASE_URL;
 parseDb(db);
 const dir=process.env.SOCIO_BACKUP_DIR;
 if(!dir||!isAbsolute(dir))bad('Defina SOCIO_BACKUP_DIR como diretório absoluto e protegido.');
 if(process.env.SOCIO_BACKUP_CONFIRM!=='YES_ENCRYPTED_BACKUP')
  bad('Confirme SOCIO_BACKUP_CONFIRM=YES_ENCRYPTED_BACKUP.');
 await mkdir(dir,{recursive:true,mode:0o700});
 await chmod(dir,0o700);
 const label=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(5).toString('hex');
 const path=join(dir,'socio-'+label+'.enc');
 const salt=randomBytes(16).toString('hex'),iv=randomBytes(12).toString('hex');
 const cipher=createCipheriv('aes-256-gcm',key(salt),Buffer.from(iv,'hex'));
 const pg=commandStream('pg_dump',['--format=custom','--no-owner','--no-privileges'],connectionEnv(db));
 try{
  pg.child.stdin.end();
  await Promise.all([
   pipeline(pg.child.stdout,cipher,createWriteStream(path,{flags:'wx',mode:0o600})),
   pg.exited
  ]);
  const manifest={format:'socio-pg-encrypted-v1',algorithm:'aes-256-gcm',salt,iv,
   tag:cipher.getAuthTag().toString('hex'),sha256:await checksum(path),
   bytes:(await stat(path)).size,createdAt:new Date().toISOString(),
   scope:'postgresql-only',mediaIncluded:false};
  await writeFile(path+'.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await verify(path);
  process.stdout.write(JSON.stringify({ok:true,archive:path,encrypted:true,bytes:manifest.bytes})+'\n');
 }catch(err){
  pg.child.kill('SIGTERM');
  await Promise.allSettled([rm(path,{force:true}),rm(path+'.json',{force:true})]);
  throw err;
 }
}
async function rehearse(){
 validateSecret();
 if(process.env.SOCIO_RESTORE_CONFIRM!=='YES_DISPOSABLE_DATABASE')
  bad('Restauração permitida somente com SOCIO_RESTORE_CONFIRM=YES_DISPOSABLE_DATABASE.');
 const source=parseDb(process.env.DATABASE_URL),target=parseDb(process.env.SOCIO_RESTORE_TEST_DATABASE_URL);
 const targetName=decodeURIComponent(target.pathname.slice(1));
 if(!/^socio_restore_test_[a-z0-9_]{5,50}$/.test(targetName))
  bad('A base de destino deve ser descartável e começar por socio_restore_test_.');
 if(source.href===target.href||(source.hostname===target.hostname&&source.pathname===target.pathname))
  bad('Origem e destino não podem ser a mesma base.');
 const archive=process.env.SOCIO_BACKUP_ARCHIVE;
 await verify(archive);
 const pg=commandStream('pg_restore',['--no-owner','--no-privileges','--single-transaction','--exit-on-error','--dbname='+targetName],connectionEnv(target.href));
 // Ciphertext and GCM tag were fully checked above before a write to the target.
 const manifest=JSON.parse(await readFile(archive+'.json','utf8'));
 const decipher=createDecipheriv('aes-256-gcm',key(manifest.salt),Buffer.from(manifest.iv,'hex'));
 decipher.setAuthTag(Buffer.from(manifest.tag,'hex'));
 try{
  await Promise.all([pipeline(createReadStream(archive),decipher,pg.child.stdin),pg.exited]);
  const client=new Client({connectionString:target.href});
  await client.connect();
  try{
   const checks=await client.query(
    "SELECT (SELECT count(*) FROM tenants)::int AS tenants,"+
    "(SELECT count(*) FROM channels)::int AS channels,"+
    "(SELECT count(*) FROM conversations)::int AS conversations,"+
    "(SELECT count(*) FROM users)::int AS users,"+
    "(SELECT count(*) FROM sales_orders)::int AS orders");
   process.stdout.write(JSON.stringify({ok:true,rehearsed:true,disposableDatabase:targetName,counts:checks.rows[0]})+'\n');
  }finally{await client.end();}
 }catch(err){pg.child.kill('SIGTERM');throw err;}
}
try{
 if(command==='backup')await backup();
 else if(command==='verify'){
  const archive=process.env.SOCIO_BACKUP_ARCHIVE;
  await verify(archive);process.stdout.write(JSON.stringify({ok:true,integrityVerified:true})+'\n');
 }else if(command==='rehearse')await rehearse();
 else bad('Uso: node scripts/socio-encrypted-backup.mjs backup|verify|rehearse');
}catch(err){
 console.error('Operação de backup indisponível: '+String(err?.message||'falha').slice(0,250));
 process.exitCode=1;
}
