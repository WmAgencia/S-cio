// Tenant-scoped supervised sales. Quotes do not send messages or charge buyers.
import {randomUUID,randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';

const bad=(status,message)=>Object.assign(new Error(message),{status});
const uuid=()=>randomUUID();
const validId=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const validToken=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const value=x=>String(x??'').trim();
const numbered=x=>Number.isSafeInteger(x)&&x>0;
const quoteStatuses=new Set(['draft','issued']);
export const stripeTestReady=(env=process.env)=>/^sk_test_[A-Za-z0-9_]+$/.test(env.STRIPE_SECRET_KEY||'')&&/^whsec_[^\s]+$/.test(env.STRIPE_WEBHOOK_SECRET||'')&&/^https:\/\//.test(env.SOCIO_PUBLIC_URL||'');
export function verifyStripeSignature(raw,header,secret,now=Date.now()){
 if(!Buffer.isBuffer(raw)||!secret||!header)return false;
 const parts=String(header).split(',').map(s=>s.trim().split('='));
 const ts=parts.find(x=>x[0]==='t')?.[1],signatures=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
 if(!/^\d{10,13}$/.test(ts||'')||!signatures.length)return false;
 const ms=Number(ts)*1000;
 if(Math.abs(now-ms)>300000)return false;
 const digest=createHmac('sha256',secret).update(ts+'.').update(raw).digest('hex');
 return signatures.some(s=>{
  if(!/^[0-9a-f]{64}$/i.test(s))return false;
  return timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(s,'hex'));
 });
}
export function parseQuoteInput(data){
 if(!data||!validId(data.conversationId)||!Array.isArray(data.items)||data.items.length<1||data.items.length>15)throw bad(422,'Selecione uma conversa e de 1 a 15 itens.');
 if(data.seriesId!=null&&!validId(data.seriesId))throw bad(422,'Identificador da revisão inválido.');
 const seen=new Set();
 const items=data.items.map(x=>{
  if(!validId(x?.productId)||(x.variantId!=null&&!validId(x.variantId))||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>100)
   throw bad(422,'Produto, variação ou quantidade inválidos.');
  const key=x.productId+':'+(x.variantId||'');
  if(seen.has(key))throw bad(422,'Não repita produtos: ajuste a quantidade do item.');
  seen.add(key);
  return {productId:x.productId,variantId:x.variantId||null,quantity:x.quantity};
 });
 return {conversationId:data.conversationId,seriesId:data.seriesId||null,items};
}
async function snapshotItem(c,tenant,item){
 const p=await c.query(
  'SELECT id,name,sku,price_cents,stock_quantity,active FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
  [tenant,item.productId]);
 if(!p.rowCount||!p.rows[0].active)throw bad(422,'Produto não encontrado ou inativo.');
 const product=p.rows[0];
 const variations=await c.query('SELECT COUNT(*)::int AS n FROM product_variants WHERE tenant_id=$1 AND product_id=$2 AND active=true',[tenant,item.productId]);
 let selected=product;
 if(item.variantId){
  const v=await c.query('SELECT id,name,sku,price_cents,stock_quantity,active FROM product_variants WHERE tenant_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE',
   [tenant,item.productId,item.variantId]);
  if(!v.rowCount||!v.rows[0].active)throw bad(422,'Variação inexistente ou inativa.');
  selected=v.rows[0];
 }else if(variations.rows[0].n)throw bad(422,'Selecione uma variação para este produto.');
 if(selected.stock_quantity!==null&&Number(selected.stock_quantity)<item.quantity)throw bad(409,'Estoque insuficiente para '+product.name+'.');
 return {productId:product.id,variantId:item.variantId,sku:selected.sku||null,name:product.name,
  variantName:item.variantId?selected.name:null,quantity:item.quantity,unitPriceCents:selected.price_cents,
  totalCents:selected.price_cents*item.quantity};
}
export async function createQuote(pool,tenant,userId,data){
 const input=parseQuoteInput(data),c=await pool.connect();
 try{
  await c.query('BEGIN');
  const conversation=await c.query('SELECT id FROM conversations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,input.conversationId]);
  if(!conversation.rowCount)throw bad(404,'Conversa não encontrada nesta empresa.');
  const snapshots=[];
  for(const item of input.items)snapshots.push(await snapshotItem(c,tenant,item));
  const amount=snapshots.reduce((sum,x)=>sum+x.totalCents,0);
  if(!numbered(amount)||amount>=100000000)throw bad(422,'O orçamento precisa ter valor positivo e inferior ao limite.');
  const seriesId=input.seriesId||uuid();
  let version=1;
  if(input.seriesId){
   const latest=await c.query('SELECT id,version,status,conversation_id FROM sales_quotes WHERE tenant_id=$1 AND series_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',[tenant,seriesId]);
   if(!latest.rowCount||latest.rows[0].conversation_id!==input.conversationId)throw bad(404,'Orçamento original não encontrado nesta conversa.');
   if(!quoteStatuses.has(latest.rows[0].status))throw bad(409,'Orçamento aprovado ou encerrado não pode ser substituído.');
   version=latest.rows[0].version+1;
   await c.query("UPDATE sales_quotes SET status='superseded',token_hash=NULL,updated_at=now() WHERE tenant_id=$1 AND series_id=$2 AND status IN ('draft','issued')",[tenant,seriesId]);
  }
  const result=await c.query(
   "INSERT INTO sales_quotes(id,tenant_id,conversation_id,series_id,version,status,amount_cents,items,created_by) "+
   "VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8) RETURNING id,series_id,version,status,amount_cents",
   [uuid(),tenant,input.conversationId,seriesId,version,amount,JSON.stringify(snapshots),userId]);
  await c.query('COMMIT');
  return result.rows[0];
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function issueQuote(pool,tenant,quoteId){
 if(!validId(quoteId))throw bad(404,'Orçamento não encontrado.');
 const token=randomBytes(32).toString('hex'),c=await pool.connect();
 try{
  await c.query('BEGIN');
  const q=await c.query('SELECT id,status FROM sales_quotes WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,quoteId]);
  if(!q.rowCount)throw bad(404,'Orçamento não encontrado nesta empresa.');
  if(!quoteStatuses.has(q.rows[0].status))throw bad(409,'Este orçamento não pode ser enviado.');
  const r=await c.query(
   "UPDATE sales_quotes SET status='issued',token_hash=$3,expires_at=now()+interval '7 days',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,expires_at",
   [tenant,quoteId,hash(token)]);
  await c.query('COMMIT');
  return {id:r.rows[0].id,expiresAt:r.rows[0].expires_at,path:'/quote.html#'+token,
   note:'Copie o link e envie ao cliente somente por um canal autorizado. Links anteriores desta versão são invalidados.'};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function cancelQuote(pool,tenant,quoteId){
 const q=await pool.query("UPDATE sales_quotes SET status='cancelled',token_hash=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status IN ('draft','issued') RETURNING id",[tenant,quoteId]);
 if(!q.rowCount)throw bad(409,'Orçamento não encontrado ou já encerrado.');
 return {id:quoteId,status:'cancelled'};
}
export async function publicQuote(pool,token){
 if(!validToken(token))throw bad(404,'Link de orçamento inválido.');
 const r=await pool.query(
  "SELECT q.id,q.series_id,q.version,q.status,q.amount_cents,q.items,q.expires_at,q.buyer_name,t.name AS business_name,o.id AS order_id,o.status AS order_status "+
  "FROM sales_quotes q JOIN tenants t ON t.id=q.tenant_id LEFT JOIN sales_orders o ON o.tenant_id=q.tenant_id AND o.quote_id=q.id "+
  "WHERE q.token_hash=$1",[hash(token)]);
 if(!r.rowCount)throw bad(404,'Orçamento não encontrado ou link substituído.');
 const q=r.rows[0];
 if(q.status==='issued'&&new Date(q.expires_at).getTime()<=Date.now())return {...q,status:'expired',paymentTestAvailable:false};
 return {...q,paymentTestAvailable:stripeTestReady()};
}
export async function approveQuote(pool,token,name,consent){
 if(!validToken(token))throw bad(404,'Link de orçamento inválido.');
 const buyer=value(name);
 if(!consent||buyer.length<2||buyer.length>100)throw bad(422,'Informe seu nome e confirme que aprova este orçamento.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const rows=await c.query('SELECT * FROM sales_quotes WHERE token_hash=$1 FOR UPDATE',[hash(token)]);
  if(!rows.rowCount)throw bad(404,'Orçamento não encontrado.');
  const quote=rows.rows[0];
  if(quote.status==='accepted'){
   const prior=await c.query('SELECT id,status FROM sales_orders WHERE tenant_id=$1 AND quote_id=$2',[quote.tenant_id,quote.id]);
   await c.query('COMMIT');return {id:prior.rows[0].id,status:prior.rows[0].status,alreadyApproved:true};
  }
  if(quote.status!=='issued'||new Date(quote.expires_at).getTime()<=Date.now())
   throw bad(409,'Este orçamento expirou ou foi substituído.');
  for(const item of quote.items)await snapshotStock(c,quote.tenant_id,item);
  const order=await c.query(
   "INSERT INTO sales_orders(id,tenant_id,quote_id,conversation_id,customer_name,amount_cents,items,status) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7,'pending_payment') RETURNING id,status",
   [uuid(),quote.tenant_id,quote.id,quote.conversation_id,buyer,quote.amount_cents,JSON.stringify(quote.items)]);
  await c.query("UPDATE sales_quotes SET status='accepted',buyer_name=$2,accepted_at=now(),updated_at=now() WHERE id=$1",[quote.id,buyer]);
  await c.query('COMMIT');return order.rows[0];
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
async function snapshotStock(c,tenant,item){
 const v=item.variantId?
  await c.query('SELECT stock_quantity,active FROM product_variants WHERE id=$1 AND tenant_id=$2 AND product_id=$3 FOR UPDATE',[item.variantId,tenant,item.productId]):
  await c.query('SELECT stock_quantity,active FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[item.productId,tenant]);
 if(!v.rowCount||!v.rows[0].active||v.rows[0].stock_quantity!==null&&Number(v.rows[0].stock_quantity)<item.quantity)
  throw bad(409,'Estoque alterado desde o orçamento. Peça uma nova proposta à empresa.');
}
export async function declineQuote(pool,token){
 if(!validToken(token))throw bad(404,'Link inválido.');
 const r=await pool.query("UPDATE sales_quotes SET status='declined',updated_at=now() WHERE token_hash=$1 AND status='issued' AND expires_at>now() RETURNING id",[hash(token)]);
 if(!r.rowCount)throw bad(409,'Orçamento indisponível para recusa.');
 return {status:'declined'};
}
export async function listSales(pool,tenant){
 const [quotes,orders]=await Promise.all([
  pool.query("SELECT q.id,q.series_id,q.version,q.conversation_id,q.status,q.amount_cents,q.items,q.expires_at,q.created_at,c.customer_name,c.customer_phone "+
   "FROM sales_quotes q JOIN conversations c ON c.tenant_id=q.tenant_id AND c.id=q.conversation_id WHERE q.tenant_id=$1 ORDER BY q.created_at DESC LIMIT 120",[tenant]),
  pool.query('SELECT id,quote_id,conversation_id,customer_name,amount_cents,status,created_at,paid_at FROM sales_orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 120',[tenant])
 ]);
 return {quotes:quotes.rows,orders:orders.rows,paymentTestAvailable:stripeTestReady()};
}
function publicOrigin(env=process.env){
 const raw=env.SOCIO_PUBLIC_URL;
 try{
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();
  return u.origin;
 }catch{throw bad(503,'Configure SOCIO_PUBLIC_URL com a origem HTTPS do Sócio para habilitar testes Stripe.');}
}
export async function createTestCheckout(pool,token,{env=process.env,fetchImpl=fetch}={}){
 if(!stripeTestReady(env))throw bad(503,'Pagamento de teste não configurado. Nenhuma cobrança foi feita.');
 const quote=await publicQuote(pool,token);
 if(quote.status!=='accepted'||!quote.order_id)throw bad(409,'Aprove o orçamento antes de acessar o pagamento de teste.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const rows=await c.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[quote.order_id]);
  const order=rows.rows[0];
  if(!order||order.status!=='pending_payment')throw bad(409,'Pedido não está aguardando pagamento de teste.');
  if(order.payment_url&&order.payment_session_id){
   await c.query('COMMIT');return {url:order.payment_url,testMode:true};
  }
  const form=new URLSearchParams({
   mode:'payment',
   success_url:publicOrigin(env)+'/quote.html#'+token,
   cancel_url:publicOrigin(env)+'/quote.html#'+token,
   client_reference_id:order.id,
   'metadata[order_id]':order.id,
   'metadata[tenant_id]':order.tenant_id,
   'payment_intent_data[metadata][order_id]':order.id,
   'payment_intent_data[metadata][tenant_id]':order.tenant_id
  });
  order.items.forEach((item,index)=>{
   const prefix='line_items['+index+']';
   form.set(prefix+'[price_data][currency]','brl');
   form.set(prefix+'[price_data][unit_amount]',String(item.unitPriceCents));
   form.set(prefix+'[price_data][product_data][name]',(item.name+(item.variantName?' — '+item.variantName:'')).slice(0,120));
   form.set(prefix+'[quantity]',String(item.quantity));
  });
  const r=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
   method:'POST',
   headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,
    'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'socio-test-'+order.id},
   body:form.toString(),signal:AbortSignal.timeout(12000)
  });
  if(!r.ok)throw bad(503,'Provedor de pagamento de teste indisponível. Nenhuma confirmação registrada.');
  const result=await r.json();
  if(!/^cs_test_/.test(result.id||'')||!/^https:\/\/checkout\.stripe\.com\//.test(result.url||''))
   throw bad(503,'Checkout não foi reconhecido como teste.');
  await c.query("UPDATE sales_orders SET payment_provider='stripe_test',payment_session_id=$2,payment_url=$3 WHERE id=$1",
   [order.id,result.id,result.url]);
  await c.query('COMMIT');return {url:result.url,testMode:true};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function processStripeTestEvent(pool,raw,signature,{env=process.env}={}){
 if(!stripeTestReady(env)||!verifyStripeSignature(raw,signature,env.STRIPE_WEBHOOK_SECRET))
  throw bad(403,'Assinatura do webhook inválida.');
 let event;
 try{event=JSON.parse(raw.toString('utf8'));}catch{throw bad(400,'Evento inválido.');}
 if(event.livemode!==false)throw bad(403,'Pagamentos reais não são aceitos neste ambiente.');
 if(event.type!=='checkout.session.completed')return {ignored:true};
 const session=event.data?.object;
 if(!/^evt_[A-Za-z0-9_]+$/.test(event.id||'')||!session||session.payment_status!=='paid'||session.mode!=='payment')
  return {ignored:true};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const order=await c.query(
   "SELECT id,tenant_id,amount_cents,status,payment_provider FROM sales_orders WHERE id=$1 AND payment_session_id=$2 AND tenant_id=$3 FOR UPDATE",
   [session.metadata?.order_id,session.id,session.metadata?.tenant_id]);
  if(!order.rowCount||order.rows[0].payment_provider!=='stripe_test'||
     order.rows[0].amount_cents!==session.amount_total||String(session.currency||'').toLowerCase()!=='brl')
   throw bad(409,'Evento não corresponde ao pedido de teste.');
  const existing=await c.query('SELECT event_id FROM sales_payment_events WHERE event_id=$1',[event.id]);
  if(existing.rowCount){await c.query('COMMIT');return {duplicate:true};}
  await c.query('INSERT INTO sales_payment_events(event_id,order_id,provider) VALUES($1,$2,$3)',
   [event.id,order.rows[0].id,'stripe_test']);
  await c.query("UPDATE sales_orders SET status='paid_test',paid_at=now() WHERE id=$1 AND status='pending_payment'",[order.rows[0].id]);
  await c.query('COMMIT');return {ok:true,testMode:true};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
