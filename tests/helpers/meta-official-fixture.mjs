import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startOfficial,finishOfficial,officialAccounts,handleMetaRemoval,metaRemovalStatus,selectOfficialAccount,resolveSelectedOfficialAccount,officialStatus} from '../../meta-official.mjs';
export async function officialPersistenceScenario(pool){
 await pool.query(await readFile(new URL('../../schema.sql',import.meta.url),'utf8'));
 const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'private-test-secret',SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'isolated-key-at-least-32-characters-for-tests'};
 const actors=[];
 for(let n=0;n<2;n++){
  const tenant=randomUUID(),user=randomUUID(),session=randomUUID();
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)',[tenant,'Test',tenant]);
  await pool.query('INSERT INTO users(id,tenant_id,email,name,password_hash) VALUES($1,$2,$3,$4,$5)',[user,tenant,user+'@example.test','Test','not-a-real-password']);
  await pool.query("INSERT INTO sessions(token_hash,user_id,active_tenant_id,csrf,expires_at) VALUES($1,$2,$3,'test',now()+interval '1 day')",[session,user,tenant]);
  actors.push({active_tenant_id:tenant,user_id:user,token_hash:session,role:'owner',features:{meta_ads:true}});
 }
 const response=data=>({ok:true,json:async()=>data});
 const request=async url=>{
  const target=String(url);
  if(target.endsWith('/oauth/access_token'))return response({access_token:'test-token-long-enough-for-fixture',expires_in:3600});
  if(target.includes('/me/permissions'))return response({data:[{permission:'ads_read',status:'granted'},{permission:'ads_management',status:'granted'}]});
  if(target.includes('/me/adaccounts'))return response({data:[{id:'act_123456',name:'Autorizada',currency:'BRL'}]});
  if(target.includes('/me?'))return response({id:'123456789'});
  throw Error('Unexpected Meta URL');
 };
 for(const actor of actors){
  const login=await startOfficial(pool,actor,{env});
  const state=new URL(login.authorizationUrl).searchParams.get('state');
  await finishOfficial(pool,state,'test-code',{env,request});
  await assert.rejects(finishOfficial(pool,state,'replay',{env,request}),{status:400});
  assert.equal((await officialAccounts(pool,actor,{env,request})).accounts.length,1);
 }
 await assert.rejects(selectOfficialAccount(pool,actors[0],'act_999999',{env,request}),{status:403});
 await assert.rejects(selectOfficialAccount(pool,{...actors[0],role:'agent'},'act_123456',{env,request}),{status:403});
 await selectOfficialAccount(pool,actors[0],'act_123456',{env,request});
 assert.equal((await officialStatus(pool,actors[0],{env})).selectedAccount.account_id,'act_123456');
 assert.equal((await resolveSelectedOfficialAccount(pool,actors[0],{env,request})).id,'act_123456');
 await assert.rejects(resolveSelectedOfficialAccount(pool,actors[1],{env,request}),{status:409});
 const grants=await pool.query('SELECT * FROM meta_official_grants');
 assert.equal(grants.rows.length,2);assert(!JSON.stringify(grants.rows).includes('test-token-long-enough-for-fixture'));
 await assert.rejects(officialAccounts(pool,{...actors[0],active_tenant_id:randomUUID()},{env,request}),{status:409});
 const paused=await startOfficial(pool,actors[0],{env});
 await pool.query("UPDATE tenants SET status='paused' WHERE id=$1",[actors[0].active_tenant_id]);
 await assert.rejects(finishOfficial(pool,new URL(paused.authorizationUrl).searchParams.get('state'),'paused',{env,request}),{status:403});
 await pool.query("UPDATE tenants SET status='trial' WHERE id=$1",[actors[0].active_tenant_id]);
 const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:'123456789',issued_at:Math.floor(Date.now()/1000)})).toString('base64url');
 const signed=createHmac('sha256',env.SOCIO_META_APP_SECRET).update(payload).digest('base64url')+'.'+payload;
 await assert.rejects(handleMetaRemoval(pool,'x'+signed,{env}),{status:403});
 assert.equal((await pool.query('SELECT * FROM meta_official_grants')).rows.length,2);
 const deletion=await handleMetaRemoval(pool,signed,{env});
 assert.equal((await pool.query('SELECT * FROM meta_official_grants')).rows.length,0);
 assert.equal((await pool.query('SELECT * FROM meta_official_account_selections')).rows.length,0);
 assert.equal((await metaRemovalStatus(pool,deletion.confirmation_code)).status,'completed');
 assert.equal((await handleMetaRemoval(pool,signed,{env})).confirmation_code,deletion.confirmation_code);
 assert.equal((await pool.query('SELECT * FROM meta_official_deletions')).rows.length,1);
 // A new login after removal is permitted; previously consumed states remain unusable.
 const again=await startOfficial(pool,actors[0],{env});
 await finishOfficial(pool,new URL(again.authorizationUrl).searchParams.get('state'),'fresh',{env,request});
 assert.equal((await pool.query('SELECT * FROM meta_official_grants')).rows.length,1);
 return {actors,env,request};
}
