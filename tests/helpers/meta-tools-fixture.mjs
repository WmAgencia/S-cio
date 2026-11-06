import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readAdvancedMetaTool} from '../../meta-ads-advanced.mjs';
import {saveMetaReportSchedule,listMetaReportSchedule,processDueMetaReport} from '../../meta-report-schedules.mjs';
import {officialPersistenceScenario} from './meta-official-fixture.mjs';
import {selectOfficialAccount} from '../../meta-official.mjs';
import {readAdsTool,prepareAdsPlan,executeAdsPlan,uploadAdImage,inspectOfficialCampaign} from '../../meta-ads-tools.mjs';
export async function metaToolsScenario(pool){
 const {actors,env,request:oauthRequest}=await officialPersistenceScenario(pool),a=actors[0];
 let writes=[],uncertain=false,fallbackPages=false;
 const response=data=>({ok:true,json:async()=>data});
 const request=async(url,options={})=>{
  const u=new URL(url),path=u.pathname.replace(/^\/v\d+\.0/,'');
  assert(!u.searchParams.has('access_token'));
  if(options.method==='POST'){
   writes.push({path,body:Object.fromEntries(options.body)});
   if(uncertain)throw Error('Timeout after uncertain delivery');
   if(path.endsWith('/adimages'))return response({images:{fixture:{hash:'image-hash'}}});
   return response(path==='/998877'?{success:true}:{id:String(900000+writes.length)});
  }
  if(path.endsWith('/promote_pages'))return response({data:fallbackPages?[]:[{id:'445566',name:'Página autorizada'}]});
  if(path.endsWith('/adcreatives'))return response({data:[{id:'334455',name:'Criativo da conta'}]});
  if(path.endsWith('/advideos'))return response({data:[{id:'112233',title:'Vídeo da conta'}]});
  if(path.endsWith('/customaudiences'))return response({data:[{id:'12345678',name:'Público permitido'}]});
  if(path.endsWith('/adspixels'))return response({data:[{id:'12345678',name:'Pixel'}]});
  if(path.endsWith('/customconversions'))return response({data:[{id:'12345678',name:'Conversão'}]});
  if(path.endsWith('/insights'))return response({data:[{campaign_id:'123456',campaign_name:'Teste',spend:'12.50',clicks:'5',impressions:'100',reach:'80'}]});

  if(path.endsWith('/adimages'))return response({data:[{hash:'image-hash',name:'Imagem'}]});
  if(path==='/search')return response({data:[{key:'654321',name:'Sorocaba',region:'São Paulo',country_name:'Brasil'}]});
  if(path.endsWith('/ads'))return response({data:[{id:'554433',creative:{object_story_spec:{page_id:'445566'}}}]});
  if(path==='/act_123456')return response({id:'act_123456',currency:'BRL',amount_spent:'1234',spend_cap:'2000',business:{id:'777888'}});
  if(path==='/445566')return response({id:'445566',name:'Página existente na conta'});
  if(path==='/998877/adsets')return response({data:[{id:'121212',name:'Conjunto de teste',effective_status:'ACTIVE'}]});
  if(path==='/998877/ads')return response({data:[{id:'343434',name:'Anúncio de teste',effective_status:'ACTIVE'}]});
  if(path==='/998877/insights')return response({data:[{campaign_id:'998877',spend:'12.27',clicks:'488',impressions:'3098'}]});
  if(path==='/998877')return response({id:'998877',account_id:'123456',name:'Existing'});
  if(path==='/887766')return response({id:'887766',account_id:'999999',name:'Other tenant account'});
  if(path.endsWith('/campaigns'))return response({data:[{id:'998877',name:'Existing',status:'PAUSED'}]});
  return oauthRequest(url,options);
 };
 const opts={env,request};await selectOfficialAccount(pool,a,'act_123456',opts);
 const scheduled=await saveMetaReportSchedule(pool,a,{hour:'20:00',timeZone:'America/Sao_Paulo',period:'yesterday',enabled:true},opts);
 assert.equal(scheduled.schedule.account_id,'act_123456');
 assert.equal(scheduled.delivery,'panel_only');
 await pool.query("UPDATE meta_report_schedules SET next_run_at=now()-interval '1 minute' WHERE tenant_id=$1",[a.active_tenant_id]);
 const reportRun=await processDueMetaReport(pool,{env:{SOCIO_META_REPORTS_ENABLED:'true'},read:async(_pool,actor,kind,input)=>{
  assert.equal(actor.active_tenant_id,a.active_tenant_id);
  assert.equal(kind,'reports');assert.equal(input.period,'yesterday');
  return {accountId:'act_123456',summary:{spend:12.50,currency:'BRL',clicks:5,impressions:100},items:[]};
 }});
 assert.equal(reportRun.status,'completed');
 assert.equal((await listMetaReportSchedule(pool,a)).runs[0].summary.spend,12.5);
 assert.equal((await processDueMetaReport(pool,{env:{SOCIO_META_REPORTS_ENABLED:'false'}})).reason,'REPORTS_DISABLED');

 assert.equal((await readAdsTool(pool,a,'campaigns',{},opts)).items[0].id,'998877');
 const campaignAudit=await inspectOfficialCampaign(pool,a,'998877',opts);
 assert.equal(campaignAudit.accountId,'act_123456');
 assert.equal(campaignAudit.readOnly,true);
 assert.equal(campaignAudit.adsets.length,1);
 assert.equal(campaignAudit.ads[0].effective_status,'ACTIVE');
 assert.equal(campaignAudit.insights[0].spend,'12.27');
 assert.equal(writes.length,0,'Read-only campaign audit may never write to Meta');
 await assert.rejects(inspectOfficialCampaign(pool,a,'887766',opts),{status:403});

 const beforeReadWrites=writes.length;
 for(const kind of ['creatives','videos','audiences','pixels','conversions','reports','diagnosis','account']){
  const advanced=await readAdvancedMetaTool(pool,a,kind,{period:'last_7d',level:'ad',breakdown:'none'},opts);
  assert.equal(advanced.readOnly,true);
 }
 assert.equal(writes.length,beforeReadWrites,'Advanced tools must be read-only');
 const diagnostic=await readAdvancedMetaTool(pool,a,'diagnosis',{},opts);
 assert.equal(diagnostic.summary.spend,12.5);
 assert.match(diagnostic.warning,/não são mensagens/);
 const finance=await readAdsTool(pool,a,'finance',{},opts);assert.equal(new URL(finance.paymentsUrl).pathname,'/billing_hub/payment_settings/');assert.equal(new URL(finance.paymentsUrl).searchParams.get('business_id'),'777888');
 await assert.rejects(prepareAdsPlan(pool,a,'status',{entity:'campaign',id:'887766',status:'ACTIVE'},opts),{status:403});
 await assert.rejects(prepareAdsPlan(pool,{...a,role:'agent'},'status',{entity:'campaign',id:'998877',status:'ACTIVE'},opts),{status:403});
 fallbackPages=true;assert.equal((await readAdsTool(pool,a,'pages',{},opts)).items[0].id,'445566');
 const input={name:'Tráfego teste',url:'https://example.test',headline:'Teste',message:'Descrição do anúncio',pageId:'445566',imageHash:'image-hash',cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:2000};
 const plan=await prepareAdsPlan(pool,a,'create',input,opts);assert.equal(writes.length,0,'A preview must not write to Meta');assert.equal(plan.summary.message,input.message);assert.equal(plan.summary.imageHash,input.imageHash);
 await assert.rejects(executeAdsPlan(pool,a,plan.id,false,opts),{status:422});
 const result=await executeAdsPlan(pool,a,plan.id,true,opts);assert.equal(result.status,'succeeded');assert.equal(writes.length,4);
 assert.equal(writes[0].body.status,'PAUSED');assert.equal(writes[1].body.status,'PAUSED');assert.equal(writes[3].body.status,'PAUSED');
 // WhatsApp: use ONLY a WhatsApp number connected inside this tenant.
 await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'Vendas','5515999999999','waakg','connected')",
  [randomUUID(),a.active_tenant_id]);
 const wa={...input,whatsappPhone:'5515999999999'};
 delete wa.url;
 const waPlan=await prepareAdsPlan(pool,a,'create_whatsapp',wa,opts);
 assert.equal(writes.length,4,'WhatsApp preflight cannot make Meta writes');
 const waResult=await executeAdsPlan(pool,a,waPlan.id,true,opts);
 assert.equal(waResult.status,'succeeded');
 assert.equal(writes.length,8);
 assert.equal(writes[4].body.objective,'OUTCOME_ENGAGEMENT');
 assert.equal(writes[5].body.destination_type,'WHATSAPP');
 assert.equal(writes[5].body.optimization_goal,'CONVERSATIONS');
 assert.equal(JSON.parse(writes[5].body.promoted_object).whatsapp_phone_number,'5515999999999');
 assert.equal(JSON.parse(writes[6].body.object_story_spec).link_data.call_to_action.type,'WHATSAPP_MESSAGE');
 await assert.rejects(prepareAdsPlan(pool,a,'create_whatsapp',{...wa,whatsappPhone:'5515888888888'},opts),{status:422});
 const adOnly=await prepareAdsPlan(pool,a,'create_ad',{...input,adsetId:'998877'},opts);
 assert.equal(writes.length,8,'Standalone ad preview does not write to Meta');
 const adOnlyResult=await executeAdsPlan(pool,a,adOnly.id,true,opts);
 assert.equal(adOnlyResult.status,'succeeded');
 assert.equal(writes.length,10);
 assert.equal(writes[9].body.status,'PAUSED');
 assert.equal(writes[9].body.adset_id,'998877');
 const campaignBudget=await prepareAdsPlan(pool,a,'budget',{entity:'campaign',id:'998877',dailyBudgetCents:4000},opts);
 assert.match(campaignBudget.summary.description,/orçamento/i);
 assert.equal(writes.length,10,'Budget preview does not write to Meta');

 assert.equal(writes[1].body.daily_budget,'2000');assert.equal(JSON.parse(writes[1].body.targeting).geo_locations.cities[0].key,'654321');
 await executeAdsPlan(pool,a,plan.id,true,opts);assert.equal(writes.length,10,'Repeated execution must not duplicate entities');
 const rename=await prepareAdsPlan(pool,a,'rename',{entity:'campaign',id:'998877',name:'Novo nome'},opts);
 assert.equal((await executeAdsPlan(pool,a,rename.id,true,opts)).status,'succeeded');
 const timed=await prepareAdsPlan(pool,a,'create',input,opts);uncertain=true;
 const failed=await executeAdsPlan(pool,a,timed.id,true,opts);assert.equal(failed.status,'uncertain');const count=writes.length;
 await assert.rejects(executeAdsPlan(pool,a,timed.id,true,opts),{status:409});assert.equal(writes.length,count);
 uncertain=false;
 const expired=await prepareAdsPlan(pool,a,'status',{entity:'campaign',id:'998877',status:'PAUSED'},opts);
 await pool.query("UPDATE meta_ads_plans SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);
 await assert.rejects(executeAdsPlan(pool,a,expired.id,true,opts),{status:409});
 const sharp=(await import('sharp')).default;const bytes=await sharp({create:{width:100,height:100,channels:3,background:'#333'}}).png().toBuffer();
 assert.equal((await uploadAdImage(pool,a,bytes.toString('base64'),opts)).hash,'image-hash');
}
