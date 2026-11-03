// Explicit, one-off provisioning of the Consecom SaaS platform owner.
// Database URL, email, phone and password hash are supplied as runtime secrets,
// never committed to source, and the normal user signup password policy remains.
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {normalizeLoginPhone,emailOk} from '../lib.mjs';
export function validateMasterConfig(email,phone,passwordHash){
 const clean=typeof email==='string'?email.trim().toLowerCase():'';
 const number=normalizeLoginPhone(phone);
 if(!emailOk(clean)||!number||typeof passwordHash!=='string'||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash))
  throw new Error('Missing or invalid master login configuration');
 return {email:clean,phone:number};
}
async function provision(){
 const url=process.env.SOCIO_SUPABASE_DATABASE_URL;
 if(!url||!process.env.SOCIO_MASTER_EMAIL||!process.env.SOCIO_MASTER_PHONE||!process.env.SOCIO_MASTER_PASSWORD_HASH)
  throw new Error('Missing dedicated Supabase database URL or master credentials');
 const {email,phone}=validateMasterConfig(
  process.env.SOCIO_MASTER_EMAIL,process.env.SOCIO_MASTER_PHONE,process.env.SOCIO_MASTER_PASSWORD_HASH);
 const hash=process.env.SOCIO_MASTER_PASSWORD_HASH;
 const c=new Client({connectionString:url,connectionTimeoutMillis:12000});
 await c.connect();
 try{
  await c.query('BEGIN');
  await c.query('SET LOCAL search_path TO socio_app, public');
  await c.query('SELECT pg_advisory_xact_lock(2026110327)');
  let existing=await c.query('SELECT id,tenant_id FROM socio_app.users WHERE email=$1 FOR UPDATE',[email]);
  let userId,tenantId;
  if(existing.rows.length){
   userId=existing.rows[0].id;tenantId=existing.rows[0].tenant_id;
   await c.query("UPDATE socio_app.users SET phone=$2,password_hash=$3,role='owner',platform_owner=true WHERE id=$1",
    [userId,phone,hash]);
   // Credential changes invalidate existing sessions for the affected account.
   await c.query('DELETE FROM socio_app.sessions WHERE user_id=$1',[userId]);
  }else{
   const root=await c.query('SELECT tenant_id FROM socio_app.users WHERE platform_owner=true ORDER BY created_at LIMIT 1');
   tenantId=root.rows[0]?.tenant_id;
   if(!tenantId){
    tenantId=randomUUID();
    await c.query("INSERT INTO socio_app.tenants(id,name,slug,plan,status) VALUES($1,'Consecom Brasil',$2,'essencial','active')",
     [tenantId,'consecom-'+tenantId.slice(0,8)]);
    await c.query('INSERT INTO socio_app.agents(tenant_id) VALUES($1)',[tenantId]);
   }
   userId=randomUUID();
   await c.query("INSERT INTO socio_app.users(id,tenant_id,email,phone,name,password_hash,role,platform_owner) VALUES($1,$2,$3,$4,'Administrador Master Consecom',$5,'owner',true)",
    [userId,tenantId,email,phone,hash]);
  }
  const result=await c.query('SELECT role,platform_owner,phone FROM socio_app.users WHERE id=$1',[userId]);
  if(!result.rowCount||result.rows[0].role!=='owner'||!result.rows[0].platform_owner||result.rows[0].phone!==phone)
   throw new Error('Master role verification failed');
  await c.query('COMMIT');
  console.log('SOCIO_MASTER_READY');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
}
const invoked=process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href;
if(invoked)await provision().catch(e=>{
 console.error('Master provisioning rejected:',String(e.code||e.message).slice(0,90));process.exitCode=1;
});
