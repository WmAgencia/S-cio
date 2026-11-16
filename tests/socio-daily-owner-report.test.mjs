import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dailyOwnerReportDue,saoPauloReportDate,formatDailyOwnerReport,processDueDailyOwnerReport}
 from '../socio-daily-owner-report.mjs';

const tenant='11111111-1111-4111-8111-111111111111';
const group='22222222-2222-4222-8222-222222222222';
const receipt='33333333-3333-4333-8333-333333333333';
const env={SOCIO_DAILY_OWNER_REPORTS_ENABLED:'true',SOCIO_OUTBOUND_ENABLED:'true',
 WA_AKG_API_KEY:'fixture-secret',WA_AKG_BASE_URL:'http://private-gateway'};

test('20:00 is evaluated on the São Paulo calendar',()=>{
 assert.equal(dailyOwnerReportDue(new Date('2026-11-16T22:59:00Z')),false);
 assert.equal(dailyOwnerReportDue(new Date('2026-11-16T23:00:00Z')),true);
 assert.equal(saoPauloReportDate(new Date('2026-11-17T01:30:00Z')),'2026-11-16');
});

test('daily message is code-written and keeps campaign leads separate from messages',()=>{
 const text=formatDailyOwnerReport({date:'2026-11-16',company:'Loja Teste',period:{
  leads:{campaign:3},sales:{confirmed:2,revenueCents:15990}},meta:{items:[
   {spend:'12.5',clicks:'40',impressions:'1200',status:'ACTIVE'},
   {spend:'7.5',clicks:'10',impressions:'300',status:'PAUSED'}]}});
 assert.match(text,/Investimento em campanhas: R\$\s20,00/);
 assert.match(text,/Leads de campanhas no WhatsApp: 3/);
 assert.match(text,/Cliques: 50/);
 assert.match(text,/Vendas confirmadas: 2/);
 assert.match(text,/Faturamento confirmado: R\$\s159,90/);
 assert.match(text,/Quantidade de mensagens não aumenta esse número/);
});

test('due worker claims one group, sends once and stores a terminal receipt',async()=>{
 const calls=[],sent=[];
 const client={query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
  if(sql.includes('FROM socio_owner_groups g'))return {rowCount:1,rows:[{
   group_id:group,tenant_id:tenant,group_jid:'123456789012345@g.us',session_id:'fixture_session',
   tenant_name:'Loja Teste',features:{whatsapp:true,meta_ads:true},tenant_status:'active',
   user_id:'44444444-4444-4444-8444-444444444444',role:'owner',platform_owner:false}]};
  if(sql.includes('INSERT INTO socio_daily_owner_reports'))return {rowCount:1,rows:[{id:receipt}]};
  throw new Error('unexpected client SQL '+sql);
 },release(){}};
 const pool={connect:async()=>client,query:async(sql,args=[])=>{calls.push({sql,args});return {rowCount:1,rows:[]};}};
 const result=await processDueDailyOwnerReport(pool,{env,now:new Date('2026-11-16T23:00:00Z'),
  summarize:async()=>({leads:{campaign:4},sales:{confirmed:1,revenueCents:8990}}),
  read:async()=>({items:[{spend:'15.25',clicks:'21',impressions:'900',status:'ACTIVE'}]}),
  send:async input=>{sent.push(input);return {sent:true,providerId:'wamid.report.1'};}});
 assert.equal(result.status,'sent');
 assert.equal(sent.length,1);
 assert.match(sent[0].text,/Leads de campanhas no WhatsApp: 4/);
 assert(calls.some(call=>call.sql.includes("status='sent'")));
 assert(calls.some(call=>call.sql.includes('NOT EXISTS')));
});

test('worker is opt-in and ambiguous delivery is terminal, never automatically retried',async()=>{
 assert.deepEqual(await processDueDailyOwnerReport({}, {env:{},now:new Date('2026-11-16T23:00:00Z')}),
  {processed:false,reason:'REPORTS_DISABLED'});
 const source=readFileSync(new URL('../socio-daily-owner-report.mjs',import.meta.url),'utf8');
 assert.match(source,/status='uncertain'/);
 assert.match(source,/UNIQUE\(group_id,report_date\)|ON CONFLICT\(group_id,report_date\)/);
 assert.doesNotMatch(source,/brainResponse|deepseek|groq/i,'numbers are formatted without model cost');
});
