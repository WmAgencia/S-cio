import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {trialWindow,getTenantBusinessMonitor,getMasterSaasMonitor,formatBusinessMonitor} from '../socio-business-monitor.mjs';
const id=()=>randomUUID();
const tenant=id();
const features={whatsapp:true,catalog:true,ai:true,meta_ads:true,team:true};
const actor={role:'owner',platform_owner:false,active_tenant_id:tenant,tenant_status:'trial',features};
const now=new Date('2026-11-06T20:00:00Z');
test('7-day trial is calendar visibility only, not payment or suspension',()=>{
 const t=trialWindow('trial','2026-11-03T20:00:00Z',{now});
 assert.equal(t.daysRemaining,4);assert.equal(t.elapsed,false);
 assert.equal(t.trialEndsAt,'2026-11-10T20:00:00.000Z');
 assert.equal(trialWindow('trial','2026-10-20T20:00:00Z',{now}).elapsed,true);
 assert.equal(trialWindow('active','2026-10-20T20:00:00Z',{now}).daysRemaining,null);
 assert.match(t.note,/não comprova assinatura/);
 assert.throws(()=>trialWindow('paid','2026-11-05',{now}),{status:422});
});
test('tenant report is scoped to the active company and never infers paid revenue',async()=>{
 const statements=[];
 const pool={query:async(sql,args)=>{
  statements.push(sql);assert.equal(args[0],tenant);
  assert(/SELECT/i.test(sql));assert(!/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)/i.test(sql));
  if(sql.includes('FROM tenants WHERE id=$1'))return {rows:[{id:tenant,status:'trial',plan:'essencial',created_at:'2026-11-03T20:00:00Z'}]};
  if(sql.includes('inbound_30d'))return {rows:[{inbound_30d:25,outbound_30d:11,conv_30d:15,awaiting_30d:4,connected_records:0}]};
  throw Error('Unexpected SQL');
 }};
 const result=await getTenantBusinessMonitor(pool,actor,{now});
 assert.equal(statements.length,2);
 const a=result.activity;
 assert.equal(a.inboundMessages30d,25);assert.equal(a.confirmedBusinessMessages30d,11);
 assert.equal(a.conversationsStarted30d,15);assert.equal(a.awaitingBusinessReply30d,4);
 assert.equal(a.connectedChannelRecords,0);
 assert.equal(a.confirmedLivePaidOrders,null);assert.equal(a.confirmedLiveRevenueCents,null);
 assert.equal(result.alerts.some(x=>x.code==='awaiting_reply'),true);
 assert.equal(result.alerts.some(x=>x.code==='no_channel_record'),true);
 assert.equal(result.readOnly,true);assert.equal(result.tenantScoped,true);
 const text=formatBusinessMonitor(result);
 assert.match(text,/Mensagens recebidas: 25/);
 assert.match(text,/Vendas reais e faturamento confirmado: indisponíveis/);
 assert.match(text,/Nenhum pagamento, anúncio ou mensagem foi alterado/);
 assert.doesNotMatch(text,/orçamento|pedido cadastrado/i);
});
test('disabled modules hide their metrics; account pause, agent or foreign identity cannot access reports',async()=>{
 const pool={query:async(sql)=>{
  if(sql.includes('FROM tenants WHERE id=$1'))return {rows:[{status:'active',created_at:'2026-11-05T12:00:00Z',plan:'essencial'}]};
  return {rows:[{inbound_30d:45,conv_30d:20,connected_records:2}]};
 }};
 const a=await getTenantBusinessMonitor(pool,{...actor,features:{...features,whatsapp:false}},{now});
 assert.equal(a.activity.inboundMessages30d,null);assert.equal(a.activity.conversationsStarted30d,null);
 assert.equal(a.alerts.length,0);
 for(const x of [{...actor,role:'agent'},{...actor,tenant_status:'paused'},{...actor,active_tenant_id:null}]){
  await assert.rejects(getTenantBusinessMonitor({query:()=>{throw Error('should not query')}},x,{now}),{status:403});
 }
});
test('master can inspect account status and trial deadlines without inventing subscribers or MRR',async()=>{
 let called=0;
 const pool={query:async(sql,args)=>{
  called++;
  assert(!/^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  if(sql.includes('count(*)::int AS total')){
   assert.equal(args[0],now.toISOString());return {rows:[{total:2,trials:1,active_accounts:1,paused:0,overdue:1,soon:0}]};
  }
  if(sql.includes('FROM tenants t ORDER BY')){
   assert.deepEqual(args,[]);
   return {rows:[{id:tenant,name:'Empresa A',plan:'essencial',status:'trial',created_at:'2026-10-20T20:00:00Z',
    channels:0,last_inbound:null},
    {id:id(),name:'Empresa B',plan:'equipe',status:'active',created_at:'2026-11-01T20:00:00Z',
     channels:1,last_inbound:null}]};
  }
  throw Error('Unknown master query');
 }};
 await assert.rejects(getMasterSaasMonitor(pool,actor,{now}),{status:403});
 const res=await getMasterSaasMonitor(pool,{...actor,platform_owner:true},{now});
 assert.equal(called,2);
 assert.equal(res.summary.total,2);assert.equal(res.summary.trialCalendarElapsed,1);
 assert.equal(res.summary.confirmedPayingCustomers,null);assert.equal(res.summary.mrrCents,null);
 assert.equal(res.tenants[0].needsAttention,true);
 assert.equal(res.tenants[0].trial.elapsed,true);
 assert.equal(res.trialPolicy.automaticSuspension,false);
 assert.match(res.limitations.join(' '),/Conta ativa não equivale a assinatura paga/);
});
test('business report no longer exposes commerce metrics',()=>{
 const text=formatBusinessMonitor({periodDays:30,alerts:[],
  activity:{inboundMessages30d:1,confirmedBusinessMessages30d:1,conversationsStarted30d:1,
   awaitingBusinessReply30d:0,connectedChannelRecords:1}});
 assert.match(text,/Vendas reais e faturamento confirmado: indisponíveis/);
 assert.doesNotMatch(text,/orçamento|intenç|pedido/i);
});
test('API and dashboard render are read-only; master trial and revenue are explicitly provisional',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/\/api\/reports\/monitor/);assert.match(server,/getTenantBusinessMonitor\(pool,a\)/);
 assert.match(server,/\/api\/admin\/monitor/);assert.match(server,/getMasterSaasMonitor\(pool,a\)/);
 const master=readFileSync(new URL('../public/socio-master-dashboard.js',import.meta.url),'utf8');
 assert.match(master,/monitor\?\.summary/);
 assert.match(master,/Status ativo não significa cliente pagante/);
 assert.match(ui,/Teste 7 dias/);
 assert.match(ui,/Conversas aguardando resposta/);
});
test('PostgreSQL dashboard monitoring isolates two companies and does not modify data',
 {skip:!process.env.DATABASE_URL,timeout:110000},async()=>{
 const schema='socio_monitor_'+randomBytes(5).toString('hex');
 const root=new Pool({connectionString:process.env.DATABASE_URL});
 await root.query('CREATE SCHEMA '+schema);
 const db=new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'});
 try{
  await db.query(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
  const ta=id(),tb=id(),ca=id(),cb=id(),coA=id(),coB=id(),mA=id(),mB=id(),reply=id();
  await db.query("INSERT INTO tenants(id,name,slug,status,plan,created_at) VALUES($1,'Empresa A',$2,'trial','essencial',$5),($3,'Empresa B',$4,'active','equipe',$5)",
   [ta,'mon-a-'+ta.slice(0,8),tb,'mon-b-'+tb.slice(0,8),'2026-11-02T20:00:00Z']);
  await db.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'A','5515999911111','waakg','connected'),($3,$4,'B','5515999922222','waakg','connected')",
   [ca,ta,cb,tb]);
  await db.query("INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone) VALUES($1,$2,$3,'A','5515888811111'),($4,$5,$6,'B','5515888822222')",
   [coA,ta,ca,coB,tb,cb]);
  await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,'inbound','Quero orçamento',now()-interval '1 hour'),($4,$5,$6,'inbound','Olá',now()-interval '2 hours')",
   [mA,ta,coA,mB,tb,coB]);
  await db.query("INSERT INTO messages(id,tenant_id,conversation_id,direction,body,provider_id,created_at) VALUES($1,$2,$3,'outbound','Resposta','msg-test-1',now()-interval '1 hour')",
   [reply,tb,coB]);
  const userA={...actor,active_tenant_id:ta},userB={...actor,active_tenant_id:tb,tenant_status:'active'};
  const repA=await getTenantBusinessMonitor(db,userA,{now:new Date()});
  const repB=await getTenantBusinessMonitor(db,userB,{now:new Date()});
  assert.equal(repA.activity.inboundMessages30d,1);
  assert.equal(repA.activity.awaitingBusinessReply30d,1);
  assert.equal(repB.activity.inboundMessages30d,1);
  assert.equal(repB.activity.confirmedBusinessMessages30d,1);
  assert.equal(repB.activity.awaitingBusinessReply30d,0);
  const platform=await getMasterSaasMonitor(db,{...actor,platform_owner:true},{now:new Date()});
  assert.equal(platform.summary.total,2);assert.equal(platform.summary.confirmedPayingCustomers,null);
  const counts=await db.query('SELECT count(*)::int AS n FROM messages WHERE tenant_id=$1',[ta]);
  assert.equal(counts.rows[0].n,1,'Monitoring must not mutate messages');
 }finally{await db.end().catch(()=>{});await root.query('DROP SCHEMA '+schema+' CASCADE').catch(()=>{});await root.end().catch(()=>{});}
});
