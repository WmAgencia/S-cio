
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

export function encryptToken(token,keyHex){
 const key=Buffer.from(String(keyHex||''),'hex');
 if(key.length!==32||!/^[0-9a-f]{64}$/i.test(keyHex||''))throw new Error('CHANNEL_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais.');
 if(typeof token!=='string'||token.length<25||token.length>2000)throw new Error('Token Meta inválido.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
}
export function decryptToken(encrypted,keyHex){
 const key=Buffer.from(String(keyHex||''),'hex'),[iv,tag,text]=String(encrypted||'').split('.');
 if(key.length!==32||!iv||!tag||!text)throw new Error('Credencial criptografada indisponível.');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
 decipher.setAuthTag(Buffer.from(tag,'base64url'));
 return Buffer.concat([decipher.update(Buffer.from(text,'base64url')),decipher.final()]).toString('utf8');
}
const version=()=>/v\d{2}\.0/.test(process.env.META_GRAPH_VERSION||'')?process.env.META_GRAPH_VERSION:'v25.0';
const endpoint=phoneId=>'https://graph.facebook.com/'+version()+'/'+encodeURIComponent(phoneId);
async function graph(url,opts,fetcher){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const resp=await fetcher(url,{...opts,signal:controller.signal});
  const data=await resp.json().catch(()=>({}));
  if(!resp.ok)throw Object.assign(new Error('Meta rejeitou a solicitação (HTTP '+resp.status+').'),{status:502,metaStatus:resp.status});
  return data;
 }finally{clearTimeout(timer);}
}
export async function validateMetaPhone({phoneId,displayPhone,accessToken,fetcher=fetch}){
 if(!/^\d{6,32}$/.test(String(phoneId||'')))throw new Error('Identificador do número Meta inválido.');
 if(!accessToken||typeof accessToken!=='string')throw new Error('Token Meta obrigatório.');
 const data=await graph(endpoint(phoneId)+'?fields=id,display_phone_number',{headers:{Authorization:'Bearer '+accessToken}},fetcher);
 if(String(data.id)!==String(phoneId))throw new Error('A Meta retornou um identificador de número diferente.');
 const expected=String(displayPhone||'').replace(/\D/g,'');
 const actual=String(data.display_phone_number||'').replace(/\D/g,'');
 if(!actual||!expected||actual.slice(-8)!==expected.slice(-8))throw new Error('O número da Meta não coincide com o número cadastrado. Verifique antes de conectar.');
 return {phoneId:String(data.id),displayPhone:String(data.display_phone_number)};
}
export async function sendMetaText({phoneId,accessToken,to,text,fetcher=fetch}){
 const recipient=String(to||'').replace(/\D/g,'');
 if(!/^\d{10,15}$/.test(recipient))throw new Error('Destinatário inválido.');
 if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('Mensagem inválida.');
 const data=await graph(endpoint(phoneId)+'/messages',{
  method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:recipient,type:'text',text:{preview_url:false,body:text}})
 },fetcher);
 const messageId=data.messages?.[0]?.id;
 if(!messageId)throw new Error('Meta não retornou confirmação de recebimento.');
 return String(messageId);
}
