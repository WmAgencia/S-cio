// A deterministic command interpreter. It never executes Meta POST or WhatsApp sends.
// Reuses the same reviewed plan API to prevent a second, unrestricted agent executor.
import {prepareAdsPlan} from './meta-ads-tools.mjs';
import {readMetaFinanceWithObservation} from './meta-billing-observations.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';

const normalize=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const invalid=(msg)=>Object.assign(new Error(msg),{status:422});
export function parseMetaCommand(text){
 const raw=String(text||'').trim(),s=normalize(raw);
 if(raw.length<5||raw.length>1000)throw invalid('Descreva sua solicitação em até mil caracteres.');
 const period=/\b(hoje|dia atual)\b/.test(s)?'today':/\b(ontem)\b/.test(s)?'yesterday':
  /\b(30 dias|mes|mensal)\b/.test(s)?'last_30d':'last_7d';
 if(/\b(gerar|gere|geracao|criar|crie|preparar|prepare|recarregar|carregar)\b/.test(s)&&/\b(pix|recarga|saldo)\b/.test(s))
  return {intent:'needs_details',kind:'assisted_topup',missing:['Valor em reais e revisão na página oficial da Meta'],
   note:'Abra Adicionar saldo por Pix no dashboard. A conta e o saldo serão conferidos antes da revisão.',willSpend:false};
 if(/\b(saldo|verba restante|verba esta acabando|verba acabando)\b/.test(s)&&
   !/\b(alterar|mudar|definir|aumentar|reduzir)\b/.test(s))
  return {intent:'read',kind:'finance',input:{},label:'Consultar saldo observado e validade do aviso de verba',willSpend:false};
 // Specialized read intents take priority over the generic report matcher.
 // Never reinterpret a request to modify a rule or budget as a read operation.
 if(!/\b(criar|crie|ativar|ative|pausar|pause|alterar|altere|excluir|exclua|aumentar|reduzir|mudar)\b/.test(s)){
  const kind=/\b(historico|alteracoes|atividades)\b/.test(s)?'activity':
   /\b(etiqueta|etiquetas|rotulos)\b/.test(s)?'labels':
   /\b(regras automaticas|regras da conta)\b/.test(s)?'rules':
   /\b(rejeicoes|rejeitados|problemas de entrega|problemas de veiculacao)\b/.test(s)?'delivery':
   /\b(retencao|thruplay|reproducao|quartis)\b/.test(s)?'video_report':
   /\b(conversoes|roas|valor de conversao)\b/.test(s)?'conversion_report':
   /\b(orcamentos|verbas das campanhas)\b/.test(s)?'budget_report':
   /\b(desempenho dos criativos|comparar criativos)\b/.test(s)?'creative_report':null;
  if(kind)return {intent:'read',kind,input:{period,level:'campaign',breakdown:'none'},
   label:'Consultar dados oficiais da conta Meta selecionada',willSpend:false};
 }
 if(/\b(relatorio|resultado|metricas|desempenho|gasto|analise|quanto gast)/.test(s)&&
  !/\b(orcamento|alterar|mudar|definir|aumentar|reduzir)\b/.test(s)){
  return {intent:'read',kind:'reports',input:{period,level:/\banuncio/.test(s)?'ad':/\bconjunto/.test(s)?'adset':'campaign',breakdown:'none'},
   label:'Consultar indicadores reais na conta Meta selecionada',willSpend:false};
 }
 if(/\b(pixel|pixels)\b/.test(s)){
  if(/\b(listar|liste|ver|mostrar|mostre|consultar|consulte|quais|existentes|tenho)\b/.test(s))
   return {intent:'read',kind:'pixels',input:{},label:'Consultar Pixels da conta Meta autorizada',willSpend:false};
  if(/\b(criar|crie|cria|fazer|faca|gerar|gere|novo)\b/.test(s)){
   const match=raw.match(/(?:\bchamado|\bchamada|\bnome(?:ado)?|\bdenominado)\s*[:=-]?\s*(.+)$/i);
   const name=match?.[1]?.trim()||null;
   if(name&&name.length>=3&&name.length<=120)
    return {intent:'plan',kind:'create_pixel',input:{name},missing:[],willSpend:false,
     note:'Sócio consultará Pixels existentes, exigirá aprovação e não instalará eventos automaticamente.'};
   return {intent:'needs_details',kind:'create_pixel',missing:['Nome do Pixel de 3 a 120 caracteres'],
    note:'Diga, por exemplo, crie um Pixel chamado Loja Consecom. A criação exige confirmação.',willSpend:false};
  }
 }
 const entity=/\b(conjunto|adset)\b/.test(s)?'adset':/\b(anuncio|ad )\b/.test(s)?'ad':'campaign';
 const id=raw.match(/\b(?:id\s*[:#]?\s*|#)(\d{4,30})\b/i)?.[1]||
  raw.match(/\b(?:campanha|conjunto|an[uú]ncio|adset)\s+(\d{4,30})\b/i)?.[1]||null;
 if(/\b(pausar|pausa|pause|desativar|desative|parar|pare)\b/.test(s))
  return {intent:'plan',kind:'status',input:{entity,id,status:'PAUSED'},missing:id?[]:['ID da campanha, conjunto ou anúncio'],willSpend:false};
 if(/\b(ativar|ative|ativa|iniciar|inicie|publicar|publique|ligar|ligue)\b/.test(s)&&id)
  return {intent:'plan',kind:'status',input:{entity,id,status:'ACTIVE'},missing:[],willSpend:true};
 if(/\b(orcamento|budget|valor diario)\b/.test(s)&&/\b(alterar|altere|mudar|mude|definir|defina|colocar|coloque|aumentar|aumente|reduzir|reduza|ajustar|ajuste)\b/.test(s)){
  const value=raw.match(/(?:R\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:reais?|por dia|\/dia)?\s*$/i)?.[1];
  const cents=value?Math.round(Number(value.replace(',','.'))*100):null;
  return {intent:'plan',kind:'budget',input:{entity,id,dailyBudgetCents:cents},
   missing:[...(!id?['ID do item']:[]),...(!cents?['Orçamento em reais']:[])],willSpend:true};
 }
 if(/\b(criar|crie|fazer|faca|subir|suba|montar|monte|novo)\b/.test(s)&&/\b(campanha|anuncio|publicidade|propaganda)\b/.test(s)){
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
  return {command,preview:false,readOnly:true,data:command.kind==='finance'?await readMetaFinanceWithObservation(pool,actor,opts):await readAdvancedMetaTool(pool,actor,command.kind,command.input,opts)};
 }
 if(command.intent==='plan'&&command.missing.length===0){
  const plan=await prepareAdsPlan(pool,actor,command.kind,command.input,opts);
  return {command,plan,preview:true,requiresConfirmation:true,executed:false};
 }
 return {command,preview:false,executed:false};
}
