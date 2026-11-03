// Independent validators and deterministic product grounding.
// These records are tenant-scoped server data, never crowd-sourced product facts.
const fault=(message)=>Object.assign(new Error(message),{status:422});
const amount=x=>Number.isSafeInteger(x)&&x>=0&&x<100000000;
const inventory=x=>x===null||Number.isSafeInteger(x)&&x>=0&&x<=1000000;
const cleanText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max?x.trim():null;
export function validateProduct(data){
 if(!data||typeof data!=='object')throw fault('Produto inválido.');
 const name=cleanText(data.name,120);
 const description=data.description===undefined||data.description===null?'':typeof data.description==='string'&&data.description.length<=1200?data.description.trim():null;
 const sku=data.sku==null||data.sku===''?null:cleanText(data.sku,50);
 const stockQuantity=data.stockQuantity===undefined?null:data.stockQuantity;
 const compareAtPriceCents=data.compareAtPriceCents===undefined||data.compareAtPriceCents===null?null:data.compareAtPriceCents;
 if(!name||description===null||!amount(data.priceCents)||!inventory(stockQuantity)||!amount(compareAtPriceCents??0)||
    (sku!==null&&!/^[A-Za-z0-9_-]{2,50}$/.test(sku))||
    (data.active!==undefined&&typeof data.active!=='boolean'))throw fault('Dados de produto, preço, SKU ou estoque inválidos.');
 return {name,description,sku:sku?.toUpperCase()??null,priceCents:data.priceCents,
  stockQuantity,compareAtPriceCents,active:data.active!==false};
}
export function validateVariants(variants){
 if(!Array.isArray(variants)||variants.length>25)throw fault('Informe até 25 variações por produto.');
 const codes=new Set();
 return variants.map(item=>{
  const name=cleanText(item?.name,100);
  const sku=item?.sku==null||item.sku===''?null:cleanText(item.sku,50);
  if(!name||!amount(item?.priceCents)||!inventory(item?.stockQuantity??null)||
     (sku!==null&&!/^[A-Za-z0-9_-]{2,50}$/.test(sku))||
     (item?.active!==undefined&&typeof item.active!=='boolean'))throw fault('Variação inválida. Verifique nome, preço, estoque e SKU.');
  const normalized=sku?.toUpperCase()??null;
  if(normalized){if(codes.has(normalized))throw fault('SKU duplicado entre as variações.');codes.add(normalized);}
  return {name,sku:normalized,priceCents:item.priceCents,stockQuantity:item.stockQuantity??null,active:item.active!==false};
 });
}
export function validateCampaign(data){
 const provider=data?.provider;
 const campaignId=cleanText(data?.campaignId,150);
 const label=data?.label==null?'':typeof data.label==='string'&&data.label.length<=120?data.label.trim():null;
 if(!['meta_ads','google_ads'].includes(provider)||!campaignId||!/^[A-Za-z0-9_.:-]{1,150}$/.test(campaignId)||label===null)
  throw fault('Campanha inválida. Informe plataforma e identificador.');
 return {provider,campaignId,label};
}
export function catalogPrompt(products){
 const lines=[];
 for(const product of products.slice(0,70)){
  const status=product.active!==false&&(product.stock_quantity===null||Number(product.stock_quantity)>0)?'disponível para consulta':'indisponível';
  lines.push('- '+String(product.name).replace(/[\r\n]/g,' ').slice(0,120)+
   ' | preço base R$ '+(Number(product.price_cents)/100).toFixed(2)+
   ' | '+status+
   ' | descrição: '+String(product.description||'').replace(/[\r\n]/g,' ').slice(0,500));
  const variants=(product.variants||[]).filter(v=>v.active!==false);
  for(const variant of variants.slice(0,25)){
   const available=variant.stock_quantity===null||Number(variant.stock_quantity)>0;
   lines.push('  - Variação '+String(variant.name).replace(/[\r\n]/g,' ').slice(0,100)+
    ' | R$ '+(Number(variant.price_cents)/100).toFixed(2)+' | '+(available?'estoque não esgotado':'sem estoque'));
  }
 }
 return lines.join('\n').slice(0,14500)||'Nenhum produto cadastrado.';
}
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function matchCatalogProducts(message,products){
 const text=normalize(message);
 if(!text||text.length<2)return [];
 return products.filter(p=>{
  if(!p.active)return false;
  const name=normalize(p.name);
  if(name.length<3)return false;
  return text.includes(name);
 }).slice(0,3).map(p=>({id:p.id,name:p.name,priceCents:p.price_cents,
  stockQuantity:p.stock_quantity,media:(p.media||[]).slice(0,3).map(m=>({
    id:m.id,alt:m.alt,url:'/api/products/'+p.id+'/media/'+m.id+'/file'
  }))}));
}
