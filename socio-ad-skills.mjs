// Conversational owner-only advertising skill runner.
// No automatic activation/spend. WA-AKG remains the WhatsApp provider.
// No ChatGPT connector tokens or arbitrary Graph endpoints.
import {buildApprovedAdCreativeDrafts,primaryCreativeDraft,plausibleProduct} from './socio-creative-studio.mjs';
import {composeAdCopy} from './socio-ad-copywriter.mjs';
import {randomUUID} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {readAdsTool,prepareAdsPlan,executeAdsPlan} from './meta-ads-tools.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';
import {campaignDesign,planExplanation} from './socio-campaign-design.mjs';

const bad=(status,message)=>Object.assign(new Error(message),{status});
const digits=x=>String(x||'').replace(/\D/g,'');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const moneyWords=Object.freeze({um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,
 onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,
 vinte:20,trinta:30,quarenta:40,cinquenta:50,cem:100});
const moneyWordPattern='um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|cem';
const clean=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
// The owner answers by voice, so real confirmations arrive dressed up:
// "ok, pode criar", "beleza, pode fazer", "ent\u00e3o manda ver". They must all
// count, while a negation must never be read as approval.
const CONFIRM_FILLER=/^(?:ok|okay|beleza|ta|esta|esta bem|tudo bem|certo|isso|claro|sim|entao|vamos|perfeito|legal|bora|por|favor|agora|ja|e)$/;
export function isConfirmation(message){
 const words=clean(message).replace(/[^a-z ]+/g,' ').split(/\s+/).filter(Boolean);
 // A bare "sim" is the whole answer to "posso criar?"; it is a filler only
 // when something else follows it.
 if(words.length===1&&words[0]==='sim')return true;
 while(words.length&&CONFIRM_FILLER.test(words[0]))words.shift();
 while(words.length&&CONFIRM_FILLER.test(words[words.length-1]))words.pop();
 const rest=words.join(' ');
 return /^(?:pode criar|pode fazer|pode executar|pode subir|pode montar|pode lancar|pode|confirmo|confirma|autorizo|aprovo|aprovado|manda ver|faz|cria)$/.test(rest);
}
// Meta's rejection text is written for developers. The owner gets the reason in
// plain words, and the original sentence stays available as the detail.
function ownerCause(error){
 const raw=String(error||'').trim();
 // 1885183: the advertising app itself was still in development mode, so Meta
 // accepted the campaign and the ad set but refused every creative. Nothing the
 // owner says can fix it, so the message must name the real cause.
 if(/1885183|modo de desenvolvimento|development mode/i.test(raw))
  return 'o aplicativo que cria os anúncios estava em modo de desenvolvimento na Meta, e nesse modo a Meta bloqueia a criação de anúncios. Isso já foi corrigido na configuração da conta; pode tentar novamente.';
 if(/link/i.test(raw)&&/WHATSAPP_MESSAGE/i.test(raw))
  return 'o bot\u00e3o do an\u00fancio apontava para um endere\u00e7o, e a Meta s\u00f3 aceita o destino WhatsApp nesse tipo de an\u00fancio.';
 if(/image_hash|image_url/i.test(raw)&&/video_data/i.test(raw))
  return 'a Meta n\u00e3o recebeu a imagem de capa do v\u00eddeo.';
 if(/parecer|revis|politic|ineligiv|desaprov/i.test(raw))
  return 'a revis\u00e3o de an\u00fancios da Meta recusou o conte\u00fado do criativo.';
 if(/pagamento|forma de pagamento|metodo de pagamento|billing/i.test(raw))
  return 'a conta de an\u00fancios precisa de uma forma de pagamento v\u00e1lida.';
 if(/permiss|autoriz|acesso|token/i.test(raw))
  return 'a conta de an\u00fancios n\u00e3o autorizou esta opera\u00e7\u00e3o; a conex\u00e3o com a Meta precisa ser refeita.';
 if(/pagina|page/i.test(raw)&&/nao|invali|pertenc/i.test(raw))
  return 'a p\u00e1gina do Facebook escolhida n\u00e3o pertence a esta conta.';
 return null;
}
// "Me pe\u00e7a o diagn\u00f3stico t\u00e9cnico" was a dead end for the owner: they asked and got
// a definition instead. The failure now answers with the real reason, what was
// left behind on Meta, and the exact words that retry it.
function creationFailure(executed){
 const done=executed?.result||{};
 const cause=ownerCause(executed?.error);
 const leftovers=done.campaignId
  ?` A campanha${done.adsetId?' e o conjunto':''} foram criados e ficaram pausados na Meta. Nada est\u00e1 sendo veiculado e nenhum valor est\u00e1 sendo gasto.`
  :' Nada foi criado na Meta e nenhum valor foi gasto.';
 const retry=executed?.status==='uncertain'
  ?' Para n\u00e3o duplicar o que a Meta talvez j\u00e1 tenha criado, n\u00e3o repito sozinho: confira o Gerenciador de An\u00fancios e diga "tentar de novo" se quiser que eu refa\u00e7a.'
  :' Diga "tentar de novo" que eu refa\u00e7o a campanha com o mesmo plano.';
 return `N\u00e3o consegui concluir a cria\u00e7\u00e3o da campanha porque ${cause||'a Meta recusou a cria\u00e7\u00e3o e n\u00e3o informou um motivo claro'}.${leftovers}${retry}`;
}
// A campaign can target a whole country; "cidade" is not a mandatory slot.
function wantsCountrywide(normal){
 return /\b(brasil inteiro|todo o brasil|em todo brasil|de norte a sul|pais inteiro|todo o pais|territorio nacional|cobertura nacional|nacional)\b/.test(normal)||
  normal==='brasil';
}
// "Não sei" is not a product, a city or a budget; keep the question open instead
// of storing the non-answer in the brief.
function unsureAnswer(normal){
 return /\b(nao sei|nao entendi|nao lembro|nao tenho|nao faco ideia|depois|mais tarde|outra hora)\b/.test(normal);
}
// "Meus produtos" or "um item do catálogo" says where to look, not what to
// advertise; plausibleProduct keeps the question open instead of storing a
// placeholder.
function spokenMoney(normal){
 const word=new RegExp('\\b('+moneyWordPattern+')\\b').exec(normal);
 if(word)return moneyWords[word[1]];
 const digits=normal.match(/\b(\d{1,6}(?:[.,]\d{1,2})?)\b/);
 return digits?Number(digits[1].replace(',','.')):null;
}
export const SOCIO_AD_SKILLS=Object.freeze([
 {id:'ads.campaign.launch',label:'Planejar campanhas por conversa',availability:'assisted',channel:'panel'},
 {id:'ads.pixel.setup',label:'Criar e conferir pixels oficiais',availability:'reviewed',channel:'panel'},
 {id:'ads.performance.read',label:'Consultar resultados da Meta',availability:'ready',channel:'panel'},
 {id:'ads.performance.diagnose',label:'Diagnóstico profissional de campanhas e anúncios',availability:'ready',channel:'panel'},
 {id:'ads.whatsapp.attribution',label:'Acompanhar sinais WhatsApp pelo WA-AKG',availability:'indicative',channel:'panel'},
 {id:'ads.whatsapp.owner_commands',label:'Comandos seguros por WhatsApp',availability:'pending_gateway_validation',channel:'waakg'},
 {id:'ads.conversions.capi',label:'Eventos no servidor e conversões',availability:'pending_website_integration',channel:'web'}
]);

export function extractCampaignBrief(text,previous={}){
 if(typeof text!=='string'||text.length>1400)throw bad(422,'Descreva seu pedido em até 1.400 caracteres.');
 const original=text.trim(),normal=clean(original);
 const result={...previous};
 const amount=original.match(/(?:R\$\s*|(?:gastando|investir|orcamento(?: de)?|budget de)\s*)(\d{1,6}(?:[.,]\d{1,2})?)/i)
  ||original.match(/(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:reais|real)\s*(?:por dia|ao dia|diari[oa]s?)/i);
 const amountWords=normal.match(new RegExp('\\b('+moneyWordPattern+')\\s+reais?\\s*(?:por dia|ao dia|diari[oa]s?)\\b'));
 if(amount||amountWords){
  const numeric=amount?Number(amount[1].replace(',','.')):moneyWords[amountWords[1]];
  if(!Number.isFinite(numeric)||numeric<1||numeric>100000)throw bad(422,'Informe um orçamento diário de R$ 1 a R$ 100.000.');
  result.dailyBudgetCents=Math.round(numeric*100);
 }
 if(wantsCountrywide(normal)){
  result.countryCode='BR';result.cityName='todo o Brasil';delete result.cityKey;
 }else{
  const city=original.match(/\bem\s+(.{3,75}?)(?=\s+(?:gastando|investindo|por\s+(?:dia|R\$|\d+)|com\s+orcamento|com\s+R\$|e\s+gastando|no\s+(?:whatsapp|site|zap))|[,.;]|$)/i)||
   original.match(/\bpara\s+(.{3,75}?)(?=\s+(?:gastando|investindo|por\s+dia|com\s+orcamento|com\s+R\$)|[,.;]|$)/i);
  if(city&&city[1].trim().length>=3&&!wantsCountrywide(clean(city[1]))){result.cityName=city[1].trim();delete result.countryCode;}
 }
 const category=/\b(roupas?\s+feminin[ao]s?|moda\s+feminina|vestidos?|blusas?\s+femininas?)\b/.test(normal)?'moda feminina':
  /\b(roupas?\s+masculinas?|moda\s+masculina)\b/.test(normal)?'moda masculina':
  /\b(tenis|calcados?|sapatos?)\b/.test(normal)?'calçados':null;
 if(category)result.category=category;
 if(!result.category){
  const product=original.match(/\b(?:vender|vendendo|divulgar|anunciar|anunciando|promover|comprar|venda\s+de)\s+(.+?)(?=\s+(?:em|para)\s+[a-zA-ZÀ-ú]|\s+(?:gastando|investindo|com\s+or[cç]amento)|[,.;]|$)/i);
  // "vender direto pro meu WhatsApp esse sistema aqui" describes the outcome and
  // the destination; the subject is what remains after both are removed.
  const value=String(product?.[1]||'').replace(/[<>\r\n]/g,' ')
   .replace(/\b(?:direto\s+)?(?:pro|para\s+o|no|pelo)\s+(?:meu\s+|minha\s+)?(?:whatsapp|zap|site|link)\b/gi,' ')
   .replace(/\s+/g,' ').trim().replace(/\s+aqui$/i,'');
  const accepted=plausibleProduct(value);
  if(accepted)result.category=accepted;
 }
 // A category stored by an earlier turn may itself be a conversational fragment;
 // drop it instead of carrying a bad name into the campaign.
 if(result.category&&!plausibleProduct(result.category))delete result.category;

 if(/\b(mulheres|publico feminino|para mulheres)\b/.test(normal)||category==='moda feminina')result.genders=[2];
 if(/\b(homens|publico masculino|para homens)\b/.test(normal))result.genders=[1];
 if(/\b(whatsapp|zap|mensagens?|conversas?|wpp)\b/.test(normal))result.destination='whatsapp';
 const url=original.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s]*/i);
 if(url){result.destination='website';result.url=url[0];}
 if(/\b(site|landing page|loja online|ecommerce|e-commerce)\b/.test(normal)&&!result.destination)result.destination='website';
 // The owner states an outcome, not a Meta objective; the goal decides the
 // campaign goal in socio-campaign-design.mjs.
 const sells=/\b(vender|venda|vendas|comprar|compra|pedido|pedidos|clientes)\b/.test(normal);
 const awareness=/\b(reconhecimento|ser conhecid[ao]|aparecer mais|mais gente (?:saiba|conheca|conheça)|divulgar a marca|marca conhecida|alcance)\b/.test(normal);
 if(awareness){
  result.goal='awareness';
  if(!result.destination)result.destination='website';
 }else if(!result.goal){
  if(result.destination==='whatsapp')result.goal='sales_whatsapp';
  else if(result.destination==='website')result.goal=sells?'sales_site':'traffic';
 }
 const page=original.match(/\b(?:pagina|página)\s*(?:id|numero|n[oº])?\s*[:#]?\s*(\d{4,30})\b/i);
 if(page)result.pageId=page[1];
 const hash=original.match(/\b(?:imagem|criativo|hash)\s*(?:id|numero|n[oº])?\s*[:#]?\s*([a-f0-9]{12,100})\b/i);
 if(hash)result.imageHash=hash[1];
 const phone=original.match(/\b(?:whatsapp|telefone|numero)\s*(?:id|numero|n[oº])?\s*[:#]?\s*(55\d{10,11})\b/i);
 if(phone)result.whatsappPhone=phone[1];
 // Treat audience preferences as an intent, never as proof of purchase affinity.
 if(/\b(comprar|compram|compradoras?|interessad[ao]s?|gostem de)\b/.test(normal))result.interestIntent=true;
 return result;
}
export function skillAdCopy(brief,tenantName){
 return primaryCreativeDraft(brief,tenantName);
}
export function chooseMetaCity(items,name){
 if(!Array.isArray(items)||!name)return null;
 const query=clean(name);
 const exact=items.filter(x=>clean(x.name)===query&&String(x.key||'').length>=4);
 return exact.length===1?exact[0]:null;
}
function validImageHash(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(value);}
function authorize(a){
 requirePermission(a,'marketing.manage');
 assertApiFeature(a.features,'/api/marketing/tools');
 assertApiFeature(a.features,'/api/agent');
 if(a.tenant_status==='paused')throw bad(403,'Empresa pausada.');
}
// Returns the next missing slot so a short spoken answer can be read in the
// context of the question that was just asked.
function promptFor(brief,resources){
 if(!brief.category)return {slot:'category',
  message:'O que você quer anunciar? Pode ser um produto ou serviço do seu catálogo, ou qualquer outra coisa que você descreva — por exemplo: bolos caseiros.'};
 if(!brief.cityName&&!brief.countryCode)return {slot:'city',
  message:'Quer anunciar em todo o Brasil ou em uma cidade? Se for uma cidade, escreva cidade e estado. Exemplo: Sorocaba, SP.'};
 if(!brief.dailyBudgetCents)return {slot:'budget',message:'Qual é o investimento máximo por dia? Por exemplo, R$ 6 por dia.'};
 if(!brief.destination)return {slot:'destination',
  message:'Qual é o objetivo principal? Quero vender direto no WhatsApp, vender pelo site (posso te mandar o link) ou aparecer mais para as pessoas da minha região.'};
 if(brief.destination==='whatsapp'&&!brief.whatsappPhone)
  return {slot:'whatsapp',message:resources.channels?.length?'Qual número de WhatsApp devo usar? '+resources.channels.map(x=>x.label+' ('+x.phone+')').join('; '):
   'Conecte primeiro o WhatsApp da sua empresa pelo WA-AKG, para eu preparar um anúncio de conversas.'};
 if(brief.destination==='website'&&!brief.url)return {slot:'url',message:'Me envie o link HTTPS do site ou da loja para o anúncio.'};
 if(!brief.pageId)return {slot:'page',message:resources.pages?.length?
  'Qual Página do Facebook devo utilizar? '+resources.pages.slice(0,5).map(x=>x.name+' (página '+x.id+')').join('; '):
  'A Meta não retornou uma Página autorizada. Conecte uma Página à sua conta de anúncios.'};
 if(!brief.imageHash&&!brief.videoId)return {slot:'media',
  message:'Agora me envie uma foto ou um vídeo do produto — pode arrastar o arquivo para dentro da orbe. O arquivo precisa ser importado na biblioteca Meta da sua empresa.'};
 if(!brief.countryCode&&!brief.cityKey)return {slot:'cityKey',message:'Não consegui confirmar essa cidade na Meta. Escreva o nome completo da cidade e do estado.'};
 return null;
}
const clarifyFor=(slot,message)=>({
 category:'Ainda não identifiquei o produto ou serviço. Me diga em poucas palavras — pode ser um item do catálogo ou algo que você descreva agora, por exemplo: sistema de gestão.',
 city:'Ainda não identifiquei o local. Escreva cidade e estado, por exemplo: Sorocaba, SP — ou responda "todo o Brasil".',
 budget:'Ainda não entendi o valor. Escreva só o número por dia, por exemplo: 12.',
 media:'Ainda não recebi o arquivo. Envie a foto ou o vídeo pelo botão de anexo; ele precisa terminar o envio antes da aprovação.'
}[slot]||message);
function publicBrief(b){
 return {category:b.category||null,cityName:b.cityName||null,dailyBudgetCents:b.dailyBudgetCents||null,
  destination:b.destination||null,goal:b.goal||null,genders:Array.isArray(b.genders)?b.genders:[],hasPhoto:Boolean(b.imageHash),hasVideo:Boolean(b.videoId),
  pageId:b.pageId||null,imageName:b.imageName||null,whatsappPhone:b.whatsappPhone||null,url:b.url||null,
  cityKey:b.cityKey||null,countryCode:b.countryCode||null};
}
// Live execution log for the orb: the step ids are written by executeAdsPlan
// right after each Meta call, so the page can report real progress instead of
// guessing when a stage finished.
export async function readCampaignProgress(pool,a,runId){
 requirePermission(a,'marketing.read');
 assertApiFeature(a.features,'/api/agent');
 if(!uuid(runId))throw bad(422,'Conversa inválida.');
 const q=await pool.query(
  'SELECT r.status AS run_status,r.brief,p.status AS plan_status,p.result '+
  'FROM socio_skill_runs r LEFT JOIN meta_ads_plans p ON p.id=r.plan_id AND p.tenant_id=r.tenant_id '+
  'WHERE r.id=$1 AND r.tenant_id=$2 AND r.user_id=$3',
  [runId,a.active_tenant_id,a.user_id]);
 const row=q.rows[0];
 if(!row)throw bad(404,'Conversa não encontrada.');
 return {runId,runStatus:row.run_status,planStatus:row.plan_status||null,
  result:row.result&&typeof row.result==='object'?row.result:{},brief:publicBrief(row.brief||{})};
}
async function enrich(pool,a,brief,{read=readAdsTool,options={}}={}){
 const resources={pages:[],images:[],channels:[]};
 // Only the selected authorized Meta ad account is ever read.
 if((!brief.cityName&&!brief.countryCode)||!brief.category||!brief.dailyBudgetCents)return {brief,resources};
 if(!brief.countryCode){
  const city=await read(pool,a,'cities',{query:brief.cityName},options);
  const chosen=chooseMetaCity(city.items,brief.cityName);
  if(chosen){brief.cityKey=String(chosen.key);brief.cityName=String(chosen.name);}
 }
 if(!brief.destination){
  const channels=await pool.query("SELECT label,phone FROM channels WHERE tenant_id=$1 AND provider='waakg' AND status='connected' ORDER BY label LIMIT 10",[a.active_tenant_id]);
  resources.channels=channels.rows;
  if(channels.rowCount)brief.destination='whatsapp';
 }
 if(brief.destination==='whatsapp'&&!brief.whatsappPhone){
  const channels=resources.channels.length?resources.channels:(await pool.query(
   "SELECT label,phone FROM channels WHERE tenant_id=$1 AND provider='waakg' AND status='connected' ORDER BY label LIMIT 10",[a.active_tenant_id])).rows;
  resources.channels=channels;
  if(channels.length===1)brief.whatsappPhone=digits(channels[0].phone);
 }
 if(!brief.pageId){
  try{resources.pages=(await read(pool,a,'pages',{},options)).items||[];}catch{}
  if(resources.pages.length===1)brief.pageId=resources.pages[0].id;
 }
 if(!brief.imageHash&&!brief.videoId){
  try{resources.images=(await read(pool,a,'images',{},options)).items||[];}catch{}
  // Only auto-use an existing image when it unambiguously mentions the requested product.
  const keyword=clean(brief.category).split(' ')[0];
  const matches=resources.images.filter(x=>validImageHash(x.hash)&&clean(x.name).includes(keyword));
  if(matches.length===1){brief.imageHash=matches[0].hash;brief.imageName=String(matches[0].name||'Criativo autorizado').slice(0,90);}
 }
 return {brief,resources};
}
export async function speakToAdSkill(pool,a,{message='',runId=null,imageHash=null,videoId=null}={},opts={}){
 authorize(a);
 if(typeof message!=='string'||message.length>1400)throw bad(422,'Pedido muito longo.');
 if(imageHash!==null&&!validImageHash(imageHash))throw bad(422,'Imagem enviada inválida.');
 if(videoId!==null&&!/^\d{4,30}$/.test(String(videoId)))throw bad(422,'Vídeo Meta inválido.');
 if(imageHash!==null&&videoId!==null)throw bad(422,'Selecione somente um tipo de mídia.');
 const selected=await (opts.resolve||resolveSelectedOfficialAccount)(pool,a,opts);
 const accountId=selected.id;
 if(selected.currency!=='BRL')throw bad(409,'Esta skill está configurada para orçamento em reais. Selecione uma conta Meta em BRL antes de continuar.');
 let run;
 if(runId){
  if(!uuid(runId))throw bad(422,'Conversa inválida.');
  const q=await pool.query(
   'SELECT * FROM socio_skill_runs WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND expires_at>now()',
   [runId,a.active_tenant_id,a.user_id]);
  run=q.rows[0];
  if(!run)throw bad(404,'Conversa expirada. Descreva seu pedido novamente.');
  if(run.account_id!==accountId)throw bad(409,'A conta de anúncios mudou. Comece um novo pedido para proteger a empresa.');
 }else{
  if(!/\b(criar|crie|cria|quero|fazer|faz|anuncie|anuncia|anunciar|campanha|divulgar|divulgue|vender|venda|vendas|clientes)\b/i.test(clean(message)))
   throw bad(422,'Peça uma campanha, por exemplo: quero divulgar roupas femininas em Sorocaba, R$ 6 por dia.');
  const id=randomUUID();
  const initial=extractCampaignBrief(message);
  if(opts.originConversationId&&!uuid(opts.originConversationId))throw bad(422,'Conversa de origem inválida.');
  const inserted=await pool.query(
   "INSERT INTO socio_skill_runs(id,tenant_id,user_id,account_id,skill,status,brief,origin_conversation_id,expires_at) "+
   "VALUES($1,$2,$3,$4,'ads.campaign.launch','collecting',$5::jsonb,$6,now()+interval '2 hours') RETURNING *",
   [id,a.active_tenant_id,a.user_id,accountId,JSON.stringify(initial),opts.originConversationId||null]);
  run=inserted.rows[0];
 }
 // A failed run stays answerable: the owner asks what happened and asks for
 // another attempt instead of being sent back to the start of the conversation.
 if(run.status==='failed'){
  // "não quero tentar de novo" contains the retry words but means the opposite.
  const retry=!/\b(?:nao|nunca|nem|jamais)\b/.test(clean(message))&&
   (isConfirmation(message)||/\b(tentar|tenta|tente|repete|repita|refaz|refazer)\b[\s\S]*\b(de novo|novamente|outra vez)\b|\b(tentar|tenta|tente) (de )?novo\b/.test(clean(message)));
  if(retry){
   const reopened=await pool.query(
    "UPDATE socio_skill_runs SET status='collecting',plan_id=NULL,pixel_plan_id=NULL,result=NULL,expires_at=now()+interval '2 hours',updated_at=now() "+
    "WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='failed' RETURNING *",
    [run.id,a.active_tenant_id,a.user_id]);
   if(reopened.rowCount)run=reopened.rows[0];
  }else{
   return {skillId:'ads.campaign.launch',runId:run.id,status:'failed',brief:publicBrief(run.brief||{}),result:run.result||null,
    message:creationFailure(run.result)};
  }
 }else if(['completed','executing'].includes(run.status)){
  return {skillId:'ads.campaign.launch',runId:run.id,status:run.status,message:run.status==='executing'?
   'O pedido já está em execução. Aguarde o resultado; não repita a criação.':
   'Este pedido já foi concluído. Inicie outro para uma nova campanha.',result:run.result||null};
 }
 const normalized=clean(message);
 if(run.status==='ready'){
  if(!isConfirmation(message))return {skillId:'ads.campaign.launch',runId:run.id,status:'ready',brief:publicBrief(run.brief),
   message:"Campanha pronta para aprovação. Responda 'pode criar' para eu criar os itens PAUSADOS na Meta; isso não ativa gastos."};
  const claim=await pool.query(
   "UPDATE socio_skill_runs SET status='executing',updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='ready' AND expires_at>now() RETURNING *",
   [run.id,a.active_tenant_id,a.user_id]);
  if(!claim.rowCount)throw bad(409,'Este pedido já foi reivindicado. Não repita a operação.');
  let executed,pixelOutcome=null;
  const execute=opts.execute||executeAdsPlan;
  if(run.pixel_plan_id){
   try{pixelOutcome=await execute(pool,a,run.pixel_plan_id,true,opts);}
   catch(error){pixelOutcome={status:'failed',error:String(error?.message||'Falha de Pixel').slice(0,180)};}
  }
  if(pixelOutcome&&pixelOutcome.status!=='succeeded'){
   executed={status:'failed',error:'A Meta não confirmou o Pixel; campanha não foi enviada. '+
    String(pixelOutcome.error||'Confira o Gerenciador de Eventos.').slice(0,120),pixel:pixelOutcome};
  }else{
   try{executed=await execute(pool,a,run.plan_id,true,opts);}
   catch(error){executed={status:'failed',error:String(error?.message||'Falha não confirmada').slice(0,180)};}
   if(pixelOutcome)executed.pixel=pixelOutcome;
  }
  const status=executed.status==='succeeded'?'completed':'failed';
  await pool.query(
  // The failure stays answerable: the owner may still ask why or ask for a retry.
  "UPDATE socio_skill_runs SET status=$2,result=$3::jsonb,expires_at=now()+interval '2 hours',updated_at=now() WHERE id=$1 AND tenant_id=$4",
   [run.id,status,JSON.stringify(executed),a.active_tenant_id]);
  return {skillId:'ads.campaign.launch',runId:run.id,status,brief:publicBrief(run.brief||{}),result:executed,
   message:status==='completed'?
    'A Meta confirmou: campanha, conjunto e anúncio criados e pausados. Nada está veiculando e nenhum valor será gasto até você ativar.'+
     (pixelOutcome?.result?.pixelId?' O Pixel novo também foi criado, mas ainda precisa ser instalado no site.':'')+
     ' Quando quiser começar, peça a ativação.' :
    creationFailure(executed)};
 }
 const brief=extractCampaignBrief(message,run.brief||{});
 // The last question asked decides how a short spoken answer is read.
 const asked=runId?run.brief?.asked:null;
 const bare=message.trim().replace(/[.!]$/,'');
 if(runId&&run.brief&&!run.brief?.category&&!brief.category){
  const candidate=bare.replace(/[<>\r\n]/g,' ').replace(/\s+/g,' ');
  const product=plausibleProduct(candidate);
  if(product&&!unsureAnswer(normalized)&&!/\b(R\$|orcamento|campanha|pode criar|autorizo)\b/i.test(candidate))
   brief.category=product;
 }
 if(runId&&run.brief&&!brief.dailyBudgetCents&&(asked==='budget'||(run.brief.category&&run.brief.cityName))){
  const n=asked==='budget'?spokenMoney(normalized):
   (/^(?:R\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)$/i.test(bare)?Number(bare.replace(/[^\d.,]/g,'').replace(',','.')):null);
  if(Number.isFinite(n)&&n>=1&&n<=100000)brief.dailyBudgetCents=Math.round(n*100);
 }
 if(runId&&run.brief&&!brief.cityName&&!brief.countryCode&&(asked==='city'||run.brief.category)){
  if(wantsCountrywide(normalized)){
   brief.countryCode='BR';brief.cityName='todo o Brasil';delete brief.cityKey;
  }else if(bare.length>=3&&bare.length<=75&&!unsureAnswer(normalized)&&
   !/^\d|[.:]|^(pode criar|pode fazer|confirmo|autorizo|aprovo|sim)\b/i.test(bare)&&
   !/\b(whatsapp|site|zap|campanha|reais|pixel|orcamento|socio)\b/i.test(clean(bare))){
   brief.cityName=bare;
  }
 }
 if(imageHash){delete brief.videoId;brief.imageHash=imageHash;brief.imageName='Foto enviada nesta conversa';}
 if(videoId){delete brief.imageHash;brief.videoId=String(videoId);brief.imageName='Vídeo importado nesta conta Meta';}
 const {resources}=await enrich(pool,a,brief,{read:opts.read||readAdsTool,options:opts});
 const prompt=promptFor(brief,resources);
 if(prompt){
  brief.asked=prompt.slot;
  await pool.query(
   "UPDATE socio_skill_runs SET brief=$2::jsonb,updated_at=now() WHERE id=$1 AND tenant_id=$3 AND user_id=$4 AND status='collecting'",
   [run.id,JSON.stringify(brief),a.active_tenant_id,a.user_id]);
  const repeat=run.brief?.asked===prompt.slot;
  // The strategy comes before the creative: the owner hears the whole plan,
  // then sends the ad the plan already describes.
  const strategy=prompt.slot==='media'&&!repeat?planExplanation(brief,campaignDesign(brief)):'';
  return {skillId:'ads.campaign.launch',runId:run.id,status:'collecting',brief:publicBrief(brief),
   question:prompt.message,slot:prompt.slot,
   message:strategy?strategy+'\n'+prompt.message:repeat?clarifyFor(prompt.slot,prompt.message):prompt.message,
   note:brief.destination==='whatsapp'?
    'Para conversas WhatsApp, a origem pode ser apenas indicativa conforme os dados do WA-AKG; não existe Pixel instalado dentro do WhatsApp.':null};
 }
 // The copy is planned before the paused Meta action: the model writes it, the
 // studio checks it, and an unsafe or unavailable answer falls back to the
 // templated floor instead of blocking the campaign.
 const creativeDrafts=await (opts.composeCopy||composeAdCopy)({brief,tenantName:a.tenant_name,
  env:opts.env||process.env,fetchImpl:opts.fetchImpl});
 if(creativeDrafts.reviewRequired){
  brief.category=null;
  await pool.query("UPDATE socio_skill_runs SET brief=$2::jsonb,updated_at=now() WHERE id=$1 AND tenant_id=$3 AND user_id=$4 AND status='collecting'",
   [run.id,JSON.stringify(brief),a.active_tenant_id,a.user_id]);
  return {skillId:'ads.campaign.launch',runId:run.id,status:'collecting',brief:publicBrief(brief),
   message:creativeDrafts.reviewReason+' Qual produto ou serviço você deseja anunciar, sem alegações não comprovadas?',
   creativeReviewRequired:true};
 }
 // Meta validates actual page/image/city ownership during prepareAdsPlan.
 // The plan carries the same first draft the owner is shown, description included.
 const draft=creativeDrafts.variants[0];
 const creative={name:creativeDrafts.name,headline:draft.headline,
  description:draft.description,message:draft.message};
 const design=campaignDesign(brief);
 const input={...creative,pageId:brief.pageId,...(brief.videoId?{videoId:brief.videoId}:{imageHash:brief.imageHash}),cityName:brief.cityName,
  ...(brief.countryCode?{countryCode:brief.countryCode}:{cityKey:brief.cityKey}),dailyBudgetCents:brief.dailyBudgetCents,ageMin:18,ageMax:65,
  ...(brief.genders?.length?{genders:brief.genders}:{}),
  ...(design?{objective:design.objective,optimizationGoal:design.optimizationGoal,budgetMode:design.budgetMode}:{}),
  ...(brief.destination==='whatsapp'?{whatsappPhone:brief.whatsappPhone}:{url:brief.url})};
 const kind=brief.destination==='whatsapp'?'create_whatsapp':'create';
 let pixelPlanId=null;
 if(kind==='create'){
  const pixels=await (opts.readPixels||readAdvancedMetaTool)(pool,a,'pixels',{},opts);
  if(!pixels||!Array.isArray(pixels.items))throw bad(503,'A Meta não confirmou os Pixels; não é seguro preparar rastreamento.');
  if(!pixels.items.length&&!pixels.hasMore){
   const pixelName=('Pixel '+String(a.tenant_name||'Loja').slice(0,85)).slice(0,120);
   const px=await (opts.prepare||prepareAdsPlan)(pool,a,'create_pixel',{name:pixelName},opts);
   pixelPlanId=px.id;
   brief.pixelCreationPlanned=true;
  }else{
   brief.pixelCreationPlanned=false;
   brief.existingPixelIds=pixels.items.map(x=>x.id).filter(x=>typeof x==='string').slice(0,3);
  }
 }
 const plan=await (opts.prepare||prepareAdsPlan)(pool,a,kind,input,opts);
 await pool.query("UPDATE socio_skill_runs SET brief=$2::jsonb,plan_id=$3,pixel_plan_id=$4,status='ready',expires_at=now()+interval '15 minutes',updated_at=now() "+
  "WHERE id=$1 AND tenant_id=$5 AND user_id=$6 AND status='collecting'",
  [run.id,JSON.stringify(brief),plan.id,pixelPlanId,a.active_tenant_id,a.user_id]);
 const explanation=planExplanation(brief,design)||('Montei a campanha de '+brief.category+'. ');
 return {skillId:'ads.campaign.launch',runId:run.id,status:'ready',brief:publicBrief(brief),planId:plan.id,design:design||null,
  creativeVariants:creativeDrafts.variants,selectedCreativeStyle:creativeDrafts.variants[0].style,
  copyProvider:creativeDrafts.copyProvider||'template',copyNote:creativeDrafts.copyNote||null,
  message:explanation+
   (pixelPlanId?'Também vou criar um Pixel para medir os resultados do site; ele ainda precisa ser instalado. ':'' )+
   '\n\nComo o anúncio vai aparecer:\n'+
   'Título: '+draft.headline+'\nTexto principal: '+draft.message+
   (draft.description?'\nDescrição: '+draft.description:'')+
   (draft.welcomeMessage?'\nBoas-vindas no WhatsApp: '+draft.welcomeMessage+'\nMensagem pronta: '+draft.quickReply:'')+
   '\n\nA Meta revisa o anúncio antes de publicar. '+
   "Responda 'pode criar' em até 15 minutos para eu criar tudo pausado, sem gastar nada.",
  note:brief.destination==='whatsapp'?
   'Conversa WhatsApp não recebe Pixel. Atribuição dependerá de dados válidos do WA-AKG e da Meta.': 
   'Para medir compras no site, a instalação do Pixel, CAPI e eventos requer integração e consentimento próprios.'};
}
