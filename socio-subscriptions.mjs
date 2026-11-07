// Sócio SaaS subscription gateway. Disabled by default.
// Does not alter tenant access, send notifications or charge without an
// authenticated, explicit Checkout action and separate Stripe approval.
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';

const fault=(status,message)=>Object.assign(new Error(message),{status});
const VALID_PLANS=new Set(['essencial','equipe','voz']);
const STATES=new Set(['trialing','active','past_due','unpaid','paused','canceled','incomplete','incomplete_expired']);
const stripeId=(s,prefix)=>typeof s==='string'&&new RegExp('^'+prefix+'_[a-zA-Z0-9]{8,100}$').test(s);
const PLAN_KEYS={essencial:'SOCIO_STRIPE_PRICE_ESSENCIAL',equipe:'SOCIO_STRIPE_PRICE_EQUIPE',voz:'SOCIO_STRIPE_PRICE_VOZ'};
export function billingConfiguration(env=process.env){
 const key=env.SOCIO_STRIPE_SECRET_KEY||'';
 const live=key.startsWith('sk_live_'),test=key.startsWith('sk_test_');
 const origin=env.SOCIO_PUBLIC_URL||'';
 let https=false;
 try{const u=new URL(origin);https=u.protocol==='https:'&&Boolean(u.hostname)&&!u.username&&!u.password;}catch{}
 const prices=Object.fromEntries(Object.entries(PLAN_KEYS).map(([p,k])=>[p,stripeId(env[k],'price')]));
 const hasWebhook=typeof env.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET==='string'&&
  env.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET.startsWith('whsec_');
 return {enabled:env.SOCIO_BILLING_ENABLED==='true'&&(live||test)&&hasWebhook&&https,
  mode:live?'live':test?'test':'unconfigured',hasWebhook,https,
  plans:prices,
  blockers:[
   ...(!['true'].includes(env.SOCIO_BILLING_ENABLED)?['Habilitação explícita do billing pendente.']:[]),
   ...(!(live||test)?['Chave Stripe de assinatura não configurada.']:[]),
   ...(!hasWebhook?['Webhook de assinaturas Stripe não configurado.']:[]),
   ...(!https?['URL HTTPS do Sócio não configurada.']:[])
  ]};
}
function mustWrite(actor){
 requirePermission(actor,'sales.manage');
 if(actor.tenant_status==='paused')throw fault(403,'Empresa pausada.');
 if(!actor.active_tenant_id)throw fault(403,'Empresa não selecionada.');
}
function stripeForm(url,params,{env=process.env,fetcher=fetch,idempotencyKey=null}={}){
 const key=env.SOCIO_STRIPE_SECRET_KEY||'';
 if(!/^sk_(?:live|test)_/.test(key))throw fault(503,'Stripe não configurado para assinatura.');
 const headers={Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'};
 if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
 return fetcher('https://api.stripe.com/v1/'+url,{method:'POST',headers,body:new URLSearchParams(params),signal:AbortSignal.timeout(10000)})
  .then(async r=>{
   let data;try{data=await r.json()}catch{throw fault(503,'Stripe retornou resposta inválida.')}
   if(!r.ok)throw fault(503,'Não foi possível criar uma sessão Stripe. Consulte a configuração da conta.');
   return data;
  });
}
export async function readSubscriptionStatus(pool,actor,{env=process.env,now=new Date()}={}){
 requirePermission(actor,'audit.read');
 if(!actor.active_tenant_id)throw fault(403,'Empresa não selecionada.');
 const [tenant,billing]=await Promise.all([
  pool.query('SELECT id,plan,status,created_at FROM tenants WHERE id=$1',[actor.active_tenant_id]),
  pool.query('SELECT subscription_status,period_end,paid_invoices_count,paid_amount_cents,last_paid_at FROM socio_billing_accounts WHERE tenant_id=$1',[actor.active_tenant_id])
 ]);
 if(!tenant.rows[0])throw fault(404,'Empresa não encontrada.');
 const t=tenant.rows[0],cfg=billingConfiguration(env),end=new Date(new Date(t.created_at).getTime()+7*86400000);
 const billingRow=billing.rows[0]||null;
 return {tenantStatus:t.status,plan:t.plan,
  trial:{endsAt:end.toISOString(),calendarExpired:new Date(now)>=end,
   daysRemaining:t.status==='trial'?Math.max(0,Math.ceil((end-new Date(now))/86400000)):null,
   automaticallySuspended:false},
  subscription:{status:billingRow?.subscription_status||'not_started',
   periodEnd:billingRow?.period_end||null,
   paidInvoices:billingRow?.paid_invoices_count||0,
   verifiedAmountCents:String(billingRow?.paid_amount_cents||'0'),
   lastPaidAt:billingRow?.last_paid_at||null},
  checkout:{available:cfg.enabled&&Boolean(cfg.plans[t.plan]),environment:cfg.mode,
   priceConfigured:!!cfg.plans[t.plan],blockers:cfg.blockers},
  note:'Cobranças são opt-in pelo Checkout oficial; conta ativa não prova assinatura paga. Nenhum cliente é bloqueado automaticamente.'};
}
export async function createSubscriptionCheckout(pool,actor,{env=process.env,fetcher=fetch,now=new Date()}={}){
 mustWrite(actor);
 const cfg=billingConfiguration(env);
 if(!cfg.enabled)throw fault(503,'Assinaturas indisponíveis: confira as configurações Stripe.');
 const tenant=actor.active_tenant_id;
 const [{rows:tenants},{rows:accounts},{rows:owners}]=await Promise.all([
  pool.query('SELECT id,name,plan,status,created_at FROM tenants WHERE id=$1',[tenant]),
  pool.query('SELECT stripe_customer_id,stripe_subscription_id,subscription_status,stripe_checkout_session_id FROM socio_billing_accounts WHERE tenant_id=$1',[tenant]),
  pool.query('SELECT email FROM users WHERE id=$1 AND tenant_id=$2 AND active=true',[actor.user_id,tenant])
 ]);
 const t=tenants[0],old=accounts[0],email=owners[0]?.email;
 if(!t||!VALID_PLANS.has(t.plan)||!cfg.plans[t.plan]||!email)throw fault(503,'Plano ou cadastro de cobrança incompleto.');
 if(['active','trialing','past_due','unpaid'].includes(old?.subscription_status))
  throw fault(409,'Assinatura existente: utilize o portal de cobrança em vez de contratar outra.');
 if(old?.subscription_status==='checkout_pending')
  throw fault(409,'Existe uma sessão Checkout pendente; conclua ou solicite atendimento para renovar a sessão.');
 const base=new URL(env.SOCIO_PUBLIC_URL).origin;
 const trialEnd=new Date(t.created_at).getTime()+7*86400000;
 const secondsLeft=Math.floor((trialEnd-new Date(now))/1000);
 const params={
  mode:'subscription','line_items[0][price]':env[PLAN_KEYS[t.plan]],
  'line_items[0][quantity]':'1',
  'client_reference_id':tenant,
  'metadata[tenant_id]':tenant,'metadata[plan]':t.plan,
  'subscription_data[metadata][tenant_id]':tenant,
  success_url:base+'/?billing=checkout_complete&session_id={CHECKOUT_SESSION_ID}',
  cancel_url:base+'/?billing=cancelled',
  allow_promotion_codes:'false',
  ...(old?.stripe_customer_id?{customer:old.stripe_customer_id}:{customer_email:email})
 };
 // Stripe requires a future trial end at least 48h ahead.
 // Never grant a second 7-day trial after the original signup window.
 if(secondsLeft>=48*3600)params['subscription_data[trial_end]']=String(Math.floor(trialEnd/1000));
 const sid='socio-subscribe-'+tenant+'-'+t.plan+'-'+Math.floor(new Date(now).getTime()/3600000);
 const session=await stripeForm('checkout/sessions',params,{env,fetcher,idempotencyKey:sid});
 if(!stripeId(session.id,'cs')||typeof session.url!=='string'||!session.url.startsWith('https://checkout.stripe.com/'))
  throw fault(503,'Checkout Stripe inválido.');
 // Do not replace an active subscription if another request won the race.
 const upd=await pool.query(
  "INSERT INTO socio_billing_accounts(tenant_id,stripe_checkout_session_id,subscription_status) VALUES($1,$2,'checkout_pending') "+
  "ON CONFLICT(tenant_id) DO UPDATE SET stripe_checkout_session_id=EXCLUDED.stripe_checkout_session_id,"+
  "subscription_status='checkout_pending',updated_at=now() WHERE socio_billing_accounts.subscription_status NOT IN "+
  "('active','trialing','past_due','unpaid') RETURNING tenant_id",[tenant,session.id]);
 if(!upd.rowCount)throw fault(409,'O estado da assinatura mudou; confira no painel de cobrança.');
 return {checkoutUrl:session.url,environment:cfg.mode,plan:t.plan,trialDaysRemaining:Math.max(0,Math.ceil(secondsLeft/86400)),
  note:'O cliente deve aceitar os valores, prazos e método de pagamento no Checkout Stripe. Não houve cobrança nesta chamada.'};
}
export async function createBillingPortal(pool,actor,{env=process.env,fetcher=fetch}={}){
 mustWrite(actor);
 if(!billingConfiguration(env).enabled)throw fault(503,'Portal de assinaturas indisponível.');
 const r=await pool.query('SELECT stripe_customer_id FROM socio_billing_accounts WHERE tenant_id=$1',[actor.active_tenant_id]);
 const customer=r.rows[0]?.stripe_customer_id;
 if(!stripeId(customer,'cus'))throw fault(409,'Nenhum cliente Stripe confirmado para esta empresa.');
 const base=new URL(env.SOCIO_PUBLIC_URL).origin;
 const session=await stripeForm('billing_portal/sessions',{customer,return_url:base+'/?billing=portal_return'},{env,fetcher});
 if(!session.url?.startsWith('https://billing.stripe.com/'))throw fault(503,'Portal Stripe inválido.');
 return {portalUrl:session.url};
}
export function verifyStripeBillingSignature(raw,header,secret,{now=Date.now()}={}){
 if(!Buffer.isBuffer(raw)||raw.length>300000||typeof header!=='string'||!secret?.startsWith('whsec_'))
  throw fault(400,'Assinatura inválida.');
 const t=/\bt=(\d{9,13})\b/.exec(header)?.[1],v=[...header.matchAll(/\bv1=([0-9a-f]{64})\b/g)].map(x=>x[1]);
 const ts=Number(t);
 if(!Number.isFinite(ts)||Math.abs(now-ts*1000)>300000||!v.length)throw fault(400,'Assinatura Stripe expirada ou ausente.');
 const expected=createHmac('sha256',secret).update(t+'.').update(raw).digest();
 if(!v.some(sig=>timingSafeEqual(Buffer.from(sig,'hex'),expected)))throw fault(400,'Assinatura Stripe incorreta.');
 try{return JSON.parse(raw.toString('utf8'))}catch{throw fault(400,'Evento Stripe malformado.')}
}
export async function processSubscriptionWebhook(pool,raw,signature,{env=process.env,now=Date.now()}={}){
 const cfg=billingConfiguration(env);
 if(!cfg.enabled)throw fault(503,'Webhook de assinatura desabilitado.');
 const event=verifyStripeBillingSignature(raw,signature,env.SOCIO_STRIPE_BILLING_WEBHOOK_SECRET,{now});
 if(!stripeId(event.id,'evt')||typeof event.type!=='string'||!event.data?.object)throw fault(400,'Evento Stripe inválido.');
 if(event.livemode!==(cfg.mode==='live'))throw fault(400,'Ambiente de pagamento divergente.');
 const obj=event.data.object;
 const relevant=new Set(['checkout.session.completed','customer.subscription.created',
  'customer.subscription.updated','customer.subscription.deleted','invoice.paid']);
 if(!relevant.has(event.type))return {received:true,ignored:true};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const inserted=await c.query('INSERT INTO socio_billing_webhook_events(event_id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',[event.id,event.type]);
  if(!inserted.rowCount){await c.query('COMMIT');return {received:true,duplicate:true};}
  const isCheckout=event.type==='checkout.session.completed',isSubscription=event.type.startsWith('customer.subscription.');
  let tenantId=isCheckout?obj.client_reference_id:isSubscription?obj.metadata?.tenant_id:null;
  const customer=obj.customer,sub=isCheckout?obj.subscription:isSubscription?obj.id:obj.subscription;
  if(!stripeId(customer,'cus')||!stripeId(sub,'sub'))throw fault(400,'Referência de assinatura incompleta.');
  if(!tenantId&&event.type==='invoice.paid'){
   const lookup=await c.query('SELECT tenant_id FROM socio_billing_accounts WHERE stripe_subscription_id=$1 AND stripe_customer_id=$2',[sub,customer]);
   tenantId=lookup.rows[0]?.tenant_id;
  }
  if(!/^[0-9a-f-]{36}$/i.test(String(tenantId||'')))throw fault(400,'Assinatura sem tenant autorizado.');
  const account=await c.query('SELECT stripe_customer_id,stripe_subscription_id,subscription_status,last_subscription_event_created,last_paid_invoice_id FROM socio_billing_accounts WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
  const previous=account.rows[0];
  if(previous?.stripe_customer_id&&previous.stripe_customer_id!==customer)throw fault(409,'Cliente Stripe divergente.');
  if(previous?.stripe_subscription_id&&previous.stripe_subscription_id!==sub)throw fault(409,'Assinatura Stripe divergente.');
  if(isCheckout){
   // Checkout completion does not constitute invoice payment or activation.
   await c.query("INSERT INTO socio_billing_accounts(tenant_id,stripe_customer_id,stripe_subscription_id,subscription_status) VALUES($1,$2,$3,'checkout_pending') "+
    "ON CONFLICT(tenant_id) DO UPDATE SET stripe_customer_id=$2,stripe_subscription_id=$3,updated_at=now()",
    [tenantId,customer,sub]);
  }else if(isSubscription){
   const status=event.type==='customer.subscription.deleted'?'canceled':obj.status;
   if(!STATES.has(status))throw fault(422,'Situação Stripe não reconhecida.');
   const created=Number(event.created)||0;
   if(created>Number(previous?.last_subscription_event_created||0)){
    await c.query("INSERT INTO socio_billing_accounts(tenant_id,stripe_customer_id,stripe_subscription_id,subscription_status,period_end,last_subscription_event_created) "+
     "VALUES($1,$2,$3,$4,to_timestamp($5),$6) ON CONFLICT(tenant_id) DO UPDATE SET stripe_customer_id=$2,stripe_subscription_id=$3,subscription_status=$4,period_end=to_timestamp($5),last_subscription_event_created=$6,updated_at=now()",
     [tenantId,customer,sub,status,Number(obj.current_period_end)||0,created]);
   }
  }else if(event.type==='invoice.paid'){
   const cents=Number(obj.amount_paid);
   if(Number.isSafeInteger(cents)&&cents>0&&obj.currency==='brl'&&stripeId(obj.id,'in')&&previous?.last_paid_invoice_id!==obj.id){
    await c.query("UPDATE socio_billing_accounts SET paid_invoices_count=paid_invoices_count+1,paid_amount_cents=paid_amount_cents+$2,last_paid_invoice_id=$3,last_paid_at=now(),updated_at=now() WHERE tenant_id=$1",
     [tenantId,cents,obj.id]);
   }
  }
  await c.query('UPDATE socio_billing_webhook_events SET tenant_id=$2 WHERE event_id=$1',[event.id,tenantId]);
  await c.query('COMMIT');
  return {received:true,updated:true};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
 finally{c.release();}
}
