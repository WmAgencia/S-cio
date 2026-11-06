// Single conversational tool router for Meta Ads through the Sócio official app.
// Read-only tools are immediate. Mutations persist as owner-verified plans and
// require a fresh, explicit text approval. Never accepts arbitrary Graph routes.
import {randomUUID} from 'node:crypto';
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {parseMetaCommand,previewMetaCommand} from './meta-ads-commands.mjs';
import {prepareAdsPlan,executeAdsPlan} from './meta-ads-tools.mjs';
import {speakToAdSkill} from './socio-ad-skills.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const clean=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const confirm=x=>/^(pode criar|pode fazer|pode executar|confirmo|confirma|autorizo|aprovo|sim[, ]+pode|sim[, ]+confirmo)[.! ]*$/.test(clean(x));

export function formatSkillRead(command,result){
 if(command.kind==='pixels'){
  const list=(result.items||[]).slice(0,12).map(x=>(x.name||'Pixel')+' (ID '+x.id+')');
  return list.length?'Pixels encontrados na conta selecionada: '+list.join('; ')+
   '. A instalação de eventos no site precisa ser confirmada à parte.':
   'A Meta não retornou pixels nesta conta. Posso preparar a criação de um pixel quando você pedir.';
 }
 const info=result.summary||{},currency=info.currency||'BRL';
 return 'Resultado oficial da Meta ('+(command.input?.period||'last_7d')+'): investimento '+currency+' '+
  Number(info.spend||0).toFixed(2)+', '+Number(info.impressions||0)+' impressões, '+
  Number(info.clicks||0)+' cliques, CTR '+Number(info.ctrPercent||0).toFixed(2)+'%. '+
  'Cliques não são conversas ou compras confirmadas. Nenhuma campanha foi alterada.';
}
function summaryOf(plan,kind){
 const s=plan.summary||{};
 return kind==='create_pixel'?'Preparei um Pixel chamado '+(s.pixelName||s.name||'novo')+
  ' para a conta '+(s.account?.id||'selecionada')+'.': 
  'Preparei a operação '+kind+' para a conta '+(s.account?.id||'selecionada')+'. '+
  String(s.description||'').slice(0,300);
}
async function insertCommandRun(pool,a,accountId,{kind,name=null,planId=null,originConversationId=null}={}){
 if(originConversationId&&!uuid(originConversationId))throw fail(422,'Origem da conversa inválida.');
 const id=randomUUID(),status=planId?'ready':'collecting',brief={kind,...(name?{name}:{})};
 await pool.query(
  "INSERT INTO socio_skill_runs(id,tenant_id,user_id,account_id,skill,status,brief,plan_id,origin_conversation_id,expires_at) "+
  "VALUES($1,$2,$3,$4,'ads.meta.command',$5,$6::jsonb,$7,$8,now()+interval '15 minutes')",
  [id,a.active_tenant_id,a.user_id,accountId,status,JSON.stringify(brief),planId,originConversationId]);
 return id;
}
export async function speakToSocioSkill(pool,a,request={},opts={}){
 requirePermission(a,'marketing.manage');
 assertApiFeature(a.features,'/api/marketing/tools');
 assertApiFeature(a.features,'/api/agent');
 if(a.tenant_status==='paused')throw fail(403,'Empresa pausada.');
 const {message='',runId=null,imageHash=null}=request;
 if(typeof message!=='string'||message.length>1400)throw fail(422,'Pedido inválido.');
 if(runId){
  if(!uuid(runId))throw fail(422,'Conversa inválida.');
  const rows=await pool.query(
   "SELECT * FROM socio_skill_runs WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND expires_at>now()",
   [runId,a.active_tenant_id,a.user_id]);
  const run=rows.rows[0];
  if(!run)throw fail(404,'Pedido expirado. Envie o pedido novamente.');
  if(run.skill==='ads.campaign.launch')return (opts.campaign||speakToAdSkill)(pool,a,request,opts);
  if(run.skill!=='ads.meta.command')throw fail(422,'Skill desconhecida.');
  const account=await (opts.resolve||resolveSelectedOfficialAccount)(pool,a,opts);
  if(run.account_id!==account.id)throw fail(409,'A conta foi alterada. Faça um novo pedido para evitar operações na conta errada.');
  if(['completed','failed','executing'].includes(run.status))
   return {runId:run.id,status:run.status,message:'Esse pedido já foi processado. Confira o histórico antes de repetir.',
    result:run.result||null};
  if(run.status==='collecting'){
   if(run.brief?.kind!=='create_pixel')throw fail(422,'Pedido incompleto desconhecido.');
   const name=message.trim();
   if(name.length<3||name.length>120)throw fail(422,'Responda apenas com o nome do Pixel, entre 3 e 120 caracteres.');
   const plan=await (opts.prepare||prepareAdsPlan)(pool,a,'create_pixel',{name},opts);
   await pool.query(
    "UPDATE socio_skill_runs SET brief=$2::jsonb,plan_id=$3,status='ready',updated_at=now() "+
    "WHERE id=$1 AND tenant_id=$4 AND user_id=$5 AND status='collecting'",
    [run.id,JSON.stringify({kind:'create_pixel',name}),plan.id,a.active_tenant_id,a.user_id]);
   return {runId:run.id,status:'ready',
    message:summaryOf(plan,'create_pixel')+" Responda 'pode criar' para autorizar. Isso não instala eventos no site."};
  }
  if(!confirm(message))return {runId:run.id,status:'ready',
   message:"Plano aguardando aprovação. Responda 'pode criar' ou inicie um novo pedido."};
  const claim=await pool.query(
   "UPDATE socio_skill_runs SET status='executing',updated_at=now() "+
   "WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='ready' AND expires_at>now() RETURNING *",
   [run.id,a.active_tenant_id,a.user_id]);
  if(!claim.rowCount)throw fail(409,'Este pedido já está sendo processado.');
  let outcome;
  try{outcome=await (opts.execute||executeAdsPlan)(pool,a,run.plan_id,true,opts);}
  catch(error){outcome={status:'failed',error:String(error?.message||'Resultado incerto').slice(0,250)};}
  const status=outcome.status==='succeeded'?'completed':'failed';
  await pool.query(
   "UPDATE socio_skill_runs SET status=$2,result=$3::jsonb,updated_at=now() WHERE id=$1 AND tenant_id=$4",
   [run.id,status,JSON.stringify(outcome),a.active_tenant_id]);
  const identifier=outcome.result?.pixelId||outcome.result?.id||null;
  return {runId:run.id,status,result:outcome,
   message:status==='completed'?'A Meta confirmou '+(run.brief.kind==='create_pixel'?'a criação do Pixel':'a operação')+
    (identifier?' (ID '+identifier+')':'')+'. '+(run.brief.kind==='create_pixel'?
    'Agora é necessário instalar e validar os eventos no site e a CAPI.':'Confira a situação de veiculação e possíveis gastos.') :
    'A Meta não confirmou toda a operação. Confira o histórico antes de reenviar. '+
     String(outcome.error||'').slice(0,150)};
 }
 const raw=message.trim();
 if(!raw&&!imageHash)throw fail(422,'Digite um pedido.');
 if(/\b(pixel no whatsapp|instalar pixel no whatsapp)\b/.test(clean(raw)))
  return {runId:null,status:'completed',message:'Não existe Pixel instalado dentro do WhatsApp. Para conversas uso dados de anúncios e sinais do WA-AKG; para sites uso Pixel, CAPI e eventos de compra confirmados.'};
 const command=parseMetaCommand(raw);
 if(command.intent==='read'){
  const data=await (opts.preview||previewMetaCommand)(pool,a,raw,opts);
  return {runId:null,status:'completed',readOnly:true,message:formatSkillRead(command,data.data),data:data.data};
 }
 if(command.kind==='create_pixel'&&command.intent==='needs_details'){
  const account=await (opts.resolve||resolveSelectedOfficialAccount)(pool,a,opts);
  const id=await insertCommandRun(pool,a,account.id,{kind:'create_pixel',originConversationId:opts.originConversationId});
  return {runId:id,status:'collecting',message:'Qual nome você quer dar ao Pixel? Pode responder só com o nome.'};
 }
 if(command.intent==='plan'&&command.missing?.length===0){
  const data=await (opts.preview||previewMetaCommand)(pool,a,raw,opts);
  if(!data.plan)throw fail(503,'A Meta não confirmou a prévia.');
  const accountId=data.plan.summary?.account?.id;
  if(!/^act_\d{4,20}$/.test(accountId||''))throw fail(503,'Conta Meta não confirmada na prévia.');
  const id=await insertCommandRun(pool,a,accountId,{kind:command.kind,planId:data.plan.id,
   originConversationId:opts.originConversationId});
  return {runId:id,status:'ready',message:summaryOf(data.plan,command.kind)+
   " Responda 'pode criar' para autorizar a operação na Meta. Ações de ativação ou orçamento podem gerar gastos."};
 }
 if(command.kind==='create_pixel')throw fail(422,'Para criar um Pixel, diga o nome desejado.');
 if(/(capi|conversions api|convers[oõ]es? do site|rastrear compras|rastrear whatsapp)/.test(clean(raw)))
  return {runId:null,status:'completed',message:'Para rastrear compras no site preciso integrar o domínio e o checkout, obter autorização do dataset e validar Purchase por webhook. Para WhatsApp, uso WA-AKG e não instalo Pixel na conversa.'};
 return (opts.campaign||speakToAdSkill)(pool,a,request,opts);
}
