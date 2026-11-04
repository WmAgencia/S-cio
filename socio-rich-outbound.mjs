// Tenant-scoped structured WhatsApp sends with private catalog images.
import {createHash} from 'node:crypto';
import {getPrivateImage} from './media-storage.mjs';
import {deliverToConversation} from './socio-outbound.mjs';
import {jpegBytes,productCaption,productQuickReplies,validateInteractivePayload,sendGatewayInteractive} from './socio-interactive.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildQuickReplyMessage({message,choices}){
 if(typeof message!=='string'||!message.trim()||message.length>900)throw fail(422,'Texto de botão inválido.');
 if(!Array.isArray(choices)||choices.length<1||choices.length>3)throw fail(422,'Escolha de 1 a 3 opções.');
 const used=new Set();
 const buttons=choices.map(choice=>{
  if(typeof choice!=='string'||!choice.trim()||choice.length>24)
   throw fail(422,'Cada botão deve ter até 24 caracteres.');
  const label=choice.trim();
  const slug=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55);
  const token=slug||createHash('sha256').update(label).digest('hex').slice(0,16);
  if(used.has(token))throw fail(422,'Botões duplicados.');
  used.add(token);
  return {type:'quick_reply',displayText:label,id:'socio:reply:'+token};
 });
 return validateInteractivePayload({type:'buttons',title:'',body:message.trim(),
  footer:'Responda tocando numa opção',buttons});
}
export async function sendQuickReplies(pool,{tenantId,conversationId,userId,clientRequestId,message,choices,mode='human',deliver=deliverToConversation,send=sendGatewayInteractive}){
 const payload=buildQuickReplyMessage({message,choices});
 const fingerprint=hash(payload);
 return deliver(pool,{tenantId,conversationId,userId,clientRequestId,
  kind:'buttons',payloadFingerprint:fingerprint,mode,text:payload.body,
  send:({sessionId,jid,env})=>send({sessionId,jid,env,payload})});
}

export async function loadCatalogCard(pool,tenantId,productId,{readImage=getPrivateImage}={}){
 if(!uuid.test(productId))throw fail(422,'Produto inválido.');
 const product=await pool.query(
  'SELECT id,name,description,price_cents,stock_quantity,active FROM products WHERE tenant_id=$1 AND id=$2',
  [tenantId,productId]);
 if(!product.rowCount)throw fail(404,'Produto não encontrado nesta empresa.');
 const p=product.rows[0];
 if(!p.active||p.stock_quantity===0)throw fail(409,'Produto indisponível.');
 const media=await pool.query(
  'SELECT id,object_key,content_type FROM product_media WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at ASC LIMIT 1',
  [tenantId,productId]);
 if(!media.rowCount)throw fail(409,'Cadastre uma foto do produto antes de enviar pelo WhatsApp.');
 const variants=await pool.query(
  'SELECT name,price_cents,stock_quantity,active FROM product_variants WHERE tenant_id=$1 AND product_id=$2 ORDER BY created_at LIMIT 10',
  [tenantId,productId]);
 const photo=media.rows[0];
 if(photo.content_type!=='image/jpeg')throw fail(422,'A foto do catálogo deve estar em JPEG.');
 const bytes=await readImage(photo.object_key);
 if(!jpegBytes(bytes))throw fail(422,'Foto JPEG inválida ou fora do limite de 2,5 MB.');
 const data={...p,variants:variants.rows};
 const body=productCaption(data);
 const payload=validateInteractivePayload({type:'product',title:p.name.slice(0,90),body,
  footer:'Produto do catálogo desta empresa',buttons:productQuickReplies(productId),
  imageBase64:bytes.toString('base64')});
 return {payload,body,productId:p.id,mediaId:photo.id,
  fingerprint:hash({type:'product',productId:p.id,mediaId:photo.id,
   body,buttons:payload.buttons,photoHash:createHash('sha256').update(bytes).digest('hex')})};
}

export async function sendCatalogCard(pool,{tenantId,conversationId,userId=null,
 clientRequestId,productId,mode='human',readImage,deliver=deliverToConversation,
 send=sendGatewayInteractive}){
 const card=await loadCatalogCard(pool,tenantId,productId,readImage?{readImage}:{});
 const result=await deliver(pool,{tenantId,conversationId,userId,clientRequestId,
  kind:'product',payloadFingerprint:card.fingerprint,mode,
  text:card.body,sourceProductId:card.productId,sourceMediaId:card.mediaId,
  send:({sessionId,jid,env})=>send({sessionId,jid,env,payload:card.payload})});
 return {...result,productId:card.productId,mediaId:card.mediaId,kind:'product'};
}

// Conservative selection: only an unambiguous active product that appears by
// name in an explicit photo/details request. Never invent a catalog item.
export function suggestedCatalogProduct(message,products=[]){
 const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const text=normalized(message);
 if(!/\b(foto|imagem|mostrar|mostra|manda|envia|produto|detalhes|preco|valor|comprar|interesse)\b/.test(text))
  return null;
 const candidates=products.filter(p=>p.active!==false&&p.stock_quantity!==0&&
  typeof p.name==='string'&&normalized(p.name).length>=4&&
  text.includes(normalized(p.name)));
 return candidates.length===1?candidates[0].id:null;
}

export function wantsInteractiveMenu(message){
 const input=String(message||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
 return /^(?:menu|mostrar (?:o )?menu|me (?:mostra|manda|envia) (?:o )?menu|quero (?:ver )?(?:as )?opcoes de atendimento|quero (?:ver )?(?:os )?botoes)$/.test(input);
}
