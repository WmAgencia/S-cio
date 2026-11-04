// Strict, single-contact Native Flow sender for the private Sócio WA-AKG gateway.
// Only quick replies, no arbitrary URLs, phone calls, bulk targets, or media URLs.
// Product photos are passed as JPEG bytes from our own tenant-bound S3 catalog.
import {createHmac} from 'node:crypto';
import {gatewayBase,validSessionId} from './waakg-adapter.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const jidPattern=/^\d{5,24}@s\.whatsapp\.net$/;
const idPattern=/^[a-zA-Z0-9:_.-]{1,96}$/;
export const jpegBytes=(bytes)=>Buffer.isBuffer(bytes)&&bytes.length>=16&&bytes.length<=2_500_000&&
 bytes[0]===0xff&&bytes[1]===0xd8&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9;

export function validateInteractivePayload(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw fail(422,'Mensagem interativa inválida.');
 const kind=input.type;
 if(!['buttons','product'].includes(kind))throw fail(422,'Tipo interativo indisponível.');
 const title=String(input.title||'').trim();
 const body=String(input.body||'').trim();
 const footer=String(input.footer||'').trim();
 if(title.length>90||!body||body.length>900||footer.length>90)
  throw fail(422,'Título, mensagem ou rodapé fora dos limites.');
 if(!Array.isArray(input.buttons)||!input.buttons.length||input.buttons.length>3)
  throw fail(422,'Informe de 1 a 3 botões.');
 const ids=new Set();
 const buttons=input.buttons.map(button=>{
  if(!button||button.type!=='quick_reply'||typeof button.displayText!=='string'||
   typeof button.id!=='string')throw fail(422,'Apenas respostas rápidas são aceitas.');
  const displayText=button.displayText.trim(),id=button.id.trim();
  if(!displayText||displayText.length>24||!idPattern.test(id)||ids.has(id))
   throw fail(422,'Opções de resposta inválidas ou duplicadas.');
  ids.add(id);return {type:'quick_reply',displayText,id};
 });
 if(kind==='product'&&(!input.imageBase64||typeof input.imageBase64!=='string'))
  throw fail(422,'Foto do produto obrigatória.');
 if(kind==='buttons'&&input.imageBase64!==undefined)
  throw fail(422,'Envie fotos somente como apresentação de produto.');
 if(input.imageBase64!==undefined){
  const encoded=input.imageBase64;
  if(encoded.length>3_350_000||encoded.length<24||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
   throw fail(422,'Imagem JPEG inválida ou grande demais.');
  const bytes=Buffer.from(encoded,'base64');
  if(!jpegBytes(bytes))throw fail(422,'A foto precisa ser JPEG e ter no máximo 2,5 MB.');
 }
 return {
  type:kind,title,body,footer,buttons,
  ...(input.imageBase64!==undefined?{imageBase64:input.imageBase64}:{})
 };
}
export function interactiveSignature({timestamp,sessionId,jid,payload,key}){
 if(!validSessionId(sessionId)||!jidPattern.test(jid)||typeof key!=='string'||key.length<20)
  throw fail(422,'Sessão ou destinatário inválido.');
 return createHmac('sha256',key).update([timestamp,sessionId,jid,JSON.stringify(payload)].join('\n')).digest('hex');
}
export async function sendGatewayInteractive({sessionId,jid,payload,env=process.env,fetchImpl=fetch}){
 if(env.SOCIO_OUTBOUND_ENABLED!=='true'||!env.WA_AKG_API_KEY||!env.WA_AKG_BASE_URL)
  throw fail(503,'Envio não habilitado.');
 const validated=validateInteractivePayload(payload);
 const timestamp=String(Date.now());
 const signature=interactiveSignature({timestamp,sessionId,jid,payload:validated,key:env.WA_AKG_API_KEY});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const url=gatewayBase(env)+'/api/messages/'+encodeURIComponent(sessionId)+'/'+
   encodeURIComponent(jid)+'/interactive';
  const response=await fetchImpl(url,{method:'POST',signal:controller.signal,
   headers:{'x-api-key':env.WA_AKG_API_KEY,'x-socio-outbound-at':timestamp,
    'x-socio-outbound-signature':signature,'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify(validated)});
  if(!response.ok)throw fail(503,'Gateway não confirmou a mensagem interativa.');
  const answer=await response.json();
  const key=answer?.data?.key;
  if(answer?.status!==true||typeof key?.id!=='string'||!key.id||key.fromMe!==true||
     (key.remoteJid&&key.remoteJid!==jid))
   throw fail(503,'Gateway não retornou a confirmação da mensagem e do destinatário.');
  return {sent:true,providerId:key.id.slice(0,160)};
 }catch(err){
  if(err.status)throw err;
  throw fail(503,'Não foi possível confirmar a mensagem interativa.');
 }finally{clearTimeout(timer);}
}

export function productCaption(product){
 const name=String(product.name||'').trim().slice(0,110);
 const description=String(product.description||'').trim().slice(0,460);
 const price=Number(product.price_cents);
 if(!name||!Number.isSafeInteger(price)||price<0)throw fail(422,'Produto inválido.');
 if(!product.active||product.stock_quantity===0)
  throw fail(409,'Produto indisponível no catálogo.');
 const money=(price/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const extras=(product.variants||[]).filter(v=>v.active!==false&&v.stock_quantity!==0).slice(0,5)
  .map(v=>String(v.name).slice(0,45)).join(', ');
 return [name,money,description,extras?'Opções: '+extras:''].filter(Boolean).join('\n').slice(0,900);
}
export function productQuickReplies(productId){
 if(!/^[a-f0-9-]{36}$/i.test(productId))throw fail(422,'Produto inválido.');
 return [
  {type:'quick_reply',displayText:'Tenho interesse',id:'socio:interest:'+productId},
  {type:'quick_reply',displayText:'Ver opções',id:'socio:options:'+productId},
  {type:'quick_reply',displayText:'Falar com atendente',id:'socio:human'}
 ];
}
export const basicQuickReplies=[
 {type:'quick_reply',displayText:'Ver produtos',id:'socio:catalog'},
 {type:'quick_reply',displayText:'Falar com atendente',id:'socio:human'}
];
