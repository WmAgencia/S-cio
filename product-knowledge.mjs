// One factual Markdown document per product.
// The document is always rebuilt from tenant-scoped rows, never written by a
// model, so prices, stock and variations quoted to a customer cannot drift.
import {randomUUID} from 'node:crypto';

const money=cents=>'R$ '+(Number(cents||0)/100).toFixed(2).replace('.',',');
const oneLine=(value,max)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

export function productKnowledgeMarkdown({tenantName='',product,variants=[],media=[],campaigns=[],now=new Date()}){
 if(!product)throw new Error('Produto obrigatório para gerar a base de conhecimento.');
 const activeVariants=variants.filter(v=>v.active!==false);
 const lines=[
  '# Produto: '+oneLine(product.name,120),
  '',
  '- Empresa: '+oneLine(tenantName,120),
  '- Situação: '+(product.active===false?'inativo (não oferecer)':'ativo'),
  '- Preço: '+money(product.price_cents),
  '- Preço anterior: '+(product.compare_at_price_cents==null?'não informado':money(product.compare_at_price_cents)),
  '- SKU: '+(oneLine(product.sku,50)||'não informado'),
  '- Estoque: '+(product.stock_quantity==null?'não controlado':Number(product.stock_quantity)+' unidade(s)'),
  '- Atualizado em: '+now.toISOString().slice(0,10),
  '',
  '## Descrição',
  '',
  oneLine(product.description,1200)||'Sem descrição cadastrada.',
  '',
  '## Variações'
 ];
 if(activeVariants.length){
  for(const variant of activeVariants.slice(0,25)){
   lines.push('- '+oneLine(variant.name,100)+' | '+money(variant.price_cents)+
    ' | '+(variant.stock_quantity==null?'estoque não controlado':Number(variant.stock_quantity)+' em estoque')+
    (variant.sku?' | SKU '+oneLine(variant.sku,50):''));
  }
 }else lines.push('Nenhuma variação cadastrada.');
 lines.push('','## Fotos');
 if(media.length){
  lines.push(media.length===1?'Uma foto cadastrada:':media.length+' fotos cadastradas:');
  media.slice(0,8).forEach((item,index)=>{
   lines.push('- Foto '+(index+1)+': '+(oneLine(item.alt,200)||'sem descrição'));
  });
 }else lines.push('Nenhuma foto cadastrada.');
 lines.push('','## Campanhas vinculadas');
 if(campaigns.length){
  for(const campaign of campaigns.slice(0,20)){
   lines.push('- '+(campaign.provider==='google_ads'?'Google Ads':'Meta Ads')+
    (oneLine(campaign.label,120)?' — '+oneLine(campaign.label,120):'')+
    ' (ID '+oneLine(campaign.campaign_id,150)+')');
  }
 }else lines.push('Nenhuma campanha vinculada.');
 return lines.join('\n');
}

export async function syncProductKnowledge(db,{tenantId,productId,now=new Date()}={}){
 if(!tenantId||!productId)throw new Error('Empresa e produto são obrigatórios para gerar a base de conhecimento.');
 const [product,variants,media,campaigns,tenant]=await Promise.all([
  db.query('SELECT id,name,description,sku,price_cents,stock_quantity,compare_at_price_cents,active FROM products WHERE tenant_id=$1 AND id=$2',[tenantId,productId]),
  db.query('SELECT name,sku,price_cents,stock_quantity,active FROM product_variants WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at',[tenantId,productId]),
  db.query('SELECT id,alt FROM product_media WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at',[tenantId,productId]),
  db.query('SELECT provider,campaign_id,label FROM product_campaign_links WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at',[tenantId,productId]),
  db.query('SELECT name FROM tenants WHERE id=$1',[tenantId])
 ]);
 if(!product.rowCount){
  await db.query('DELETE FROM socio_product_knowledge WHERE tenant_id=$1 AND product_id=$2',[tenantId,productId]);
  return null;
 }
 const markdown=productKnowledgeMarkdown({
  tenantName:tenant.rows[0]?.name||'',
  product:product.rows[0],
  variants:variants.rows,
  media:media.rows,
  campaigns:campaigns.rows,
  now
 });
 await db.query(
  'INSERT INTO socio_product_knowledge(id,tenant_id,product_id,markdown,refreshed_at) VALUES($1,$2,$3,$4,now()) '+
  'ON CONFLICT(tenant_id,product_id) DO UPDATE SET markdown=EXCLUDED.markdown,refreshed_at=now()',
  [randomUUID(),tenantId,productId,markdown]);
 return markdown;
}

export async function readProductKnowledge(db,{tenantId,productIds=[]}={}){
 if(!tenantId||!Array.isArray(productIds)||!productIds.length)return new Map();
 const rows=await db.query('SELECT product_id,markdown FROM socio_product_knowledge WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])',
  [tenantId,productIds]);
 return new Map(rows.rows.map(row=>[row.product_id,row.markdown]));
}

// A product saved before this document existed is rebuilt on first use.
export async function ensureProductKnowledge(db,{tenantId,productIds=[]}={}){
 const documents=await readProductKnowledge(db,{tenantId,productIds});
 for(const productId of productIds.filter(id=>!documents.has(id)).slice(0,3)){
  try{documents.set(productId,await syncProductKnowledge(db,{tenantId,productId}));}
  catch{/* the catalog summary still grounds the reply */}
 }
 return documents;
}
