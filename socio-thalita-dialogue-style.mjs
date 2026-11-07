// Port of Prospector/dashboard/francisca-dialogue-style.mjs
// Adapted for the authenticated Sócio owner/team assistant, Thalita.
// Style controls language only; it never overrides tenant tools or permissions.
export const THALITA_DIALOGUE_VERSION='prospector-francisca-voice-style-parity-2026-11-07';
const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const leadIn=/^\s*(?:ol[aá](?:\s+de\s+novo)?|oi|al[oô]|bom dia|boa tarde|boa noite)(?:[!.,:;\s\u2013\u2014-]+|$)/i;
const genericLead=/^\s*(claro|entendi|perfeito|com certeza|sem problema|vamos l[aá]|ótimo|otimo)(?:[!.,:;\s\u2013\u2014-]+|$)/i;
const longForm=/(?:explique|explica(?:r)?|detalh|aprofund|analise|an[aá]lise|comp[ae]r|quais (?:s[aã]o|seriam)|o que falta|por que|por qu[eê]|como funciona|como melhorar|me ensina|estrat[eé]gia|possibilidades|alternativas|passo a passo|quero entender|me fala mais|contexto inteiro|tudo sobre)/;
export function voiceReplyPlan(heard='',history=[],preferences={}){
 const n=norm(heard);
 const detailed=preferences.detail==='detailed'||(preferences.detail!=='brief'&&(longForm.test(n)||n.length>120));
 const backAndForth=history.some(x=>x.role==='assistant');
 return {detailed,backAndForth,maxTokens:detailed?290:175,
  maxChars:detailed?610:preferences.detail==='brief'?260:390,maxSentences:detailed?4:2};
}
export function voiceStyleInstruction({heard='',history=[],preferences={}}={}){
 const p=voiceReplyPlan(heard,history,preferences);
 const previous=history.filter(x=>x.role==='assistant').slice(-3).map(x=>String(x.content||x.text||''));
 const openerExamples=previous.map(x=>{
  const cleaned=x.replace(/^[\s"'“”]+/,'').match(/^.{1,48}?(?=[,.!?]|$)/)?.[0]||'';
  return cleaned.replace(/[\r\n<>]/g,' ').slice(0,45);
 }).filter(Boolean);
 return [
  'Você é Thalita, assistente virtual OPERACIONAL do Sócio, falando com o usuário autenticado no sistema da empresa. Português brasileiro fluente, espontâneo, acolhedor e objetivo.',
  'A conversa já começou. Não se apresente de novo. NÃO comece cada resposta com oi, olá, alô, bom dia, claro, entendi, perfeito, vamos lá, nem se apresente a cada turno. Use transições variadas somente se fizer sentido.',
  'Não repita a pergunta recebida, nem a apresentação do Sócio nem suas respostas anteriores. Se o usuário disser "continua", retome o ponto em andamento sem recomeçar.',
  'Se fizerem uma correção, aceite e ajuste o raciocínio sem pedir desculpas repetidas. Se mudarem de assunto, responda ao assunto novo.',
  'Fale como numa conversa real: alterne frases diretas, observações pertinentes, exemplos breves e uma pergunta de seguimento APENAS se ajudar; não encerre toda resposta com a mesma pergunta.',
  preferences.detail==='brief'?'O usuário escolheu RESPOSTAS CURTAS. Não detalhe sem pedido explícito.':preferences.detail==='detailed'?'O usuário pediu RESPOSTAS COM MAIS DETALHES. Explique fatos úteis, sem inventar.':'',
  'Para brainstorming, ofereça ideias distintas; para pergunta factual, dê a resposta primeiro. Informação não verificada deve ser explicitamente qualificada.',
  p.detailed?'A pergunta pede uma explicação: responda em até quatro frases faláveis, com o que importa e um próximo passo se útil. Evite listas.':
   'A pergunta pede resposta curta: priorize uma ou duas frases espontâneas e claras.',
  p.backAndForth?'Isto é CONTINUAÇÃO da mesma conversa, não início de atendimento. Nunca cumprimente novamente.':
   'Você pode retribuir um cumprimento explícito somente na primeira resposta; não faça apresentação completa.',
  openerExamples.length?'Aberturas recentes; evite repeti-las: '+openerExamples.join(' | '):'',
  'Não produza Markdown, listas, emojis, títulos ou tags de atuação para voz. Escreva texto natural que possa ser FALADO.',
  'O usuário não precisa ser especialista em tráfego. Explique CPC, CTR, vendas atribuídas e custos em palavras simples quando realmente necessário.',
  'Nunca afirme ter consultado dados, enviado mensagens ou modificado anúncios sem a ferramenta autorizada. Alterações exigem autorização e aprovação previstas no Sócio.'
 ].filter(Boolean).join('\n');
}
function cutNaturally(text,maxChars){
 if(text.length<=maxChars)return text;
 const prefix=text.slice(0,maxChars+1);
 const tail=prefix.slice(Math.max(0,Math.floor(maxChars*.55)),maxChars).search(/[.!?](?=\s|$)/);
 if(tail>=0){const idx=Math.max(0,Math.floor(maxChars*.55))+tail;return prefix.slice(0,idx+1).trim();}
 const split=prefix.slice(0,maxChars).lastIndexOf(' ');
 return prefix.slice(0,split>=maxChars*.65?split:maxChars).trim().replace(/[,;:\s]+$/,'')+'.';
}
export function polishVoiceReply(text,{history=[],heard='',maxChars}={}){
 const original=String(text||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
 if(!original)return original;
 const plan=voiceReplyPlan(heard,history);
 const earlier=history.filter(m=>m.role==='assistant').map(m=>String(m.content||m.text||''));
 let output=original.replace(/^\s*[-*]\s+/,'');
 const quoting=/como (?:eu )?(?:cumpriment|saud|apresent)|roteiro|mensagem inicial|o que dizer|fala literalmente|citar exatamente|texto exato/.test(norm(heard));
 if(earlier.length&&!quoting){
  output=output.replace(leadIn,'').trim();
  const current=output.match(genericLead)?.[1];
  if(current&&genericLead.test(earlier.at(-1))){
   const previous=earlier.at(-1).match(genericLead)?.[1];
   if(previous&&norm(current)===norm(previous))output=output.replace(genericLead,'').trim();
  }
 }
 if(output.length<2)output=original;
 return cutNaturally(output,Math.min(640,Math.max(150,Number(maxChars)||plan.maxChars)));
}
