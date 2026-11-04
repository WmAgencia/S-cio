// Sócio-only PostgreSQL snapshot migration. Run once with both URLs configured.
// Intentionally does not change DATABASE_URL, drop the source, or copy S3/WA-AKG.
import {Client} from 'pg';

export const TABLES=Object.freeze([
 'tenants','users','sessions','channels','products','agents','imports',
 'conversations','messages','audit','training_jobs','training_job_items',
 'training_versions','waakg_links','waakg_scans','waakg_scan_chats',
 'waakg_import_snapshots','product_variants','product_media','product_campaign_links',
 'conversation_ui_state','message_ui_state','training_auto_runs',
 'message_outbox','ai_reply_attempts'
]);
const validName=v=>/^[a-z][a-z0-9_]*$/.test(v);
const qi=v=>{if(!validName(v))throw new Error('Unsafe SQL identifier');return '"'+v+'"';};
export function checkMigrationConfiguration(sourceUrl,targetUrl){
 if(!sourceUrl||!targetUrl)throw new Error('Both source and destination URLs are required');
 const source=new URL(sourceUrl),target=new URL(targetUrl);
 if(!['postgres:','postgresql:'].includes(source.protocol)||!['postgres:','postgresql:'].includes(target.protocol))
  throw new Error('Only Postgres URLs are permitted');
 if(source.hostname===target.hostname&&source.pathname===target.pathname&&source.username===target.username)
  throw new Error('Source and target must be different databases');
 if(!/supabase\.co$|pooler\.supabase\.com$/.test(target.hostname))
  throw new Error('Target is not a Supabase database hostname');
 return true;
}
async function rowCount(db,schema,table){
 const r=await db.query('SELECT COUNT(*)::bigint AS n FROM '+qi(schema)+'.'+qi(table));
 return Number(r.rows[0].n);
}
export async function migrate({sourceUrl,targetUrl,apply=false,logger=console.log}){
 checkMigrationConfiguration(sourceUrl,targetUrl);
 const source=new Client({connectionString:sourceUrl,connectionTimeoutMillis:12000});
 const target=new Client({connectionString:targetUrl,connectionTimeoutMillis:12000});
 let sourceOpen=false,targetOpen=false;
 try{
  await source.connect();sourceOpen=true;
  await target.connect();targetOpen=true;
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await source.query("SET LOCAL lock_timeout = '10s'");
  await target.query('BEGIN');
  await target.query('SET LOCAL search_path TO socio_app, public');
  if(apply){
   // Acquire the write barrier BEFORE taking the repeatable-read snapshot.
   // Complete the cutover under application maintenance; these locks alone
   // cannot protect writes made after this transaction releases them.
   const locks=TABLES.map(x=>'public.'+qi(x)).join(', ');
   await source.query('LOCK TABLE '+locks+' IN SHARE MODE');
  }
  const origin=await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",[TABLES]);
  const actual=new Set(origin.rows.map(x=>x.tablename));
  const missing=TABLES.filter(x=>!actual.has(x));
  if(missing.length)throw new Error('Source missing expected tables: '+missing.join(','));
  const structure=await target.query("SELECT tablename FROM pg_tables WHERE schemaname='socio_app' AND tablename=ANY($1::text[])",[TABLES]);
  if(structure.rows.length!==TABLES.length)throw new Error('Target private schema incomplete');
  const before={};
  for(const table of TABLES){
   const size=await rowCount(source,'public',table);
   const destinationSize=await rowCount(target,'socio_app',table);
   if(destinationSize!==0)throw new Error('Target not empty; refusing overwrite: '+table);
   before[table]=size;
  }
  logger(JSON.stringify({phase:apply?'copy':'preflight',tables:TABLES.length,records:Object.values(before).reduce((a,b)=>a+b,0),counts:before}));
  if(!apply){await target.query('ROLLBACK');await source.query('ROLLBACK');return {applied:false,counts:before};}
  for(const table of TABLES){
   const columns=await source.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[table]);
   const keys=columns.rows.map(x=>x.column_name);
   if(!keys.length||keys.some(x=>!validName(x)))throw new Error('Unexpected source columns: '+table);
   const cursor='cur_'+table;
   await source.query('DECLARE '+qi(cursor)+' NO SCROLL CURSOR FOR SELECT * FROM public.'+qi(table));
   let copied=0;
   for(;;){
    const batch=await source.query('FETCH FORWARD 200 FROM '+qi(cursor));
    if(!batch.rows.length)break;
    for(const row of batch.rows){
     const values=keys.map(k=>row[k]);
     await target.query('INSERT INTO socio_app.'+qi(table)+' ('+keys.map(qi).join(',')+') VALUES ('+
      keys.map((_,i)=>'$'+(i+1)).join(',')+')',values);
     copied++;
    }
   }
   await source.query('CLOSE '+qi(cursor));
   if(copied!==before[table]||await rowCount(target,'socio_app',table)!==before[table])
    throw new Error('Count validation failed: '+table);
   logger(JSON.stringify({phase:'copied',table,count:copied}));
  }
  await target.query('COMMIT');
  await source.query('ROLLBACK');
  logger(JSON.stringify({phase:'complete',tables:TABLES.length,validated:true}));
  return {applied:true,counts:before};
 }catch(error){
  if(targetOpen)await target.query('ROLLBACK').catch(()=>{});
  if(sourceOpen)await source.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  if(targetOpen)await target.end().catch(()=>{});
  if(sourceOpen)await source.end().catch(()=>{});
 }
}
const invoked=process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href;
if(invoked){
 const apply=process.argv.includes('--apply');
 if(apply&&process.env.SOCIO_MAINTENANCE_MODE!=='1'){
  console.error('Refusing production copy without SOCIO_MAINTENANCE_MODE=1');process.exitCode=1;
 }else{
  await migrate({sourceUrl:process.env.SOCIO_SOURCE_DATABASE_URL||process.env.DATABASE_URL,
   targetUrl:process.env.SOCIO_SUPABASE_DATABASE_URL,apply}).catch(e=>{
    console.error('Migration stopped:',String(e.message).slice(0,180));process.exitCode=1;
   });
 }
}
