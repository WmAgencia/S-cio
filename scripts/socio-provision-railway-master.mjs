// Temporary, explicit owner provisioning in the current Socio Railway Postgres.
// Source is never committed with login secrets. It is safe to rerun (idempotent).
// As soon as Supabase cutover is available, the owner migrates with other users.
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {validateMasterConfig} from './socio-provision-master.mjs';

export async function provisionRailwayMaster(env=process.env,logger=console.log){
 if(!env.DATABASE_URL)throw new Error('DATABASE_URL missing');
 if(!env.SOCIO_MASTER_EMAIL||!env.SOCIO_MASTER_PHONE||!env.SOCIO_MASTER_PASSWORD_HASH)
  throw new Error('Master account variables missing');
 const {email,phone}=validateMasterConfig(
  env.SOCIO_MASTER_EMAIL,env.SOCIO_MASTER_PHONE,env.SOCIO_MASTER_PASSWORD_HASH);
 const client=new Client({connectionString:env.DATABASE_URL,connectionTimeoutMillis:10000});
 await client.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(2026110327)');
  const found=await client.query('SELECT id,tenant_id FROM users WHERE lower(email)=$1 FOR UPDATE',[email]);
  let userId,tenantId;
  if(found.rows.length){
   userId=found.rows[0].id;tenantId=found.rows[0].tenant_id;
   await client.query("UPDATE users SET email=$2,phone=$3,password_hash=$4,role='owner',platform_owner=true WHERE id=$1",
    [userId,email,phone,env.SOCIO_MASTER_PASSWORD_HASH]);
   await client.query('DELETE FROM sessions WHERE user_id=$1',[userId]);
  }else{
   const root=await client.query('SELECT tenant_id FROM users WHERE platform_owner=true ORDER BY created_at ASC LIMIT 1');
   tenantId=root.rows[0]?.tenant_id;
   if(!tenantId){
    tenantId=randomUUID();
    await client.query("INSERT INTO tenants(id,name,slug,plan,status) VALUES($1,'Consecom Brasil',$2,'essencial','active')",
     [tenantId,'consecom-'+tenantId.slice(0,8)]);
    await client.query('INSERT INTO agents(tenant_id) VALUES($1)',[tenantId]);
   }
   userId=randomUUID();
   await client.query("INSERT INTO users(id,tenant_id,email,phone,name,password_hash,role,platform_owner) VALUES($1,$2,$3,$4,'Administrador Master Consecom',$5,'owner',true)",
    [userId,tenantId,email,phone,env.SOCIO_MASTER_PASSWORD_HASH]);
  }
  const check=await client.query('SELECT role,platform_owner,phone FROM users WHERE id=$1',[userId]);
  if(check.rows[0]?.role!=='owner'||check.rows[0]?.platform_owner!==true||check.rows[0]?.phone!==phone)
   throw new Error('Master role/phone confirmation failed');
  await client.query('COMMIT');
  logger('SOCIO_RAILWAY_MASTER_READY');
  return {ok:true};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{await client.end();}
}
const invoked=process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href;
if(invoked){
 await provisionRailwayMaster().catch(e=>{
  console.error('SOCIO_MASTER_PROVISIONING_FAILED',String(e.code||e.message).slice(0,90));
  process.exitCode=1;
 });
}
