// A deterministic command interpreter. It never executes Meta POST or WhatsApp sends.
// Reuses the same reviewed plan API to prevent a second, unrestricted agent executor.
import {prepareAdsPlan} from './meta-ads-tools.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';

const normalize=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const invalid=(msg)=>Object.assign(new Error(msg),{status:422});
export function parseMetaCommand(text){
 const raw=String(text||'').trim(),s=normalize(raw);
 if(raw.length<5||raw.length>1000)throw invalid('Descreva sua solicitação em até mil caracteres.');
 const period=/\b(hoje|dia atual)\b/.test(s)?'today':/\b(ontem)\b/.test(s)?'yesterday':
  /\b(30 dias|mes|mensal)\b/.test(s)?'last_30d':'last_7d';
 if(/\b(relatorio|resultado|metricas|desempenho|gasto|analise|quanto gast)/.test(s)&&
  !/\b(orcamento|alterar|mudar|definir|aumentar|reduzir)\b/.test(s)){
  return {intent:'read',kind:'reports',input:{period,level:/\banuncio/.test(s)?'ad':/\bconjunto/.test(s)?'adset':'campaign',breakdown:'none'},
   label:'Consultar indicadores reais na conta Meta selecionada',willSpend:false};
 }
 const entity=/\b(conjunto|adset)\b/.test(s)?'adset':/\b(anuncio|ad )\b/.test(s)?'ad':'campaign';
 const id=raw.match(/\b(?:id\s*[:#]?\s*|#)(\d{4,30})\b/i)?.[1]||
  raw.match(/\b(?:campanha|conjunto|an[uú]ncio|adset)\s+(\d{4,30})\b/i)?.[1]||null;
 if(/\b(pausar|pause|desativar|parar)\b/.test(s))
  return {intent:'plan',kind:'status',input:{entity,id,status:'PAUSED'},missing:id?[]:['ID da campanha, conjunto ou anúncio'],willSpend:false};
 if(/\b(ativar|iniciar|publicar|ligar)\b/.test(s)&&id)
  return {intent:'plan',kind:'status',input:{entity,id,status:'ACTIVE'},missing:[],willSpend:true};
 if(/\b(orcamento|budget|valor diario)\b/.test(s)&&/\b(alterar|mudar|definir|colocar|aumentar|reduzir|ajustar)\b/.test(s)){
  const value=raw.match(/(?:R\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:reais?|por dia|\/dia)?\s*$/i)?.[1];
  const cents=value?Math.round(Number(value.replace(',','.'))*100):null;
  return {intent:'plan',kind:'budget',input:{entity,id,dailyBudgetCents:cents},
   missing:[...(!id?['ID do item']:[]),...(!cents?['Orçamento em reais']:[])],willSpend:true};
 }
 if(/\b(criar|fazer|subir|montar|novo)\b/.test(s)&&/\b(campanha|anuncio|publicidade|propaganda)\b/.test(s)){
  const amount=raw.match(/R\$\s*(\d{1,6}(?:[.,]\d{1,2})?)/i)?.[1];
  const budget=amount?Math.round(Number(amount.replace(',','.'))*100):null;
  const city=raw.match(/\b(?:para|em)\s+(sorocaba|s[aã]o paulo|campinas|rio de janeiro)\b/i)?.[1]||null;
  return {intent:'needs_details',kind:/whatsapp|zap|mensagem/.test(s)?'create_whatsapp':'create',
   willSpend:false,extracted:{dailyBudgetCents:budget,cityName:city},
   missing:['Página do Facebook autorizada','Imagem enviada à biblioteca Meta','Cidade pesquisada pelo ID oficial',
    'Texto, título e nome da campanha',/whatsapp|zap|mensagem/.test(s)?'Número WA-AKG vinculado à Página':'Destino HTTPS'],
   note:'Complete os campos no formulário oficial. A criação será pausada e exigirá confirmação.'};
 }
 return {intent:'unrecognized',note:'Comandos de consulta, pausa, ativação e orçamento exigem IDs. Para anúncios use o formulário de criação guiada.'};
}
export async function previewMetaCommand(pool,actor,text,opts={}){
 const command=parseMetaCommand(text);
 if(command.intent==='read'){
  return {command,preview:false,readOnly:true,data:await readAdvancedMetaTool(pool,actor,command.kind,command.input,opts)};
 }
 if(command.intent==='plan'&&command.missing.length===0){
  const plan=await prepareAdsPlan(pool,actor,command.kind,command.input,opts);
  return {command,plan,preview:true,requiresConfirmation:true,executed:false};
 }
 return {command,preview:false,executed:false};
}
