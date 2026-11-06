import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMetaCommand} from '../meta-ads-commands.mjs';
import {validateMetaReport,summarizeMetaInsights,META_TOOL_CATALOG} from '../meta-ads-advanced.mjs';
import {validateAdsPlan} from '../meta-ads-tools.mjs';

test('Meta commands offer account-scoped read-only summaries',()=>{
 const c=parseMetaCommand('Me mostra os resultados dos anúncios dos últimos 30 dias');
 assert.equal(c.intent,'read');
 assert.equal(c.kind,'reports');
 assert.equal(c.input.level,'ad');
 assert.equal(c.input.period,'last_30d');
 assert.equal(c.willSpend,false);
});
test('Meta commands cannot execute; only emit an executable preview with explicit IDs',()=>{
 const pause=parseMetaCommand('Pausa a campanha ID 1234567890');
 assert.deepEqual([pause.intent,pause.kind,pause.input.status,pause.input.id],['plan','status','PAUSED','1234567890']);
 const activate=parseMetaCommand('Ative o anúncio ID 987654321');
 assert.equal(activate.input.status,'ACTIVE');
 assert.equal(activate.willSpend,true);
 const budget=parseMetaCommand('Altere o orçamento do conjunto ID 1234567890 para R$ 20 por dia');
 assert.equal(budget.kind,'budget');
 assert.equal(budget.input.entity,'adset');
 assert.equal(budget.input.id,'1234567890');
 assert.equal(budget.input.dailyBudgetCents,2000);
 assert.equal(budget.willSpend,true);
 const incomplete=parseMetaCommand('Pausar campanha');
 assert(incomplete.missing.length);
 assert.throws(()=>parseMetaCommand('oi'),/Descreva/);
});
test('photo + budget + city creates only a draft without hallucinating required Meta IDs',()=>{
 const r=parseMetaCommand('Suba esse anúncio para Sorocaba de R$ 20 por dia direcionando para WhatsApp');
 assert.equal(r.intent,'needs_details');
 assert.equal(r.kind,'create_whatsapp');
 assert.equal(r.extracted.dailyBudgetCents,2000);
 assert.match(r.missing.join(' '),/Página/);
});
test('advanced account insights distinguish Meta click metrics from WhatsApp leads',()=>{
 const values=summarizeMetaInsights([{spend:'10.50',clicks:'3',impressions:'100',campaign_id:'123456',campaign_name:'Teste'},
  {spend:'4.50',clicks:'0',impressions:'100'}],{currency:'BRL'});
 assert.equal(values.spend,15);
 assert.equal(values.impressions,200);
 assert.equal(values.clicks,3);
 assert.equal(values.ctrPercent,1.5);
 assert.match(values.qualification,/não são mensagens/);
 assert.equal(validateMetaReport({period:'invalid',level:'x',breakdown:'__proto__'}).level,'campaign');
 for(const tool of META_TOOL_CATALOG)assert.equal(tool.readOnly,true);
});
test('both WhatsApp and website plans validate independently and remain paused via execution code',()=>{
 const original={name:'Teste Local',pageId:'123456',imageHash:'abc123',cityName:'Sorocaba',cityKey:'654321',
  headline:'Manutenção',message:'Chame a equipe',dailyBudgetCents:2000};
 assert.equal(validateAdsPlan('create_whatsapp',{...original,whatsappPhone:'5515999999999'}).whatsappPhone,'5515999999999');
 assert.equal(validateAdsPlan('create',{...original,url:'https://site.example.test'}).url,'https://site.example.test');
 assert.throws(()=>validateAdsPlan('create_whatsapp',{...original,whatsappPhone:'551500'}));
 const source=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');
 assert.match(source,/destination_type:whatsapp\?'WHATSAPP':'WEBSITE'/);
 assert.match(source,/result.delivery='PAUSED'/);
 assert.match(source,/promoted_object:/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/\/api\/marketing\/commands\/preview/);
 assert.match(server,/\/api\/marketing\/advanced\/catalog/);
});
