// Etapa 7: painel operacional de leitura, segmentado por tenant.
import {requirePermission} from './team-permissions.mjs';
import {parseTenantFeatures} from './tenant-features.mjs';
const fault=(status,message)=>Object.assign(new Error(message),{status});
export function trialWindow(status,createdAt,{now=new Date(),days=7}={}){
 if(!['trial','active','paused'].includes(status)||!Number.isInteger(days)||days<1||days>60)throw fault(422,'Prazo inválido.');
 const begin=new Date(createdAt),current=new Date(now);
 if(!Number.isFinite(begin.getTime())||!Number.isFinite(current.getTime()))throw fault(422,'Data inválida.');
 const ends=new Date(begin.getTime()+days*86400000),expired=status==='trial'&&current>=ends;
 return {accountStatus:status,trialDays:days,trialEndsAt:ends.toISOString(),
  daysRemaining:status==='trial'?Math.max(0,Math.ceil((ends-current)/86400000)):null,
  elapsed:expired,trialActiveOnCalendar:status==='trial'&&!expired,
  note:'Período indicativo desde o cadastro; não comprova assinatura e não bloqueia acesso.'};
}
const METRICS=[
 "SELECT",
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='inbound' AND m.created_at >= $2::timestamptz-interval '30 days') inbound_30d,",
 "(SELECT count(*)::int FROM messages m WHERE m.tenant_id=$1 AND m.direction='outbound' AND m.provider_id IS NOT NULL AND m.created_at >= $2::timestamptz-interval '30 days') outbound_30d,",
 "(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1 AND c.created_at >= $2::timestamptz-interval '30 days') conv_30d,",
 "(SELECT count(*)::int FROM conversations c WHERE c.tenant_id=$1 AND c.status<>'resolved'",
 " AND (SELECT max(m.created_at) FROM messages m WHERE m.tenant_id=c.tenant_id AND m.conversation_id=c.id AND m.direction='inbound') >= $2::timestamptz-interval '30 days'",
 " AND (SELECT max(m.created_at) FROM messages m WHERE m.tenant_id=c.tenant_id AND m.conversation_id=c.id AND m.direction='inbound') >",
 " coalesce((SELECT max(m.created_at) FROM messages m WHERE m.tenant_id=c.tenant_id AND m.conversation_id=c.id AND m.direction='outbound' AND m.provider_id IS NOT NULL),'-infinity'::timestamptz)) awaiting_30d,",
 "(SELECT count(*)::int FROM channels c WHERE c.tenant_id=$1 AND c.provider='waakg' AND c.status='connected') connected_records"
].join(' ');
export async function getTenantBusinessMonitor(pool,actor,{now=new Date()}={}){
 requirePermission(actor,'audit.read');
 if(actor.tenant_status==='paused'||!actor.active_tenant_id)throw fault(403,'Empresa indisponível.');
 const tenantId=actor.active_tenant_id,moment=new Date(now).toISOString();
 const [tenant,metrics]=await Promise.all([
  pool.query('SELECT id,plan,status,created_at FROM tenants WHERE id=$1',[tenantId]),
  pool.query(METRICS,[tenantId,moment])
 ]);
 if(!tenant.rows?.length)throw fault(404,'Empresa não encontrada.');
 const t=tenant.rows[0],row=metrics.rows?.[0]||{},features=parseTenantFeatures(actor.features);
 const n=k=>Number(row[k]||0),wa=features.whatsapp;
 const activity={
  inboundMessages30d:wa?n('inbound_30d'):null,
  confirmedBusinessMessages30d:wa?n('outbound_30d'):null,
  conversationsStarted30d:wa?n('conv_30d'):null,
  awaitingBusinessReply30d:wa?n('awaiting_30d'):null,
  connectedChannelRecords:wa?n('connected_records'):null,
  confirmedLivePaidOrders:null,confirmedLiveRevenueCents:null
 };
 const alerts=[];
 if(wa&&activity.awaitingBusinessReply30d>0)alerts.push({code:'awaiting_reply',count:activity.awaitingBusinessReply30d,
  message:'Conversas abertas com mensagem de cliente sem resposta posterior confirmada.'});
 if(wa&&!activity.connectedChannelRecords)alerts.push({code:'no_channel_record',count:0,
  message:'Nenhuma sessão WA-AKG consta como conectada no banco; confirme pelo gateway.'});
 return {readOnly:true,tenantScoped:true,checkedAt:moment,periodDays:30,
  plan:t.plan,accountStatus:t.status,trial:trialWindow(t.status,t.created_at,{now}),activity,alerts,
  limitations:['Dados locais; canal conectado no banco não comprova sessão WA-AKG ativa.',
   'Respostas contam somente mensagens de saída com ID de provedor; a cobertura pode ser parcial.',
   'Vendas reais continuam indisponíveis sem integração financeira.',
   'Alertas apenas no painel: não enviam mensagens nem alteram campanhas.']};
}
export async function getMasterSaasMonitor(pool,actor,{now=new Date()}={}){
 requirePermission(actor,'platform.manage');
 if(actor.platform_owner!==true)throw fault(403,'Acesso exclusivo do administrador master.');
 const moment=new Date(now).toISOString();
 const [totals,tenants]=await Promise.all([
  pool.query([
   'SELECT count(*)::int AS total,',
   "count(*) FILTER (WHERE status='trial')::int AS trials,",
   "count(*) FILTER (WHERE status='active')::int AS active_accounts,",
   "count(*) FILTER (WHERE status='paused')::int AS paused,",
   "count(*) FILTER (WHERE status='trial' AND created_at+interval '7 days'<=$1::timestamptz)::int AS overdue,",
   "count(*) FILTER (WHERE status='trial' AND created_at+interval '7 days'>$1::timestamptz AND",
   "created_at+interval '7 days'<=$1::timestamptz+interval '3 days')::int AS soon FROM tenants"
  ].join(' '),[moment]),
  pool.query([
   'SELECT t.id,t.name,t.plan,t.status,t.created_at,',
   "(SELECT count(*)::int FROM channels c WHERE c.tenant_id=t.id AND c.provider='waakg' AND c.status='connected') AS channels,",
   "(SELECT max(m.created_at) FROM messages m WHERE m.tenant_id=t.id AND m.direction='inbound') AS last_inbound",
   'FROM tenants t ORDER BY t.created_at DESC,t.id DESC LIMIT 100'
  ].join(' '),[])
 ]);
 const rows=(tenants.rows||[]).map(t=>{
  const trial=trialWindow(t.status,t.created_at,{now});
  return {id:t.id,name:t.name,plan:t.plan,accountStatus:t.status,createdAt:t.created_at,
   trial,connectedChannelRecords:Number(t.channels||0),
   lastInboundAt:t.last_inbound,
   needsAttention:trial.elapsed,
   attentionReasons:[...(trial.elapsed?['trial_calendar_elapsed']:[])]};
 });
 const row=totals.rows?.[0]||{},n=k=>Number(row[k]||0);
 return {readOnly:true,scope:'platform',checkedAt:moment,
  summary:{total:n('total'),trialAccounts:n('trials'),activeAccounts:n('active_accounts'),
   pausedAccounts:n('paused'),trialCalendarElapsed:n('overdue'),trialEndingWithin3Days:n('soon'),
   confirmedPayingCustomers:null,mrrCents:null},
  tenants:rows,partial:rows.length<n('total'),
  trialPolicy:{days:7,basis:'tenant_creation_date',automaticSuspension:false,
   note:'Janela de 7 dias apenas informativa; não há cobrança mensal nem bloqueio automático homologado.'},
  limitations:['Conta ativa não equivale a assinatura paga.',
   'WhatsApp marcado como conectado no banco não confirma sessão ao vivo.',
   'MRR e clientes pagantes indisponíveis até conciliação financeira de produção.',
   'Nenhuma empresa será cobrada, pausada ou contatada automaticamente.']};
}
export function formatBusinessMonitor(result){
 if(!result?.activity)throw fault(422,'Relatório inválido.');
 const v=result.activity,fmt=x=>x===null?'indisponível':String(x);
 return ['Relatório operacional — últimos '+result.periodDays+' dias:',
  'Mensagens recebidas: '+fmt(v.inboundMessages30d)+' · respostas confirmadas pelo provedor: '+fmt(v.confirmedBusinessMessages30d)+'.',
  'Conversas iniciadas: '+fmt(v.conversationsStarted30d)+' · aguardando resposta confirmada: '+fmt(v.awaitingBusinessReply30d)+'.',
  'Vendas reais e faturamento confirmado: indisponíveis.',
  'Pontos de atenção: '+result.alerts.length+'. '+result.alerts.map(a=>a.message+' ('+a.count+')').join(' '),
  'Nenhum pagamento, anúncio ou mensagem foi alterado.'].join('\n');
}
