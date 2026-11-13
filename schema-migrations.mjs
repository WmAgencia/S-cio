// Ordered, checksummed schema migrations for the private Supabase schema.
// The ledger (schema_migrations) is the single source of truth for what has
// run; a mismatch between a recorded file and its current content fails loudly
// instead of silently diverging from the database.
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const MIGRATIONS_DIR=new URL('./supabase/migrations/',import.meta.url);
const VERSION=/^\d{8}_[a-z0-9_]+$/;

export async function migrationFiles(dir=MIGRATIONS_DIR){
 const names=(await readdir(dir))
  .filter(name=>name.endsWith('.sql')&&VERSION.test(name.slice(0,-4)))
  .sort();
 const files=[];
 for(const name of names)
  files.push({version:name.slice(0,-4),name,sql:await readFile(new URL(name,dir),'utf8')});
 return files;
}

export const migrationChecksum=sql=>createHash('sha256').update(sql).digest('hex');

export async function expectedSchemaVersion(dir=MIGRATIONS_DIR){
 const files=await migrationFiles(dir);
 return files.length?files[files.length-1].version:null;
}

export async function applyPendingMigrations(db,{schema='socio_app',dir,files,
 apply=true,baseline=false,logger=()=>{}}={}){
 if(!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('Unsafe schema name');
 const list=files||await migrationFiles(dir);
 await db.query('CREATE TABLE IF NOT EXISTS '+schema+'.schema_migrations('+
  'version text PRIMARY KEY,filename text NOT NULL,checksum text NOT NULL,'+
  'applied_at timestamptz NOT NULL DEFAULT now())');
 const done=await db.query('SELECT version,checksum FROM '+schema+'.schema_migrations');
 const applied=new Map((done.rows||[]).map(row=>[row.version,row.checksum]));
 for(const file of list){
  const sum=migrationChecksum(file.sql);
  if(applied.has(file.version)&&applied.get(file.version)!==sum)
   throw new Error('Migration '+file.version+' was modified after being applied');
 }
 const pending=list.filter(file=>!applied.has(file.version));
 if(baseline){
  for(const file of pending)
   await db.query('INSERT INTO '+schema+'.schema_migrations(version,filename,checksum) VALUES($1,$2,$3)',
    [file.version,file.name,migrationChecksum(file.sql)]);
  logger(JSON.stringify({phase:'baseline',recorded:pending.length}));
  return {baseline:true,applied:[],pending:[]};
 }
 if(!apply)return {baseline:false,applied:[],pending:pending.map(file=>file.version)};
 const recorded=[];
 for(const file of pending){
  await db.query('BEGIN');
  try{
   await db.query(file.sql);
   await db.query('INSERT INTO '+schema+'.schema_migrations(version,filename,checksum) VALUES($1,$2,$3)',
    [file.version,file.name,migrationChecksum(file.sql)]);
   await db.query('COMMIT');
  }catch(error){
   await db.query('ROLLBACK').catch(()=>{});
   throw error;
  }
  recorded.push(file.version);
  logger(JSON.stringify({phase:'applied',version:file.version}));
 }
 return {baseline:false,applied:recorded,pending:[]};
}

// Readiness: the newest file in the repository must be recorded as applied.
export async function schemaVersionStatus(db,{schema='socio_app',files}={}){
 if(!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('Unsafe schema name');
 const list=files||await migrationFiles();
 const version=list.length?list[list.length-1].version:null;
 if(!version)return {ok:true,version:null};
 const row=await db.query('SELECT version FROM '+schema+'.schema_migrations WHERE version=$1',[version]);
 return {ok:row.rowCount>0,version};
}
