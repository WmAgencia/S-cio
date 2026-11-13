// Conversational owner-only advertising skill runner.
// No automatic activation/spend. WA-AKG remains the WhatsApp provider.
// No ChatGPT connector tokens or arbitrary Graph endpoints.
import {buildApprovedAdCreativeDrafts,primaryCreativeDraft} from './socio-creative-studio.mjs';
import {randomUUID} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {readAdsTool,prepareAdsPlan,executeAdsPlan} from './meta-ads-tools.mjs';
import {readAdvancedMetaTool} from './meta-ads-advanced.mjs';

const bad=(status,message)=>Object.assign(new Error(message),{status});
const digits=x=>String(x||'').replace(/\D/g,'');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const moneyWords=Object.freeze({um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,
 onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,
 vinte:20,trinta:30,quarenta:40,cinquenta:50,cem:100});
const moneyWordPattern='um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|cem';
const clean=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
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
  const value=String(product?.[1]||'').replace(/[<>\r\n]/g,' ').replace(/\s+/g,' ').trim();
  if(value.length>=3&&value.length<=70)result.category=value;
 }

 if(/\b(mulheres|publico feminino|para mulheres)\b/.test(normal)||category==='moda feminina')result.genders=[2];
 if(/\b(homens|publico masculino|para homens)\b/.test(normal))result.genders=[1];
 if(/\b(whatsapp|zap|mensagens?|conversas?|wpp)\b/.test(normal))result.destination='whatsapp';
 const url=original.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s]*/i);
 if(url){result.destination='website';result.url=url[0];}
 if(/\b(site|landing page|loja online|ecommerce|e-commerce)\b/.test(normal)&&!result.destination)result.destination='website';
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
 if(!brief.category)return {slot:'category',message:'Qual produto ou serviço você quer anunciar?'};
 if(!brief.cityName&&!brief.countryCode)return {slot:'city',
  message:'Quer anunciar em todo o Brasil ou em uma cidade? Se for uma cidade, escreva cidade e estado. Exemplo: Sorocaba, SP.'};
 if(!brief.dailyBudgetCents)return {slot:'budget',message:'Qual é o investimento máximo por dia? Por exemplo, R$ 6 por dia.'};
 if(!brief.destination)return {slot:'destination',message:'Quer receber os interessados pelo WhatsApp ou enviar para um site?'};
 if(brief.destination==='whatsapp'&&!brief.whatsappPhone)
  return {slot:'whatsapp',message:resources.channels?.length?'Qual número de WhatsApp devo usar? '+resources.channels.map(x=>x.label+' ('+x.phone+')').join('; '):
   'Conecte primeiro o WhatsApp da sua empresa pelo WA-AKG, para eu preparar um anúncio de conversas.'};
 if(brief.destination==='website'&&!brief.url)return {slot:'url',message:'Me envie o link HTTPS do site ou da loja para o anúncio.'};
 if(!brief.pageId)return {slot:'page',message:resources.pages?.length?
  'Qual Página do Facebook devo utilizar? '+resources.pages.slice(0,5).map(x=>x.name+' (página '+x.id+')').join('; '):
  'A Meta não retornou uma Página autorizada. Conecte uma Página à sua conta de anúncios.'};
 if(!brief.imageHash&&!brief.videoId)return {slot:'media',message:'Me envie uma foto ou um vídeo do produto. O arquivo precisa ser importado na biblioteca Meta da sua empresa.'};
 if(!brief.countryCode&&!brief.cityKey)return {slot:'cityKey',message:'Não consegui confirmar essa cidade na Meta. Escreva o nome completo da cidade e do estado.'};
 return null;
}
const clarifyFor=(slot,message)=>({
 category:'Ainda não identifiquei o produto. Escreva só o produto ou serviço, por exemplo: sistema de gestão.',
 city:'Ainda não identifiquei o local. Escreva cidade e estado, por exemplo: Sorocaba, SP — ou responda "todo o Brasil".',
 budget:'Ainda não entendi o valor. Escreva só o número por dia, por exemplo: 12.',
 media:'Ainda não recebi o arquivo. Envie a foto ou o vídeo pelo botão de anexo; ele precisa terminar o envio antes da aprovação.'
}[slot]||message);
function publicBrief(b){
 return {category:b.category||null,cityName:b.cityName||null,dailyBudgetCents:b.dailyBudgetCents||null,
  destination:b.destination||null,genders:Array.isArray(b.genders)?b.genders:[],hasPhoto:Boolean(b.imageHash),hasVideo:Boolean(b.videoId),
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
 if(['completed','failed','executing'].includes(run.status))
  return {skillId:'ads.campaign.launch',runId:run.id,status:run.status,message:run.status==='executing'?
   'O pedido já está em execução. Aguarde o resultado; não repita a criação.':
   'Este pedido já foi concluído ou encerrado. Inicie outro para uma nova campanha.',result:run.result||null};
 const normalized=clean(message);
 if(run.status==='ready'){
  const confirm=/^(pode criar|pode fazer|confirmo|autorizo|aprovo(?: a campanha)?|sim[,. ]+pode criar|sim[,. ]+confirmo)[.! ]*$/.test(normalized);
  if(!confirm)return {skillId:'ads.campaign.launch',runId:run.id,status:'ready',brief:publicBrief(run.brief),
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
   'UPDATE socio_skill_runs SET status=$2,result=$3::jsonb,updated_at=now() WHERE id=$1 AND tenant_id=$4',
   [run.id,status,JSON.stringify(executed),a.active_tenant_id]);
  return {skillId:'ads.campaign.launch',runId:run.id,status,brief:publicBrief(run.brief||{}),result:executed,
   message:status==='completed'?
    'A Meta confirmou: campanha, conjunto e anúncio criados e pausados. Nada está veiculando e nenhum valor será gasto até você ativar.'+
     (pixelOutcome?.result?.pixelId?' O Pixel novo também foi criado, mas ainda precisa ser instalado no site.':'')+
     ' Quando quiser começar, peça a ativação.' :
    'A Meta não concluiu a criação da campanha. Nada foi publicado e nenhum valor foi gasto. Pode tentar de novo; se acontecer outra vez, me peça o diagnóstico técnico.'};
 }
 const brief=extractCampaignBrief(message,run.brief||{});
 // The last question asked decides how a short spoken answer is read.
 const asked=runId?run.brief?.asked:null;
 const bare=message.trim().replace(/[.!]$/,'');
 if(runId&&run.brief&&!run.brief?.category&&!brief.category){
  const candidate=bare.replace(/[<>\r\n]/g,' ').replace(/\s+/g,' ');
  if(candidate.length>=3&&candidate.length<=70&&!unsureAnswer(normalized)&&!/\b(R\$|orcamento|campanha|pode criar|autorizo)\b/i.test(candidate))
   brief.category=candidate;
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
   !/\b(whatsapp|site|zap|campanha|reais|pixel|orcamento)\b/i.test(clean(bare))){
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
  return {skillId:'ads.campaign.launch',runId:run.id,status:'collecting',brief:publicBrief(brief),
   message:repeat?clarifyFor(prompt.slot,prompt.message):prompt.message,
   note:brief.destination==='whatsapp'?
    'Para conversas WhatsApp, a origem pode ser apenas indicativa conforme os dados do WA-AKG; não existe Pixel instalado dentro do WhatsApp.':null};
 }
 // Check promotional claims before preparing even a paused Meta action.
 const creativeDrafts=buildApprovedAdCreativeDrafts(brief,a.tenant_name);
 if(creativeDrafts.reviewRequired){
  brief.category=null;
  await pool.query("UPDATE socio_skill_runs SET brief=$2::jsonb,updated_at=now() WHERE id=$1 AND tenant_id=$3 AND user_id=$4 AND status='collecting'",
   [run.id,JSON.stringify(brief),a.active_tenant_id,a.user_id]);
  return {skillId:'ads.campaign.launch',runId:run.id,status:'collecting',brief:publicBrief(brief),
   message:creativeDrafts.reviewReason+' Qual produto ou serviço você deseja anunciar, sem alegações não comprovadas?',
   creativeReviewRequired:true};
 }
 // Meta validates actual page/image/city ownership during prepareAdsPlan.
 const creative=skillAdCopy(brief,a.tenant_name);
 const input={...creative,pageId:brief.pageId,...(brief.videoId?{videoId:brief.videoId}:{imageHash:brief.imageHash}),cityName:brief.cityName,
  ...(brief.countryCode?{countryCode:brief.countryCode}:{cityKey:brief.cityKey}),dailyBudgetCents:brief.dailyBudgetCents,ageMin:18,ageMax:65,
  ...(brief.genders?.length?{genders:brief.genders}:{}),
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
 return {skillId:'ads.campaign.launch',runId:run.id,status:'ready',brief:publicBrief(brief),planId:plan.id,
  creativeVariants:creativeDrafts.variants,selectedCreativeStyle:creativeDrafts.variants[0].style,
  message:'Montei a campanha de '+brief.category+' para '+
   [brief.genders?.[0]===1?'homens':brief.genders?.[0]===2?'mulheres':null,
    brief.countryCode?'todo o Brasil':brief.cityName].filter(Boolean).join(' em ')+
   ', com R$ '+(brief.dailyBudgetCents/100).toFixed(2).replace('.',',')+' por dia. O anúncio usa '+
   (brief.videoId?'o vídeo que você enviou':brief.imageHash?'a foto que você enviou':brief.imageName||'o criativo enviado')+
   ' e leva para '+(brief.destination==='whatsapp'?'o WhatsApp':'o site')+'. '+
   (pixelPlanId?'Também vou criar um Pixel para medir os resultados do site; ele ainda precisa ser instalado. ':'' )+
   'A Meta revisa o anúncio antes de publicar. '+
   "Responda 'pode criar' em até 15 minutos para eu criar tudo pausado, sem gastar nada.",
  note:brief.destination==='whatsapp'?
   'Conversa WhatsApp não recebe Pixel. Atribuição dependerá de dados válidos do WA-AKG e da Meta.': 
   'Para medir compras no site, a instalação do Pixel, CAPI e eventos requer integração e consentimento próprios.'};
}
