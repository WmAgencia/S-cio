import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {listExpertSkills,getExpertSkillGuide,selectExpertSkill} from '../socio-expert-skills.mjs';
import {speakToSocioSkill} from '../socio-skill-router.mjs';

const actor={active_tenant_id:randomUUID(),user_id:randomUUID(),role:'owner',tenant_status:'active',
 features:{meta_ads:true,ai:true,whatsapp:true,catalog:true,quotes:true,team:true}};

test('expert SKILL.md catalog is allowlisted, useful, uniquely named and versioned with the application',()=>{
 const skills=listExpertSkills();
 assert.equal(skills.length,6);assert.equal(new Set(skills.map(x=>x.id)).size,skills.length);
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
 assert.throws(()=>getExpertSkillGuide('../../.env'),{status:404});
 assert.throws(()=>getExpertSkillGuide('skills/meta-campaigns/SKILL.md'),{status:404});
});
test('expert routing never silently turns Google Ads requests into Meta Ads',()=>{
 for(const prompt of ['Crie uma campanha no Google Ads','Quero anúncios do Google','Vamos usar Adwords','Preciso anunciar na rede de pesquisa',
   'Meta Ads e Google Ads no meu negócio']){
  assert.equal(selectExpertSkill(prompt).id,'google.ads',prompt);
 }
 assert.equal(selectExpertSkill('Cria uma campanha para roupas femininas em Sorocaba R$ 6 por dia').id,'meta.campaigns');
 assert.equal(selectExpertSkill('Crie uma campanha para WhatsApp').id,'meta.campaigns');
 assert.equal(selectExpertSkill('Quantas conversas vieram do WhatsApp?').id,'whatsapp.sales');
 assert.equal(selectExpertSkill('Me mostra relatório de vendas no WhatsApp').id,'whatsapp.sales');
 assert.equal(selectExpertSkill('Instale CAPI para rastrear compras').id,'tracking.conversions');
 assert.equal(selectExpertSkill('Criar pixel no WhatsApp').id,'tracking.conversions');
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
 const whats=await speakToSocioSkill(pool,actor,{message:'Me manda relatório de vendas no WhatsApp'});
 assert.equal(whats.status,'action_required');
 assert.equal(whats.executed,false);
 assert.match(whats.message,/indicativa|WA-AKG/);
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
