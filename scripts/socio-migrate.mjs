// Applies the SQL files in supabase/migrations/ in order, recording each one
// in schema_migrations. `--check` reports pending work without writing;
// `--baseline` records the existing files when the schema was created by hand.
import {Client} from 'pg';
import {applyPendingMigrations} from '../schema-migrations.mjs';

const url=process.env.DATABASE_URL;
if(!url){
 console.error('DATABASE_URL is required');
 process.exit(1);
}
let hostname;
try{hostname=new URL(url).hostname;}catch{console.error('DATABASE_URL is not a valid URL');process.exit(1);}
const supabase=/\.supabase\.co$|\.pooler\.supabase\.com$/.test(hostname);
const schema=process.env.SOCIO_DB_SCHEMA||(supabase?'socio_app':'public');
const check=process.argv.includes('--check');
const baseline=process.argv.includes('--baseline');
const client=new Client({connectionString:url,connectionTimeoutMillis:20000});
await client.connect();
try{
 await client.query('SET search_path TO '+schema+',pg_catalog');
 const result=await applyPendingMigrations(client,{schema,apply:!check,baseline,logger:console.log});
 console.log(JSON.stringify({schema,...result}));
 if(check&&result.pending.length)process.exitCode=1;
}catch(error){
 console.error('Migration stopped:',String(error?.message||error).slice(0,300));
 process.exitCode=1;
}finally{
 await client.end().catch(()=>{});
}
