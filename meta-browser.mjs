import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createRemotePool} from './meta-browser/remote-pool.js';
import {requirePermission} from './team-permissions.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {topupAmount} from './meta-billing-state.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createMetaBrowser({env=process.env,runtime}={}){
 const configured=()=>env.SOCIO_META_BROWSER_ENABLED!=='false'&&String(env.CHANNEL_ENCRYPTION_KEY||'').length>=32;
 let activeRuntime=runtime;
 function engine(){
  if(!configured())throw fail(503,'A conexão por navegador está indisponível neste servidor.');
  if(!activeRuntime){
   const maxWorkers=Number(env.SOCIO_META_BROWSER_MAX_WORKERS||2);
   if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>32)throw fail(503,'Capacidade de navegadores inválida.');
   activeRuntime=createRemotePool({root:resolve(env.SOCIO_META_BROWSER_DIR||'data/meta-browser'),encryptionKey:env.CHANNEL_ENCRYPTION_KEY,maxWorkers});
  }
  return activeRuntime;
 }
 async function profile(pool,a,create=false){
  const existing=await pool.query("SELECT id FROM meta_browser_connections WHERE tenant_id=$1 AND user_id=$2 AND status='active'",[a.active_tenant_id,a.user_id]);
  if(existing.rows[0])return existing.rows[0].id;
  if(!create)throw fail(409,'Abra o navegador para criar sua conexão nesta empresa.');
  const inserted=await pool.query("INSERT INTO meta_browser_connections(id,tenant_id,user_id,status) VALUES($1,$2,$3,'active') "+
   "ON CONFLICT(tenant_id,user_id) WHERE status='active' DO UPDATE SET updated_at=now() RETURNING id",
   [randomBytes(16).toString('hex'),a.active_tenant_id,a.user_id]);
  return inserted.rows[0].id;
 }
 async function execute(pool,a,id,data,key){
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(key||''))throw fail(422,'Envie uma chave Idempotency-Key de 8 a 128 caracteres.');
  if(!/^[a-f0-9]{48}$/.test(data.plan_id||'')||typeof data.allow_writes!=='boolean')throw fail(422,'Plano ou permissão inválida.');
  if(data.allow_writes&&env.SOCIO_META_BROWSER_ALLOW_WRITES!=='true')throw fail(403,'Alterações de anúncios estão desabilitadas no servidor.');
  const hash=digest(JSON.stringify({plan_id:data.plan_id,allow_writes:data.allow_writes}));const keyHash=digest(key);
  const inserted=await pool.query("INSERT INTO meta_browser_writes(id,connection_id,tenant_id,user_id,key_hash,payload_hash,status) "+
   "VALUES($1,$2,$3,$4,$5,$6,'pending') ON CONFLICT(connection_id,key_hash) DO NOTHING RETURNING id",
   [randomUUID(),id,a.active_tenant_id,a.user_id,keyHash,hash]);
  if(!inserted.rows[0]){
   const old=(await pool.query('SELECT payload_hash,status,result FROM meta_browser_writes WHERE connection_id=$1 AND key_hash=$2 AND tenant_id=$3 AND user_id=$4',
    [id,keyHash,a.active_tenant_id,a.user_id])).rows[0];
   if(!old||old.payload_hash!==hash)throw fail(409,'Esta chave já foi usada para outro plano.');
   if(old.status!=='done')throw fail(409,'Resultado incerto ou pendente. Confira na Meta antes de repetir.');
   return old.result;
  }
  const result=await engine().call(id,'execute',{planId:data.plan_id,allowWrites:data.allow_writes});
  await pool.query("UPDATE meta_browser_writes SET status='done',result=$2,updated_at=now() WHERE id=$1 AND tenant_id=$3 AND user_id=$4",
   [inserted.rows[0].id,JSON.stringify(result),a.active_tenant_id,a.user_id]);
  return result;
 }
 return {
  async status(pool,a){
   requirePermission(a,'marketing.read');
   const base={engine:'api-anything',requiresMetaApp:false,configured:configured(),session_present:false,remote_browser_open:false,operations:[],live_validated:false};
   if(!base.configured)return base;
   const found=await pool.query("SELECT id FROM meta_browser_connections WHERE tenant_id=$1 AND user_id=$2 AND status='active'",[a.active_tenant_id,a.user_id]);
   if(!found.rows[0])return base;
   return {...base,...await engine().call(found.rows[0].id,'status')};
  },
  async action(pool,a,kind,data={},key){
   requirePermission(a,'marketing.manage');
   if(!['open','screen','input','finish','close','disconnect','plan','execute'].includes(kind))throw fail(404,'Operação não encontrada.');
   engine();
   const id=await profile(pool,a,kind==='open');
   if(kind==='disconnect'){
    await pool.query("UPDATE meta_browser_connections SET status='disconnected',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND user_id=$3",[id,a.active_tenant_id,a.user_id]);
    await engine().stop(id);return {disconnected:true};
   }
   if(kind==='input'){
    const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
    const keys=['Enter','Tab','Shift+Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape','Control+a'];
    const valid=(data.kind==='click'&&isNumber(data.x)&&isNumber(data.y)&&data.x>=0&&data.x<=1279&&data.y>=0&&data.y<=799)||
     (data.kind==='text'&&typeof data.text==='string'&&data.text.length<=4096)||
     (data.kind==='key'&&keys.includes(data.key))||
     (data.kind==='scroll'&&isNumber(data.delta)&&Math.abs(data.delta)<=2000);
    if(!valid)throw fail(422,'Entrada de navegador inválida.');
    const selected=data.kind==='click'?{kind:data.kind,x:data.x,y:data.y}:data.kind==='text'?{kind:data.kind,text:data.text}:
     data.kind==='key'?{kind:data.kind,key:data.key}:{kind:data.kind,delta:data.delta};
    return engine().call(id,kind,selected);
   }
   if(kind==='plan'){
    if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(data.operation||'')||(data.args!==undefined&&(!data.args||typeof data.args!=='object'||Array.isArray(data.args))))throw fail(422,'Operação ou argumentos inválidos.');
    return engine().call(id,kind,{operation:data.operation,args:data.args||{}});
   }
   if(kind==='execute')return execute(pool,a,id,data,key);
   return engine().call(id,kind);
  },
  async billing(pool,a,kind,data={}){
   requirePermission(a,'marketing.manage');
   assertApiFeature(a.features,'/api/marketing/tools');
   if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
   if(!['read','prepare'].includes(kind))throw fail(422,'Operação inválida.');
   if(kind==='prepare')topupAmount(data.amountMinor);
   const account=await resolveSelectedOfficialAccount(pool,a);
   if(account.currency!=='BRL')throw fail(422,'A recarga assistida está disponível para contas BRL.');
   const id=await profile(pool,a,true);
   const result=await engine().call(id,kind==='read'?'billing_read':'billing_prepare',{
    accountId:account.id,accountName:account.name,currency:account.currency,
    ...(kind==='prepare'?{amountMinor:data.amountMinor}:{})});
   return {...result,accountId:account.id};
  },
  async close(){if(activeRuntime)await activeRuntime.close();},
 };
}
