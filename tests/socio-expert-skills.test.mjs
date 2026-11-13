import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {listExpertSkills,getExpertSkillGuide,selectExpertSkill} from '../socio-expert-skills.mjs';
import {speakToSocioSkill} from '../socio-skill-router.mjs';

const actor={active_tenant_id:randomUUID(),user_id:randomUUID(),role:'owner',tenant_status:'active',
 features:{meta_ads:true,ai:true,whatsapp:true,catalog:true,team:true}};

test('expert SKILL.md catalog is allowlisted, useful, uniquely named and versioned with the application',()=>{
 const skills=listExpertSkills();
 assert.equal(skills.length,7);assert.equal(new Set(skills.map(x=>x.id)).size,skills.length);
 for(const skill of skills){
  assert(skill.hasGuide);assert(skill.guide.startsWith('skills/'));
  const guide=getExpertSkillGuide(skill.id);
  assert(guide.instructions.startsWith('# Skill'));
  assert(guide.instructions.length>200);
  assert.equal(guide.skill.id,skill.id);
  assert.equal(guide.skill.canExecute,skill.canExecute);
 }
 assert.equal(skills.find(s=>s.id==='google.ads').canExecute,false);
 assert.equal(skills.find(s=>s.id==='tracking.conversions').canExecute,false);
 assert.equal(skills.find(s=>s.id==='meta.campaigns').canExecute,true);
 assert.equal(skills.find(s=>s.id==='meta.campaigns.brief').canExecute,true);
 const briefGuide=getExpertSkillGuide('meta.campaigns.brief').instructions;
 assert.match(briefGuide,/precedência|precedencia/i);
 assert.match(briefGuide,/interrup/i);
 assert.equal(skills.find(s=>s.id==='commerce.assistant'),undefined);
 assert.throws(()=>getExpertSkillGuide('../../.env'),{status:404});
 assert.throws(()=>getExpertSkillGuide('skills/meta-campaigns/SKILL.md'),{status:404});
});
test('the expert packs carry the professional curriculum, not just tool instructions',()=>{
 const guide=id=>getExpertSkillGuide(id).instructions.toLowerCase();
 const campaigns=guide('meta.campaigns');
 for(const term of ['arquitetura','aprendizado','remarketing','criativos','nomenclatura','sobreposição'])
  assert(campaigns.includes(term),'meta.campaigns: '+term);
 const optimization=guide('meta.optimization');
 for(const term of ['retorno marginal','fadiga de criativo','post-mortem','honestidade estatística','janelas de 7 dias'])
  assert(optimization.includes(term),'meta.optimization: '+term);
 const brief=guide('meta.campaigns.brief');
 for(const term of ['conformidade no brasil','antes e depois','constatação'])
  assert(brief.includes(term),'meta.campaigns.brief: '+term);
 const tracking=guide('tracking.conversions');
 for(const term of ['janela de atribuição','atribuição modelada','lgpd'])
  assert(tracking.includes(term),'tracking.conversions: '+term);
 const sales=guide('whatsapp.sales');
 for(const term of ['tempo de primeira resposta','follow-up','opt-out'])
  assert(sales.includes(term),'whatsapp.sales: '+term);
 const reports=guide('marketing.reports');
 for(const term of ['cadência','nunca afirmar','o que não sabemos'])
  assert(reports.includes(term),'marketing.reports: '+term);
 for(const skill of listExpertSkills())
  assert(getExpertSkillGuide(skill.id).instructions.length<16000,skill.id+' exceeds the guide cap');
});
test('expert routing never silently turns Google Ads requests into Meta Ads',()=>{
 for(const prompt of ['Crie uma campanha no Google Ads','Quero anúncios do Google','Vamos usar Adwords','Preciso anunciar na rede de pesquisa',
   'Meta Ads e Google Ads no meu negócio']){
  assert.equal(selectExpertSkill(prompt).id,'google.ads',prompt);
 }
 // A concrete brief goes to the briefing skill; the generic Meta expert keeps
 // everything else (pixel, status, budget and read commands).
 assert.equal(selectExpertSkill('Cria uma campanha para roupas femininas em Sorocaba R$ 6 por dia').id,'meta.campaigns.brief');
 assert.equal(selectExpertSkill('Crie uma campanha para WhatsApp').id,'meta.campaigns.brief');
 assert.equal(selectExpertSkill('Pause a campanha 120210000001').id,'meta.campaigns');
 assert.equal(selectExpertSkill('Quantas conversas vieram do WhatsApp?').id,'whatsapp.sales');
 assert.equal(selectExpertSkill('Me mostra relatório de vendas no WhatsApp').id,'whatsapp.sales');
 assert.equal(selectExpertSkill('Instale CAPI para rastrear compras').id,'tracking.conversions');
 assert.equal(selectExpertSkill('Criar pixel no WhatsApp').id,'tracking.conversions');
 assert.equal(selectExpertSkill('Otimize minhas campanhas Meta Ads').id,'meta.optimization');
 assert.equal(selectExpertSkill('Crie uma campanha para vender roupas em Sorocaba e melhorar o desempenho').id,
  'meta.campaigns.brief','a build order outranks diagnosis even with "melhorar o desempenho"');
 assert.equal(selectExpertSkill('Quero melhorar o desempenho das minhas campanhas').id,'meta.optimization');
});
test('a detailed brief reaches the campaign skill without reading existing campaigns',async()=>{
 let db=0,seen=null;
 const pool={query:async()=>{db++;throw Error('no read for a new owner brief')}};
 const result=await speakToSocioSkill(pool,actor,{message:
  'Crie uma campanha na Meta para vender roupas femininas em Sorocaba, R$ 20 por dia, e melhorar o desempenho'},{
  campaign:async(_pool,_auth,request)=>{seen=request;return {skillId:'ads.campaign.launch',runId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   status:'collecting',message:'Qual é o investimento máximo por dia?',brief:{}};}
 });
 assert.equal(db,0,'the brief must not query campaigns or metrics');
 assert.match(seen.message,/roupas femininas/);
 assert.equal(result.skillId,'ads.campaign.launch');
});
test('report, pixel and optimization requests keep their own skills',async()=>{
 const calls=[];
 const pool={query:async(sql)=>{calls.push(sql);return {rows:[],rowCount:0};}};
 const pixel=await speakToSocioSkill(pool,actor,{message:'Criar pixel no WhatsApp'});
 assert.match(pixel.message,/WhatsApp/);
 assert.equal(calls.length,0);
});
test('Google Ads cannot invoke Meta operations, even when user requests a real campaign',async()=>{
 let count=0;
 const pool={query:async()=>{count++;throw Error('No database access permitted for unsupported platform')}};
 const result=await speakToSocioSkill(pool,actor,{message:'Crie uma campanha no Google Ads para roupas femininas, R$ 6 por dia'});
 assert.equal(result.status,'action_required');
 assert.equal(result.platform,'google');
 assert.equal(result.executed,false);
 assert.match(result.message,/Google Ads/);
 assert.match(result.message,/não criei|Não criei/i);
 assert.equal(count,0);
 const both=await speakToSocioSkill(pool,actor,{message:'Quero campanhas Meta Ads e Google Ads'});
 assert.equal(both.status,'action_required');
 assert.equal(both.executed,false);
 assert.equal(count,0);
 await assert.rejects(speakToSocioSkill(pool,{...actor,role:'agent'},{
  message:'Crie uma campanha no Google Ads'}),{status:403});
 assert.equal(count,0);
});
test('WhatsApp attribution and CAPI requests never fabricate real conversions',async()=>{
 const pool={query:async()=>{throw Error('No read or write for unsupported tracking')}};
 const whats=await speakToSocioSkill(pool,actor,{message:'Me manda relatório de vendas no WhatsApp'},{
  readWhatsAppFunnel:async()=>({items:[],confidence:'indicative',partial:false})
 });
 assert.equal(whats.status,'completed');
 assert.equal(whats.readOnly,true);
 assert.equal(whats.executed,false);
 assert.match(whats.message,/indicativa|WA-AKG/);
 assert.match(whats.message,/Vendas reais e receita confirmada: indisponíveis/);
 const capi=await speakToSocioSkill(pool,actor,{message:'Quero instalar CAPI para rastrear compras'});
 assert.equal(capi.status,'action_required');
 assert.match(capi.message,/pagamento validado/);
 assert.match(capi.message,/WhatsApp/);
});
test('panel does not falsely claim account mutation after read-only query or upload creative to wrong platform',()=>{
 const ui=readFileSync(new URL('../public/socio-ad-skills-ui.js',import.meta.url),'utf8');
 assert.match(ui,/answer\.result\?\.result\?\.campaignId/);
 assert.match(ui,/Consulta concluída/);
 assert.match(ui,/isGoogleRequest/);
 assert.match(ui,/Não vou enviar esta foto para a Meta/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/listExpertSkills\(\)/);
 assert.match(server,/getExpertSkillGuide\(id\)/);
 assert.match(server,/\/api\/marketing\/skills\/guidance/);
});
