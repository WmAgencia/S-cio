// Consent-gated, signed server-to-server website events.
// Never accept Purchase from a generic website event, even if signed.
// Browser Meta Pixel must reuse eventID == server event_id for deduplication.
import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';
import {openMarketingSecret,sealMarketingSecret} from './marketing-integrations.mjs';
import {officialConfig} from './meta-official.mjs';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptedNames=new Set(['PageView','ViewContent','AddToCart','InitiateCheckout','Lead']);
const trackingActive=env=>env.SOCIO_SITE_EVENTS_ENABLED==='true';
const capiActive=env=>env.SOCIO_META_CAPI_ENABLED==='true';
function permit(a,write=false){
 requirePermission(a,write?'marketing.manage':'marketing.read');
 assertApiFeature(a.features,'/api/marketing/tools');
 if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
function siteOrigin(value){
 let u;try{u=new URL(value)}catch{throw fail(422,'Informe o domínio completo HTTPS.');}
 if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)
  throw fail(422,'Domínio deve ser uma origem HTTPS sem caminho, porta ou parâmetros.');
 if(u.hostname==='localhost'||u.hostname.endsWith('.localhost')||u.hostname.endsWith('.internal'))
  throw fail(422,'Domínio público inválido.');
 return u.origin;
}
export async function createTrackingSite(pool,a,{origin,pixelId}={},options={}){
 permit(a,true);
 const site=siteOrigin(origin);
 if(!/^\d{6,30}$/.test(String(pixelId||'')))throw fail(422,'Pixel ID inválido.');
 const pixels=await (options.pixels||readAdvancedMetaTool)(pool,a,'pixels',{},options);
 if(!pixels?.items?.some(p=>p.id===pixelId))
  throw fail(409,pixels?.hasMore?'Há mais pixels na conta; selecione o pixel na lista completa.':
   'Pixel não encontrado na conta Meta selecionada.');
 const eventSecret=randomBytes(32).toString('base64url'),siteId=randomUUID();
 const encrypted=sealMarketingSecret('site-hmac:'+a.active_tenant_id+':'+siteId+':'+eventSecret,options.env||process.env);
 await pool.query("INSERT INTO socio_tracking_sites(id,tenant_id,owner_user_id,site_origin,pixel_id,signing_ciphertext,enabled) VALUES($1,$2,$3,$4,$5,$6,false)",
  [siteId,a.active_tenant_id,a.user_id,site,pixelId,encrypted]);
 return {siteId,origin:site,pixelId,enabled:false,signingSecret:eventSecret,
  note:'Credencial exibida uma única vez e destinada exclusivamente ao backend do site. Nunca cole em JavaScript de navegador. Eventos precisam ser habilitados e testados antes de usar CAPI.'};
}
export async function listTrackingSites(pool,a,{env=process.env}={}){
 permit(a);
 const sites=await pool.query("SELECT id,site_origin,pixel_id,enabled,created_at FROM socio_tracking_sites WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",[a.active_tenant_id]);
 return {sites:sites.rows,siteEventsEnabled:trackingActive(env),metaCapiEnabled:capiActive(env),
  note:'Site cadastrado não significa Pixel instalado. Event Manager, consentimento e fonte real de pagamento requerem validação.'};
}
export async function enableTrackingSite(pool,a,siteId,enabled,{env=process.env}={}){
 permit(a,true);
 if(!idPattern.test(String(siteId||''))||typeof enabled!=='boolean')throw fail(422,'Configuração de site inválida.');
 if(enabled&&!trackingActive(env))throw fail(503,'Coleta de eventos de sites ainda não habilitada.');
 const r=await pool.query("UPDATE socio_tracking_sites SET enabled=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,enabled",
  [siteId,a.active_tenant_id,enabled]);
 if(!r.rows.length)throw fail(404,'Site não encontrado na sua empresa.');
 return r.rows[0];
}
export function makeCapiEvent(data,{now=Date.now()}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||!acceptedNames.has(data.event_name))
  throw fail(422,'Evento inválido. Purchase exige confirmação autenticada do pagamento.');
 if(!idPattern.test(String(data.event_id||'')))throw fail(422,'Event ID deve ser UUID compartilhado entre Pixel e CAPI.');
 if(data.consent!==true)throw fail(403,'O site não confirmou consentimento para este evento.');
 const time=Number(data.event_time);
 if(!Number.isSafeInteger(time)||time*1000>now+300000||now-time*1000>6*86400000)
  throw fail(422,'Horário de evento inválido.');
 let source;try{source=new URL(data.event_source_url)}catch{throw fail(422,'URL de origem inválida.');}
 if(source.protocol!=='https:'||source.username||source.password||source.href.length>1600)
  throw fail(422,'Evento exige endereço HTTPS do próprio site.');
 // Remove URL query and hash, which may contain email, phone or tracking identifiers.
 // Consent parameters are never forwarded as URL text to Meta.
 source.search='';source.hash='';
 if(data.email!==undefined||data.phone!==undefined||data.em!==undefined||data.ph!==undefined)
  throw fail(422,'Não envie dados pessoais brutos pela API de telemetria.');
 const user={};
 if(typeof data.fbp==='string'&&/^fb\.1\.\d{10,14}\.[a-zA-Z0-9.]{3,100}$/.test(data.fbp))user.fbp=data.fbp;
 if(typeof data.fbc==='string'&&/^fb\.1\.\d{10,14}\.[a-zA-Z0-9_-]{3,200}$/.test(data.fbc))user.fbc=data.fbc;
 if(typeof data.user_agent==='string'&&data.user_agent.length<=450&&data.user_agent.length>=8)
  user.client_user_agent=data.user_agent;
 return {event_name:data.event_name,event_id:data.event_id,event_time:time,
  action_source:'website',event_source_url:source.href,user_data:user};
}
export function verifySiteEventSignature(raw,signature,timestamp,secret,{now=Date.now()}={}){
 if(!Buffer.isBuffer(raw)||raw.length>10000||!/^sha256=[0-9a-f]{64}$/.test(String(signature||''))||
   !/^\d{10,13}$/.test(String(timestamp||''))||typeof secret!=='string')throw fail(403,'Assinatura do site inválida.');
 const ts=Number(timestamp);
 if(!Number.isFinite(ts)||Math.abs(now-ts*1000)>300000)throw fail(403,'Assinatura do site expirada.');
 const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))
  throw fail(403,'Assinatura do site não confere.');
 return true;
}
function unsealSiteKey(site,env){
 const clear=openMarketingSecret(site.signing_ciphertext,env);
 const prefix='site-hmac:'+site.tenant_id+':'+site.id+':';
 if(!clear.startsWith(prefix))throw fail(403,'Chave de outra empresa.');
 return clear.slice(prefix.length);
}
async function sendMetaEvent(pool,site,event,{env=process.env,request=fetch}={}){
 const r=await pool.query(
  "SELECT token_encrypted,scopes FROM meta_official_grants WHERE tenant_id=$1 AND user_id=$2 AND expires_at>now()",
  [site.tenant_id,site.owner_user_id]);
 const grant=r.rows[0];if(!grant||!grant.scopes?.includes('ads_management'))
  throw fail(409,'Permissão Meta para envio CAPI não confirmada.');
 const token=JSON.parse(openMarketingSecret(grant.token_encrypted,env));
 if(token.tenant!==site.tenant_id||token.user!==site.owner_user_id)throw fail(403,'Credencial Meta de outra empresa.');
 const cfg=officialConfig(env);
 const proof=createHmac('sha256',cfg.secret).update(token.token).digest('hex');
 const url='https://graph.facebook.com/'+cfg.version+'/'+site.pixel_id+'/events';
 const payload={data:[event],...(env.SOCIO_META_CAPI_TEST_EVENT_CODE?{test_event_code:env.SOCIO_META_CAPI_TEST_EVENT_CODE}:{})};
 let response,data;
 try{response=await request(url,{method:'POST',headers:{Authorization:'Bearer '+token.token,'Content-Type':'application/json'},
  body:JSON.stringify({...payload,appsecret_proof:proof}),redirect:'error',signal:AbortSignal.timeout(12000)});
  data=await response.json();
 }catch{throw fail(503,'Entrega Meta CAPI incerta: não reenvie automaticamente.');}
 if(!response.ok||data?.events_received!==1)
  throw fail(503,'Meta não confirmou o evento CAPI. Consulte o Gerenciador de Eventos.');
 return {confirmed:true};
}
export async function receiveSignedSiteEvent(pool,raw,headers,{env=process.env,request=fetch,now=Date.now()}={}){
 if(!trackingActive(env))throw fail(503,'Coleta de eventos de sites desativada.');
 const siteId=String(headers['x-socio-site-id']||'');
 if(!idPattern.test(siteId))throw fail(403,'Identificador de site inválido.');
 const rows=await pool.query('SELECT id,tenant_id,owner_user_id,site_origin,pixel_id,signing_ciphertext,enabled FROM socio_tracking_sites WHERE id=$1',[siteId]);
 const site=rows.rows[0];
 if(!site?.enabled)throw fail(403,'Site não autorizado.');
 verifySiteEventSignature(raw,String(headers['x-socio-signature']||''),String(headers['x-socio-timestamp']||''),
  unsealSiteKey(site,env),{now});
 let body;try{body=JSON.parse(raw.toString('utf8'))}catch{throw fail(422,'Evento JSON inválido.');}
 const event=makeCapiEvent(body,{now});
 if(new URL(event.event_source_url).origin!==site.site_origin)throw fail(403,'Domínio de origem não corresponde ao cadastrado.');
 const eventRow=randomUUID();
 const saved=await pool.query(
  "INSERT INTO socio_tracking_events(id,tenant_id,site_id,event_id,event_name,event_time,status) VALUES($1,$2,$3,$4,$5,to_timestamp($6),'received') "+
  "ON CONFLICT(site_id,event_name,event_id) DO NOTHING RETURNING id",
  [eventRow,site.tenant_id,site.id,event.event_id,event.event_name,event.event_time]);
 if(!saved.rowCount)return {received:true,duplicate:true,delivered:false};
 // No PII matching data => no server event sent, even if CAPI flag was enabled.
 const canSend=capiActive(env)&&Boolean(event.user_data.fbc||event.user_data.fbp);
 if(!canSend)return {received:true,duplicate:false,delivered:false,
  note:'Evento registrado apenas no Sócio. CAPI desativada ou sem dados de identificação consentidos.'};
 try{
  await sendMetaEvent(pool,site,event,{env,request});
  await pool.query("UPDATE socio_tracking_events SET status='sent' WHERE id=$1 AND tenant_id=$2",[eventRow,site.tenant_id]);
  return {received:true,delivered:true};
 }catch(e){
  await pool.query("UPDATE socio_tracking_events SET status='uncertain',error_code=$3 WHERE id=$1 AND tenant_id=$2",
   [eventRow,site.tenant_id,String(e?.status||'CAPI_UNCERTAIN')]);
  return {received:true,delivered:false,uncertain:true,
   note:'A Meta não confirmou a entrega; o Sócio não reenviará automaticamente.'};
 }
}
