// Sócio-only PostgreSQL snapshot migration. Run once with both URLs configured.
// Intentionally does not change DATABASE_URL, drop the source, or copy S3/WA-AKG.
import {Client} from 'pg';
import {createHash} from 'node:crypto';

export const TABLES=Object.freeze([
 'tenants','users','flow_image_jobs','meta_official_states','meta_official_grants','meta_official_revocations','meta_official_deletions','meta_official_account_selections','meta_ads_plans','meta_local_connections','meta_local_jobs','meta_browser_connections','meta_browser_writes','ads_media','ads_media_mcp_tokens','ads_oauth_clients','ads_oauth_codes','ads_oauth_tokens','marketing_oauth_attempts','marketing_oauth_grants','instagram_hosted_profiles','marketing_connections','marketing_report_receipts','marketing_daily_metrics','instagram_oauth_states','sessions','channels','instagram_accounts','products','agents','imports',
 'conversations','instagram_outbox','messages','audit','training_jobs','training_job_items',
 'training_versions','waakg_links','waakg_scans','waakg_scan_chats',
 'waakg_import_snapshots','product_variants','product_media','product_campaign_links',
 'conversation_ui_state','message_ui_state','training_auto_runs',
 'message_outbox','ai_reply_attempts','sales_quotes','sales_orders','sales_payment_events','quote_requests','sale_intents','wa_tracking_links','wa_lead_attributions','meta_report_schedules','meta_report_runs','socio_skill_runs','socio_owner_skill_receipts','socio_owner_media_receipts'
]);
const validName=v=>/^[a-z][a-z0-9_]*$/.test(v);
const qi=v=>{if(!validName(v))throw new Error('Unsafe SQL identifier');return '"'+v+'"';};
export function checkMigrationConfiguration(sourceUrl,targetUrl,{allowLocalTest=false}={}){
 if(!sourceUrl||!targetUrl)throw new Error('Both source and destination URLs are required');
 const source=new URL(sourceUrl),target=new URL(targetUrl);
 if(!['postgres:','postgresql:'].includes(source.protocol)||!['postgres:','postgresql:'].includes(target.protocol))
  throw new Error('Only Postgres URLs are permitted');
 if(source.hostname===target.hostname&&source.pathname===target.pathname&&
   (source.port||'5432')===(target.port||'5432'))
  throw new Error('Source and target must be different databases');
 if(source.hostname.endsWith('.supabase.co')||source.hostname.endsWith('.pooler.supabase.com'))
  throw new Error('Source must not be a Supabase database');
 const supabase=/(^|\.)supabase\.co$|(^|\.)pooler\.supabase\.com$/.test(target.hostname);
 const localFixture=allowLocalTest&&['localhost','127.0.0.1'].includes(target.hostname)&&
  target.pathname.startsWith('/socio_migration_target_test_')&&source.pathname.startsWith('/socio_migration_source_test_')&&
  ['localhost','127.0.0.1'].includes(source.hostname);
 if(!supabase&&!localFixture)throw new Error('Target is not a Supabase database hostname');
 return true;
}
const HASH_MOD=1n<<256n;
export function fingerprintRow(row){
 const stable=value=>{
  if(value instanceof Date)return value.toISOString();
  if(Buffer.isBuffer(value))return value.toString('base64');
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')
   return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
 };
 return createHash('sha256').update(JSON.stringify(stable(row))).digest('hex');
}
async function tableShape(db,schema,table){
 const r=await db.query(
  "SELECT column_name,data_type,udt_name,is_nullable,character_maximum_length,numeric_precision,numeric_scale "+
  "FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
  [schema,table]);
 return r.rows;
}
async function tablePk(db,schema,table){
 const r=await db.query(
  "SELECT a.attname FROM pg_constraint c "+
  "JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace "+
  "JOIN unnest(c.conkey) WITH ORDINALITY AS k(num,pos) ON true "+
  "JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=k.num "+
  "WHERE n.nspname=$1 AND rel.relname=$2 AND c.contype='p' ORDER BY k.pos",
  [schema,table]);
 return r.rows.map(x=>x.attname);
}
export function compareTableShape(table,origin,destination,originPk,targetPk){
 if(!origin.length||JSON.stringify(origin)!==JSON.stringify(destination))
  throw new Error('Column schema drift: '+table);
 if(!originPk.length||JSON.stringify(originPk)!==JSON.stringify(targetPk))
  throw new Error('Primary key schema drift: '+table);
 return origin.map(c=>c.column_name);
}
async function tableDigest(db,schema,table){
 const cursor=qi('digest_'+table),h={sum:0n,count:0};
 await db.query('DECLARE '+cursor+' NO SCROLL CURSOR FOR SELECT * FROM '+qi(schema)+'.'+qi(table));
 try{
  for(;;){
   const r=await db.query('FETCH FORWARD 200 FROM '+cursor);
   if(!r.rows.length)break;
   for(const row of r.rows){
    h.sum=(h.sum+BigInt('0x'+fingerprintRow(row)))%HASH_MOD;
    h.count++;
   }
  }
 }finally{await db.query('CLOSE '+cursor);}
 return {sum:h.sum.toString(16),count:h.count};
}

async function rowCount(db,schema,table){
 const r=await db.query('SELECT COUNT(*)::bigint AS n FROM '+qi(schema)+'.'+qi(table));
 return Number(r.rows[0].n);
}
export async function migrate({sourceUrl,targetUrl,apply=false,logger=console.log,allowLocalTest=false}){
 checkMigrationConfiguration(sourceUrl,targetUrl,{allowLocalTest});
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
  const access=await target.query("SELECT has_schema_privilege('anon','socio_app','USAGE') AS anon, "+
   "has_schema_privilege('authenticated','socio_app','USAGE') AS authenticated");
  if(access.rows[0].anon||access.rows[0].authenticated)
   throw new Error('Private target schema exposed to client roles');
  const before={},keysByTable={},typesByTable={};
  for(const table of TABLES){
   const [originShape,targetShape,originPk,targetPk]=await Promise.all([
    tableShape(source,'public',table),tableShape(target,'socio_app',table),
    tablePk(source,'public',table),tablePk(target,'socio_app',table)]);
   keysByTable[table]=compareTableShape(table,originShape,targetShape,originPk,targetPk);
   typesByTable[table]=Object.fromEntries(originShape.map(x=>[x.column_name,x.udt_name]));
   const size=await rowCount(source,'public',table);
   const destinationSize=await rowCount(target,'socio_app',table);
   if(destinationSize!==0)throw new Error('Target not empty; refusing overwrite: '+table);
   before[table]=size;
  }
  logger(JSON.stringify({phase:apply?'copy':'preflight',tables:TABLES.length,records:Object.values(before).reduce((a,b)=>a+b,0),counts:before}));
  if(!apply){await target.query('ROLLBACK');await source.query('ROLLBACK');return {applied:false,counts:before,schemasMatch:true};}
  for(const table of TABLES){
   const keys=keysByTable[table];
   if(!keys.length||keys.some(x=>!validName(x)))throw new Error('Unexpected source columns: '+table);
   const cursor='cur_'+table;
   await source.query('DECLARE '+qi(cursor)+' NO SCROLL CURSOR FOR SELECT * FROM public.'+qi(table));
   let copied=0,sourceSum=0n;
   for(;;){
    const batch=await source.query('FETCH FORWARD 200 FROM '+qi(cursor));
    if(!batch.rows.length)break;
    for(const row of batch.rows){
     // pg serializes JS arrays as PostgreSQL arrays. JSON/JSONB arrays
     // must be encoded as JSON text to preserve their exact values.
     const values=keys.map(k=>['json','jsonb'].includes(typesByTable[table][k])?JSON.stringify(row[k]):row[k]);
     sourceSum=(sourceSum+BigInt('0x'+fingerprintRow(row)))%HASH_MOD;
     await target.query('INSERT INTO socio_app.'+qi(table)+' ('+keys.map(qi).join(',')+') VALUES ('+
      keys.map((_,i)=>'$'+(i+1)).join(',')+')',values);
     copied++;
    }
   }
   await source.query('CLOSE '+qi(cursor));
   if(copied!==before[table])throw new Error('Source count changed: '+table);
   const targetDigest=await tableDigest(target,'socio_app',table);
   if(targetDigest.count!==before[table]||targetDigest.sum!==sourceSum.toString(16))
    throw new Error('Data fingerprint mismatch: '+table);
   logger(JSON.stringify({phase:'verified',table,count:copied}));
  }
  await target.query('COMMIT');
  await source.query('ROLLBACK');
  logger(JSON.stringify({phase:'complete',tables:TABLES.length,validated:true}));
  return {applied:true,counts:before,validated:true};
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
 const confirmed=process.env.SOCIO_MAINTENANCE_MODE==='1'&&
  process.env.SOCIO_VERIFIED_BACKUP==='YES'&&
  process.env.SOCIO_TARGET_EMPTY_CONFIRMED==='YES'&&
  process.env.SOCIO_WRITE_FREEZE_CONFIRMED==='YES';
 if(apply&&!confirmed){
  console.error('Copy denied: maintenance, verified backup, empty target and write freeze confirmations required.');
  process.exitCode=1;
 }else{
  await migrate({sourceUrl:process.env.SOCIO_SOURCE_DATABASE_URL||process.env.DATABASE_URL,
   targetUrl:process.env.SOCIO_SUPABASE_DATABASE_URL,apply}).catch(e=>{
    console.error('Migration stopped:',String(e.message).slice(0,180));process.exitCode=1;
   });
 }
}
