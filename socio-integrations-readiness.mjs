// Evidence-based integration checklist for the tenant owner. No provider writes.
import {requirePermission} from './team-permissions.mjs';
import {billingConfiguration} from './socio-subscriptions.mjs';
import {googleAdsConfig,googleAdsStatus} from './socio-google-ads.mjs';
import {listTrackingSites} from './socio-site-tracking.mjs';
import {ownerWhatsAppReadiness} from './socio-owner-skill-readiness.mjs';

export async function integrationReadiness(pool,actor,{env=process.env,whatsapp=ownerWhatsAppReadiness}={}){
 requirePermission(actor,'audit.read');
 if(actor.tenant_status==='paused')throw Object.assign(new Error('Empresa pausada.'),{status:403});
 const billing=billingConfiguration(env),google=googleAdsConfig(env);
 const tasks=[
  {id:'billing',name:'Assinaturas Stripe',configured:billing.enabled,verified:false,
   mode:billing.mode,blockers:billing.blockers,
   action:'Definir preços dos planos e autorizar as credenciais e o webhook oficial do Stripe.'},
  {id:'google',name:'Google Ads',configured:google.ready,verified:false,
   blockers:google.blockers,action:'Conectar via OAuth e validar developer token e contas acessíveis.'},
  {id:'meta_capi',name:'Pixel e Conversions API',configured:env.SOCIO_SITE_EVENTS_ENABLED==='true'&&
    env.SOCIO_META_CAPI_ENABLED==='true',verified:false,
   blockers:[...(env.SOCIO_SITE_EVENTS_ENABLED!=='true'?['Coleta assinada de sites desativada.']:[]),
    ...(env.SOCIO_META_CAPI_ENABLED!=='true'?['Envio à Meta CAPI desativado.']:[])],
   action:'Associar domínio e Pixel existentes, instalar eventos com consentimento e homologar deduplicação no Events Manager.'},
  {id:'whatsapp',name:'WhatsApp WA-AKG',configured:false,verified:false,blockers:[],
   action:'Conectar sessão, validar telefone do proprietário e testar mensagem real.'},
  {id:'production_sales',name:'Vendas reais',configured:false,verified:false,
   blockers:['Sem webhook homologado de checkout de produção dos clientes.'],
   action:'Conectar pagamentos de produção do cliente; não confundir com as assinaturas do Sócio ou Stripe teste.'},
  {id:'meta_reports',name:'Relatórios automáticos Meta',configured:env.SOCIO_META_REPORTS_ENABLED==='true',
   verified:false,blockers:env.SOCIO_META_REPORTS_ENABLED==='true'?[]:['Worker de relatórios automáticos não ativado.'],
   action:'Validar uma execução real da conta Meta autorizada e seu histórico no painel.'}
 ];
 try{
  const status=await googleAdsStatus(pool,actor,{env});
  const task=tasks.find(x=>x.id==='google');
  task.connected=status.connected;task.selectedAccount=status.selectedCustomerId;
  task.verified=!!status.connected&&!!status.checkedAt&&status.checkedAccountCount>0;
  if(status.connected&&!task.verified)task.blockers.push('Ainda não há consulta de contas confirmada.');
 }catch{tasks.find(x=>x.id==='google').blockers.push('Sem leitura da autorização Google nesta empresa.');}
 try{
  const sites=await listTrackingSites(pool,actor,{env});
  const task=tasks.find(x=>x.id==='meta_capi');
  task.sitesRegistered=sites.sites.length;
  task.sitesEnabled=sites.sites.filter(s=>s.enabled).length;
  if(!task.sitesEnabled)task.blockers.push('Nenhum site habilitado pela empresa.');
 }catch{tasks.find(x=>x.id==='meta_capi').blockers.push('Sem sites Meta autorizados nesta empresa.');}
 try{
  const wa=await whatsapp(pool,actor,{env});
  const task=tasks.find(x=>x.id==='whatsapp');
  task.configured=wa.connectedSessions>0&&wa.textReady;
  task.verified=wa.connectedSessions>0;
  task.connectedSessions=wa.connectedSessions;
  task.blockers=wa.blockers||[];
 }catch{tasks.find(x=>x.id==='whatsapp').blockers.push('Verificação de sessão WA-AKG indisponível para esta empresa.');}
 const approved=tasks.filter(x=>x.verified).length;
 return {readOnly:true,checkedAt:new Date().toISOString(),tenantScoped:true,
  readyChecks:approved,totalChecks:tasks.length,tasks,
  note:'Configuração, autenticação, evento recebido e operação homologada são estados diferentes. Nada aqui gera cobranças, campanhas, mensagens ou suspensões.'};
}
