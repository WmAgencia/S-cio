// Purchase-intent intake for the supervised sales queue. No automatic payment or sale confirmation.
import {randomUUID} from 'node:crypto';
import {isQuoteRequest} from './quote-requests.mjs';
const bad=(status,message)=>Object.assign(new Error(message),{status});
const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function isPurchaseIntent(body){
 const s=norm(body).slice(0,2000);
 if(!s||isQuoteRequest(s)||/\b(?:nao quero|nao vou|desisti|cancelar|cancela|nao posso|talvez|se eu|gostaria de saber|so pesquisando)\b/.test(s))return false;
 return /\b(?:quero comprar|vou comprar|vou levar|quero levar|pode separar|pode reservar|pode fechar|fechamos|fechado,? vou levar|fechar (?:o |meu )?pedido|quero (?:fazer|finalizar) (?:o |um )?pedido|vou ficar com|pode mandar (?:o )?pix|onde pago|como faco para pagar)\b/.test(s);
}
export function proposedQuantity(body){
 const s=norm(body);
 const found=s.match(/\b(\d{1,3})\s*(?:unidades?|pecas?|itens?|caixas?|kits?)\b/)||
  s.match(/\b(?:comprar|levar|pedir|reservar|separar)\s+(\d{1,3})\b/);
 if(found)return Math.min(100,Number(found[1]))||null;
 if(/\b(?:um|uma|1)\s+(?:unidade|peca|kit|caixa)\b/.test(s)||/\b(?:comprar|levar|pedir|reservar|separar)\s+(?:um|uma)\s+/.test(s))return 1;
 return null;
}
export async function scanSalesIntents(pool){
 const messages=await pool.query(
  "SELECT m.id,m.tenant_id,m.conversation_id,m.body,c.customer_name,c.customer_phone "+
  "FROM messages m JOIN tenants t ON t.id=m.tenant_id "+
  "JOIN conversations c ON c.id=m.conversation_id AND c.tenant_id=m.tenant_id "+
  "WHERE m.direction='inbound' AND m.created_at > now()-interval '48 hours' "+
  "AND COALESCE((t.features->>'quotes')::boolean,true)=true "+
  "AND NOT EXISTS(SELECT 1 FROM sale_intents si WHERE si.tenant_id=m.tenant_id AND si.inbound_message_id=m.id) "+
  "AND m.body ~* '(comprar|levar|separar|reservar|fechar|fechamos|pedido|pix|pagar)' "+
  "ORDER BY m.created_at DESC LIMIT 60"
 );
 let created=0;
 for(const m of messages.rows){
  if(!isPurchaseIntent(m.body))continue;
  const products=await pool.query(
   "SELECT p.id,p.name,p.price_cents,p.stock_quantity, "+
   "(SELECT count(*)::int FROM product_variants v WHERE v.tenant_id=p.tenant_id AND v.product_id=p.id AND v.active=true) AS variant_count "+
   "FROM products p WHERE p.tenant_id=$1 AND p.active=true LIMIT 500",[m.tenant_id]);
  const text=norm(m.body);
  const matches=products.rows.filter(p=>norm(p.name).length>=4&&text.includes(norm(p.name)));
  const quantity=proposedQuantity(m.body);
  // Ambiguous product, variation or quantity stays unpriced until operator review.
  const certain=matches.length===1&&quantity&&Number(matches[0].variant_count)===0&&
   (matches[0].stock_quantity===null||Number(matches[0].stock_quantity)>=quantity)&&
   Number(matches[0].price_cents)>0;
  const product=certain?matches[0]:null;
  const items=product?[{productId:product.id,variantId:null,name:product.name,quantity,
   unitPriceCents:product.price_cents,totalCents:product.price_cents*quantity}]:[];
  const amount=product?Number(product.price_cents)*quantity:null;
  const result=await pool.query(
   "INSERT INTO sale_intents(id,tenant_id,conversation_id,inbound_message_id,customer_name,customer_phone,summary,items,amount_cents) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,inbound_message_id) DO NOTHING RETURNING id",
   [randomUUID(),m.tenant_id,m.conversation_id,m.id,String(m.customer_name||'').slice(0,100),
    String(m.customer_phone||'').slice(0,30),String(m.body||'').trim().slice(0,800),
    JSON.stringify(items),amount]);
  if(result.rowCount)created++;
 }
 return {scanned:messages.rowCount,created};
}
export async function listSaleIntents(pool,tenant){
 const r=await pool.query(
  "SELECT id,conversation_id,customer_name,customer_phone,summary,items,amount_cents,status,created_at,updated_at "+
  "FROM sale_intents WHERE tenant_id=$1 ORDER BY CASE WHEN status='pending' THEN 0 WHEN status='contacted' THEN 1 ELSE 2 END,created_at DESC LIMIT 150",
  [tenant]);
 return r.rows;
}
export async function updateSaleIntent(pool,tenant,leadId,data){
 if(!validId(leadId)||!data||typeof data!=='object'||Array.isArray(data))throw bad(422,'Dados da oportunidade inválidos.');
 const status=data.status;
 if(status!==undefined&&!['pending','contacted','completed','dismissed'].includes(status))throw bad(422,'Situação inválida.');
 const hasItems=Object.hasOwn(data,'items');
 if(!hasItems&&status===undefined)throw bad(422,'Nenhuma alteração informada.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const lead=await c.query('SELECT id,status FROM sale_intents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,leadId]);
  if(!lead.rowCount)throw bad(404,'Oportunidade de venda não encontrada.');
  let items=null,amount=null;
  if(hasItems){
   if(!Array.isArray(data.items)||!data.items.length||data.items.length>15)throw bad(422,'Selecione de 1 a 15 itens.');
   const keys=new Set();items=[];
   for(const entry of data.items){
    if(!validId(entry?.productId)||(entry.variantId!=null&&!validId(entry.variantId))||
      !Number.isInteger(entry.quantity)||entry.quantity<1||entry.quantity>100)throw bad(422,'Produto, variação ou quantidade inválidos.');
    const key=entry.productId+':'+(entry.variantId||'');
    if(keys.has(key))throw bad(422,'Produto repetido: ajuste a quantidade.');keys.add(key);
    const p=await c.query('SELECT id,name,price_cents,stock_quantity,active FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,entry.productId]);
    if(!p.rowCount||!p.rows[0].active)throw bad(422,'Produto indisponível no catálogo.');
    const item=p.rows[0];
    const count=await c.query('SELECT count(*)::int AS count FROM product_variants WHERE tenant_id=$1 AND product_id=$2 AND active=true',[tenant,entry.productId]);
    let variant=null;
    if(entry.variantId){
     const v=await c.query('SELECT id,name,price_cents,stock_quantity,active FROM product_variants WHERE tenant_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE',[tenant,entry.productId,entry.variantId]);
     if(!v.rowCount||!v.rows[0].active)throw bad(422,'Variação indisponível.');
     variant=v.rows[0];
    }else if(Number(count.rows[0].count)>0)throw bad(422,'Escolha a variação do produto.');
    const priced=variant||item;
    if(priced.stock_quantity!==null&&Number(priced.stock_quantity)<entry.quantity)throw bad(409,'Estoque insuficiente para '+item.name+'.');
    items.push({productId:item.id,variantId:variant?.id||null,name:item.name,
     variantName:variant?.name||null,quantity:entry.quantity,unitPriceCents:Number(priced.price_cents),
     totalCents:Number(priced.price_cents)*entry.quantity});
   }
   amount=items.reduce((total,item)=>total+item.totalCents,0);
   if(!Number.isSafeInteger(amount)||amount<=0||amount>=100000000)throw bad(422,'Valor total inválido.');
  }
  const updated=await c.query(
   "UPDATE sale_intents SET status=COALESCE($3,status),items=COALESCE($4::jsonb,items),amount_cents=CASE WHEN $4::jsonb IS NULL THEN amount_cents ELSE $5 END,updated_at=now() "+
   "WHERE tenant_id=$1 AND id=$2 RETURNING id,status,items,amount_cents,conversation_id",
   [tenant,leadId,status||null,items===null?null:JSON.stringify(items),amount]);
  await c.query('COMMIT');return updated.rows[0];
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
 finally{c.release();}
}
