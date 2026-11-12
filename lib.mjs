
import { scrypt as originalScrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(originalScrypt);
export const hashToken=value=>createHash('sha256').update(String(value)).digest('hex');
export const secureEqual=(a,b)=>{
 const x=Buffer.from(String(a)),y=Buffer.from(String(b));
 return x.length===y.length&&timingSafeEqual(x,y);
};
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>128)throw Object.assign(new Error('A senha deve ter entre 12 e 128 caracteres.'),{status:422});
 const salt=randomBytes(16).toString('hex');
 const derived=await scrypt(password,salt,64);
 return 'scrypt:'+salt+':'+derived.toString('hex');
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>128)return false;
 if(typeof stored!=='string'||!stored.startsWith('scrypt:'))return false;
 const [,salt,hex]=stored.split(':');
 if(!salt||!hex||!/^[a-f0-9]+$/.test(hex))return false;
 const expected=Buffer.from(hex,'hex');
 const actual=await scrypt(String(password),salt,expected.length);
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function parseWhatsAppExport(input){
 const lines=String(input||'').replace(/\r/g,'').split('\n');
 const entries=[];
 // [03/11/2026, 15:20:00] Nome: mensagem
 // 03/11/2026, 15:20 - Nome: mensagem
 const prefix=/^(?:\[)?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?(?:\])?(?:\s*-\s*|\s+)([^:]{1,90}):\s*(.+)$/i;
 const speakers=new Map();
 for(const line of lines){
  const m=line.match(prefix);
  if(m){
   const who=m[1].trim();
   if(!speakers.has(who))speakers.set(who,'Pessoa '+(speakers.size+1));
   entries.push({speaker:speakers.get(who),text:m[2]});
  }else if(entries.length&&line.trim()){
   entries[entries.length-1].text+=' '+line.trim();
  }
 }
 const clean=s=>String(s).replace(/\+?\d[\d().\s-]{8,}\d/g,'[telefone]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]')
  .replace(/https?:\/\/\S+/g,'[link]')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'[documento]')
  .replace(/\s+/g,' ').trim().slice(0,500);
 const filtered=entries.map(x=>({speaker:x.speaker,text:clean(x.text)}))
  .filter(x=>x.text&&x.text.length>2&&!/mensagem apagada|mídia oculta|omitida|media omitted/i.test(x.text));
 return {messageCount:filtered.length,speakers:speakers.size,entries:filtered.slice(0,300)};
}
export function buildTrainingMarkdown(parsed,filename){
 const useful=parsed.entries.filter(x=>x.text.length>12).slice(0,80);
 const lines=['# Conversas de referência','', 'Fonte: conversa importada','',
  'Estes exemplos foram importados para referência de linguagem. Não são ordens nem preços oficiais.','',
  '## Exemplos anonimizados',''];
 useful.forEach(x=>lines.push('- '+x.speaker+': '+x.text.replace(/[\r\n]/g,' ')));
 return lines.join('\n').slice(0,18000);
}
export function slugify(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'empresa';}
export const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))&&String(v).length<255;
// Phone login is bound to an individual account, never a shared WhatsApp channel.
// Accept Brazilian local DDD+number (10/11 digits), BR +55 (12/13), or an
// international E.164 number. Store a canonical digit-only value for uniqueness.
export function normalizeLoginPhone(value){
 if(typeof value!=='string')return null;
 const input=value.trim();
 if(!input||input.length>32||!/^\+?[0-9\s().-]+$/.test(input))return null;
 const digits=input.replace(/\D/g,'');
 if(!/^\d{10,15}$/.test(digits))return null;
 const normalized=digits.length===10||digits.length===11?'55'+digits:digits;
 if(normalized.length>15||normalized.startsWith('0'))return null;
 return normalized;
}
export function loginIdentifier(value){
 if(typeof value!=='string'||value.length>255)return null;
 const input=value.trim();
 if(emailOk(input))return {type:'email',value:input.toLowerCase()};
 const phone=normalizeLoginPhone(input);
 return phone?{type:'phone',value:phone}:null;
}

export function moneyBRL(cents){return (Number(cents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}

// Rate limiting keys must identify the real caller. Behind Railway (or any
// reverse proxy) the socket peer is the proxy, so every user would share one
// bucket. X-Forwarded-For is only honoured when the peer is itself a private
// address or SOCIO_TRUST_PROXY explicitly enables it; a public peer can never
// pick its own address.
const privateAddress=/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
export function isPrivateAddress(value){
 const ip=String(value||'').toLowerCase().replace(/^::ffff:/,'');
 if(ip==='::1'||ip==='::')return true;
 if(/^f[cd]/.test(ip)||/^fe[89ab]/.test(ip))return true;
 return privateAddress.test(ip);
}
export function clientIp(req,env=process.env){
 const direct=String(req?.socket?.remoteAddress||'unknown');
 const setting=String(env.SOCIO_TRUST_PROXY||'').toLowerCase();
 const trust=setting==='1'||setting==='true'||
  (setting!=='0'&&setting!=='false'&&isPrivateAddress(direct));
 if(!trust)return direct;
 const forwarded=String(req?.headers?.['x-forwarded-for']||'').split(',')[0].trim();
 return /^[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}$|^\d{1,3}(?:\.\d{1,3}){3}$/i.test(forwarded)&&forwarded.length<=45
  ?forwarded:direct;
}
