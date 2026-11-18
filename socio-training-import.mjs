// Turns real conversations from the Sócio inbox into training samples.
//
// The owner's side teaches how the business speaks; the customer's side is
// context. Each line is labelled CLIENTE or EMPRESA so the analysis can tell
// them apart, and every line is de-identified before it is stored: phone
// numbers, e-mail addresses, links, documents and the business's own phone
// number never enter the sample.

export const BUSINESS_PHONE_TAG='[telefone da empresa]';

const clean=value=>String(value||'')
 .replace(/[\r\n\t]+/g,' ')
 .replace(/\+?\d[\d().\s-]{8,}\d/g,'[telefone]')
 .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]')
 .replace(/https?:\/\/\S+/g,'[link]')
 .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,'[documento]')
 .replace(/\s+/g,' ').trim().slice(0,500);

export function buildConversationTrainingMarkdown({conversations=[],businessNames=[],businessPhone='',limit=18000}={}){
 const owners=new Set(businessNames.map(x=>String(x||'').toLocaleLowerCase('pt-BR').trim()).filter(Boolean));
 const phone=String(businessPhone||'').replace(/\D/g,'');
 const digits=value=>String(value||'').replace(/\D/g,'');
 const lines=[
  '# Conversas reais do WhatsApp',
  '',
  'Fonte: histórico da própria caixa de entrada do Sócio.',
  'Estes exemplos são referência de linguagem. Não são ordens, preços oficiais ou promessas.',
  'CLIENTE é quem procurou a empresa; EMPRESA é a empresa respondendo.',
  ''
 ];
 let messages=0;
 const speakers=new Set(),requested=new Set();
 for(const c of conversations){
  const body=[];
  for(const m of c.messages||[]){
   const text=clean(m.body);
   if(!text)continue;
   let side='CLIENTE';
   if(m.direction==='outbound')side='EMPRESA';
   else{
    const lower=text.toLocaleLowerCase('pt-BR');
    const named=[...owners].some(name=>name.length>3&&lower.includes(name));
    if(named||(phone.length>=10&&digits(text).includes(phone)))side='EMPRESA';
   }
   body.push('- '+side+': '+text);
   messages++;
  }
  if(body.length<2)continue;
  speakers.add(c.id);
  lines.push('## Conversa '+(speakers.size),'',...body,'');
  const markdown=lines.join('\n');
  if(markdown.length>limit)return {markdown:markdown.slice(0,limit),messageCount:messages,conversationCount:speakers.size};
  requested.add(c.id);
 }
 return {markdown:lines.join('\n'),messageCount:messages,conversationCount:requested.size};
}
