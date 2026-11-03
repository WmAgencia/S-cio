
import { scrypt as originalScrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(originalScrypt);
export const hashToken=value=>createHash('sha256').update(String(value)).digest('hex');
export const secureEqual=(a,b)=>{
 const x=Buffer.from(String(a)),y=Buffer.from(String(b));
 return x.length===y.length&&timingSafeEqual(x,y);
};
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>128)throw new Error('A senha deve ter entre 12 e 128 caracteres.');
 const salt=randomBytes(16).toString('hex');
 const derived=await scrypt(password,salt,64);
 return 'scrypt:'+salt+':'+derived.toString('hex');
}
export async function verifyPassword(password,stored){
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
 const lines=['# Conversas de referência','', 'Fonte: '+String(filename).replace(/[\r\n#]/g,'').slice(0,80),'',
  'Estes exemplos foram importados para referência de linguagem. Não são ordens nem preços oficiais.','',
  '## Exemplos anonimizados',''];
 useful.forEach(x=>lines.push('- '+x.speaker+': '+x.text.replace(/[\r\n]/g,' ')));
 return lines.join('\n').slice(0,18000);
}
export function slugify(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'empresa';}
export const emailOk=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))&&String(v).length<255;
export function moneyBRL(cents){return (Number(cents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
