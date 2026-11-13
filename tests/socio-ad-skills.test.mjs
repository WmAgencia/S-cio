import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {extractCampaignBrief,chooseMetaCity,skillAdCopy,speakToAdSkill,readCampaignProgress,SOCIO_AD_SKILLS,isConfirmation} from '../socio-ad-skills.mjs';
import {validateAdsPlan} from '../meta-ads-tools.mjs';
const tenant=randomUUID(),user=randomUUID();
const actor={active_tenant_id:tenant,user_id:user,tenant_name:'Loja exemplo',role:'owner',
 tenant_status:'active',features:{whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true}};
const imageHash='abcdef0123456789abcdef0123456789';
const pages=[{id:'445566',name:'Loja Exemplo'}],images=[{hash:imageHash,name:'Foto moda feminina catálogo'}];
const read=async(_db,_actor,kind)=>({
 cities:{items:[{key:'654321',name:'Sorocaba',region:'SP',country_name:'Brasil'}]},
 pages:{items:pages},images:{items:images}
})[kind]||{items:[]};

function fakePool(){
 const runs=new Map();
 const query=async(sql,params=[])=>{
  if(sql.startsWith('SELECT label,phone FROM channels'))
   return {rowCount:1,rows:[{label:'Loja',phone:'5515999999999'}]};
  if(sql.startsWith('INSERT INTO socio_skill_runs')){
   const [id,tid,uid,accountId,brief]=params;
   const row={id,tenant_id:tid,user_id:uid,account_id:accountId,skill:'ads.campaign.launch',
    status:'collecting',brief:JSON.parse(brief),result:null,plan_id:null};
   runs.set(id,row);return {rowCount:1,rows:[{...row}]};
  }
  if(sql.startsWith('SELECT * FROM socio_skill_runs')){
   const [id,tid,uid]=params,row=runs.get(id);
   return {rowCount:row&&row.tenant_id===tid&&row.user_id===uid?1:0,
    rows:row&&row.tenant_id===tid&&row.user_id===uid?[{...row}]:[]};
  }
  if(sql.startsWith('UPDATE socio_skill_runs SET brief=$2::jsonb,updated_at')){
   const row=runs.get(params[0]);row.brief=JSON.parse(params[1]);return {rowCount:1};
  }
  if(sql.startsWith('UPDATE socio_skill_runs SET brief=$2::jsonb,plan_id=$3')){
   const row=runs.get(params[0]);row.brief=JSON.parse(params[1]);row.plan_id=params[2];
   row.pixel_plan_id=params[3]||null;row.status='ready';return {rowCount:1};
  }
  if(sql.startsWith("UPDATE socio_skill_runs SET status='executing'")){
   const row=runs.get(params[0]);if(!row||row.status!=='ready')return {rowCount:0,rows:[]};
   row.status='executing';return {rowCount:1,rows:[{...row}]};
  }
  if(sql.startsWith("UPDATE socio_skill_runs SET status='collecting',plan_id=NULL")){
   const row=runs.get(params[0]);
   if(!row||row.status!=='failed')return {rowCount:0,rows:[]};
   row.status='collecting';row.plan_id=null;row.pixel_plan_id=null;row.result=null;
   return {rowCount:1,rows:[{...row}]};
  }
  if(sql.startsWith('UPDATE socio_skill_runs SET status=$2,result=$3::jsonb')){
   const row=runs.get(params[0]);row.status=params[1];row.result=JSON.parse(params[2]);return {rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,100));
 };
 return {query,runs};
}
const resolve=async()=>({id:'act_123456789',currency:'BRL'});
test('campaign brief understands spoken Brazilian Portuguese and separates buying desire from proven Meta interests',()=>{
 const b=extractCampaignBrief('Quero conseguir clientes que gostem de comprar roupa feminina em Sorocaba gastando seis reais por dia');
 assert.equal(b.category,'moda feminina');
 assert.equal(b.cityName,'Sorocaba');
 assert.equal(b.dailyBudgetCents,600);
 assert.deepEqual(b.genders,[2]);
 assert.equal(b.interestIntent,true);
 assert.equal(b.destination,undefined);
 const numeric=extractCampaignBrief('Quero anunciar roupa feminina em Sorocaba por R$ 6 por dia');
 assert.equal(numeric.dailyBudgetCents,600);
 const other=extractCampaignBrief('Quero vender bolos caseiros em Sorocaba gastando R$ 6 por dia');
 assert.equal(other.category,'bolos caseiros');
 assert.equal(other.cityName,'Sorocaba');
 const money=extractCampaignBrief('Quero vender roupa feminina em Sorocaba gastando R$ 6,50 por dia');
 assert.equal(money.dailyBudgetCents,650);
 assert.equal(chooseMetaCity([{key:'654321',name:'Sorocaba'}],'Sorocaba').key,'654321');
 assert.equal(chooseMetaCity([{key:'1',name:'Sorocaba'},{key:'2',name:'Sorocaba'}],'Sorocaba'),null);
 const copy=skillAdCopy({...b,destination:'whatsapp'},'Loja Exemplo');
 assert.match(copy.message,/WhatsApp/);
 assert(!copy.message.includes('R$'));
});
test('selected account + WA-AKG + page + qualified photo prepare a campaign, but NEVER post before message approval',async()=>{
 const pool=fakePool(),actions=[];
 const options={resolve,read,
  prepare:async(_pool,a,kind,input)=>{
   actions.push({type:'prepare',tenant:a.active_tenant_id,kind,input});
   return {id:randomUUID()};
  },
  execute:async(_pool,a,id,confirmed)=>{
   actions.push({type:'execute',id,confirmed,tenant:a.active_tenant_id});
   return {status:'succeeded',result:{campaignId:'900001',adsetId:'900002',adId:'900003',delivery:'PAUSED'}};
  }};
 const request='Cria uma campanha para roupa feminina em Sorocaba gastando seis reais por dia';
 const start=await speakToAdSkill(pool,actor,{message:request},options);
 assert.equal(start.status,'ready');
 assert.equal(start.creativeVariants.length,3);
 assert.equal(start.selectedCreativeStyle,'apresentacao');
 assert(start.creativeVariants.every(x=>x.headline&&x.message));
 assert.equal(start.brief.dailyBudgetCents,600);
 assert.equal(start.brief.destination,'whatsapp');
 assert.equal(start.brief.whatsappPhone,'5515999999999');
 assert.deepEqual(start.brief.genders,[2]);
 assert.equal(actions.length,1);assert.equal(actions[0].type,'prepare');
 assert.equal(actions[0].kind,'create_whatsapp');
 assert.equal(actions[0].input.cityKey,'654321');
 assert.equal(actions[0].input.pageId,'445566');
 assert.equal(actions[0].input.imageHash,imageHash);
 assert.deepEqual(actions[0].input.genders,[2]);
 assert.equal(validateAdsPlan(actions[0].kind,actions[0].input).dailyBudgetCents,600);
 await assert.rejects(speakToAdSkill(pool,{...actor,active_tenant_id:randomUUID()},
  {message:'pode criar',runId:start.runId},options),e=>e.status===404);
 const no=await speakToAdSkill(pool,actor,{message:'Não, espera',runId:start.runId},options);
 assert.equal(no.status,'ready');assert.equal(actions.length,1);
 const confirmed=await speakToAdSkill(pool,actor,{message:'pode criar',runId:start.runId},options);
 assert.equal(confirmed.status,'completed');
 assert.match(confirmed.message,/criados e pausados/i);
 assert.equal(actions.length,2);
 assert.equal(actions[1].confirmed,true);
 const replay=await speakToAdSkill(pool,actor,{message:'pode criar',runId:start.runId},options);
 assert.equal(replay.status,'completed');
 assert.equal(actions.length,2,'No duplicate Meta POST for same skill run');
});
test('skill asks only for creative when assets do not match and lets owner provide an uploaded image in next message',async()=>{
 const pool=fakePool(),prepared=[];
 const noImages=async(_p,_a,kind)=>kind==='images'?{items:[{hash:imageHash,name:'Carro usado'}]}:read(_p,_a,kind);
 const opts={resolve,read:noImages,prepare:async(p,a,kind,input)=>{prepared.push(input);return{id:randomUUID()};}};
 const start=await speakToAdSkill(pool,actor,{message:'Quero divulgar roupa feminina em Sorocaba gastando R$ 6 por dia'},opts);
 assert.equal(start.status,'collecting');
 assert.equal(start.slot,'media','the page knows the run is waiting for the creative');
 assert.match(start.message,/foto/i);
 assert.equal(prepared.length,0,'No Meta write or plan when image is missing');
 const withImage=await speakToAdSkill(pool,actor,{message:'',runId:start.runId,imageHash},opts);
 assert.equal(withImage.status,'ready');
 assert.equal(prepared.length,1);
 assert.equal(prepared[0].imageHash,imageHash);
});
test('the automatic attachment message never replaces an answered slot',async()=>{
 const pool=fakePool(),prepared=[];
 const noImages=async(_p,_a,kind)=>kind==='images'?{items:[]}:read(_p,_a,kind);
 const opts={resolve,read:noImages,prepare:async(_p,_a,kind,input)=>{prepared.push(input);return{id:randomUUID()};}};
 const start=await speakToAdSkill(pool,actor,{message:'Quero divulgar roupa feminina em Sorocaba gastando R$ 6 por dia'},opts);
 assert.equal(start.slot,'media');
 const attached=await speakToAdSkill(pool,actor,{message:'Anexei o criativo do anúncio.',runId:start.runId,imageHash},opts);
 assert.equal(attached.status,'ready');
 assert.equal(attached.brief.cityName,'Sorocaba','the attachment notice is not read as a city');
 assert.equal(attached.brief.dailyBudgetCents,600);
 assert.equal(prepared.length,1);
 assert.equal(prepared[0].imageHash,imageHash);
});
test('non-fashion businesses can answer a simple product question conversationally',async()=>{
 const pool=fakePool(),opts={resolve,read};
 const started=await speakToAdSkill(pool,actor,{message:'Crie uma campanha em Sorocaba gastando R$ 6 por dia'},opts);
 assert.equal(started.status,'collecting');
 assert.match(started.message,/produto ou serviço/);
 const replied=await speakToAdSkill(pool,actor,{message:'Bolos caseiros',runId:started.runId},opts);
 assert.equal(replied.status,'collecting');
 assert.equal(replied.brief.category,'Bolos caseiros');
 assert.match(replied.message,/foto/i);
});
test('any free description is a valid subject, with or without a catalog item',async()=>{
 const pool=fakePool(),opts={resolve,read};
 const started=await speakToAdSkill(pool,actor,{message:'Crie uma campanha em Sorocaba gastando R$ 6 por dia'},opts);
 assert.match(started.message,/catálogo/);
 assert.match(started.message,/outra coisa/);
 const vague=await speakToAdSkill(pool,actor,{message:'meus produtos',runId:started.runId},opts);
 assert.equal(vague.brief.category,null,'a placeholder must not become the advertised subject');
 assert.match(vague.message,/Ainda não identifiquei o produto ou serviço/);
 const free=await speakToAdSkill(pool,actor,{message:'meu curso de violão',runId:started.runId},opts);
 assert.equal(free.brief.category,'curso de violão');
 assert.match(free.message,/foto ou um vídeo/);
});
test('"Brasil inteiro" is remembered and never asked back as a city',async()=>{
 const pool=fakePool(),prepared=[];
 const noImages=async(p,a,kind)=>kind==='images'?{items:[]}:read(p,a,kind);
 const opts={resolve,read:noImages,prepare:async(_p,_a,kind,input)=>{prepared.push({kind,input});return{id:randomUUID()};}};
 const started=await speakToAdSkill(pool,actor,{
  message:'Quero divulgar o sistema sócio para o Brasil inteiro gastando seis reais por dia'},opts);
 assert.equal(started.status,'collecting');
 assert.equal(started.brief.countryCode,'BR');
 assert.equal(started.brief.cityName,'todo o Brasil');
 assert.equal(started.brief.dailyBudgetCents,600);
 assert.match(started.message,/foto ou um vídeo/);
 assert(!/cidade|estado/i.test(started.message),'countrywide brief must not ask for a city again');
 const ready=await speakToAdSkill(pool,actor,{
  message:'Acabei de enviar o vídeo',runId:started.runId,videoId:'123456789012345'},opts);
 assert.equal(ready.status,'ready');
 assert.equal(prepared.length,1);
 assert.equal(prepared[0].kind,'create_whatsapp');
 assert.equal(prepared[0].input.countryCode,'BR');
 assert.equal(prepared[0].input.cityName,'todo o Brasil');
 assert.equal(prepared[0].input.cityKey,undefined);
 assert.equal(prepared[0].input.videoId,'123456789012345');
 assert.equal(validateAdsPlan(prepared[0].kind,prepared[0].input).countryCode,'BR');
 assert.match(ready.message,/todo o Brasil/);
});
test('a spoken budget answer is read in the context of the budget question',async()=>{
 const pool=fakePool(),prepared=[];
 const noImages=async(p,a,kind)=>kind==='images'?{items:[]}:read(p,a,kind);
 const opts={resolve,read:noImages,prepare:async(_p,_a,kind,input)=>{prepared.push(input);return{id:randomUUID()};}};
 const started=await speakToAdSkill(pool,actor,{message:'Quero divulgar o sistema sócio em Sorocaba'},opts);
 assert.equal(started.status,'collecting');
 assert.match(started.message,/investimento máximo por dia/i);
 const budget=await speakToAdSkill(pool,actor,{message:'pode ser doze reais por dia',runId:started.runId},opts);
 assert.equal(budget.brief.dailyBudgetCents,1200);
 assert.match(budget.message,/foto ou um vídeo/);
 const barePool=fakePool();
 const bareStart=await speakToAdSkill(barePool,actor,{message:'Quero divulgar o sistema sócio em Sorocaba'},opts);
 const bareAnswer=await speakToAdSkill(barePool,actor,{message:'12',runId:bareStart.runId},opts);
 assert.equal(bareAnswer.brief.dailyBudgetCents,1200);
});
test('repeating a question clarifies the expected answer instead of accepting a non-answer',async()=>{
 const pool=fakePool(),opts={resolve,read};
 const started=await speakToAdSkill(pool,actor,{
  message:'Quero divulgar o sistema sócio gastando seis reais por dia'},opts);
 assert.equal(started.status,'collecting');
 assert.match(started.message,/todo o Brasil ou em uma cidade/i);
 const repeated=await speakToAdSkill(pool,actor,{message:'Não sei ainda',runId:started.runId},opts);
 assert.equal(repeated.status,'collecting');
 assert.equal(repeated.brief.cityName,null);
 assert.match(repeated.message,/Ainda não identifiquei o local/);
});
test('execution progress reports only the owned run and the stages Meta already confirmed',async()=>{
 const runId=randomUUID();
 const progressPool={query:async(sql,params)=>{
  if(!sql.includes('FROM socio_skill_runs r'))throw Error('Unexpected SQL: '+sql.slice(0,80));
  const owned=params[0]===runId&&params[1]===tenant&&params[2]===user;
  return {rowCount:owned?1:0,rows:owned?[{
   run_status:'executing',plan_status:'running',
   brief:{category:'sistema de gestão',countryCode:'BR',imageHash,asked:'media'},
   result:{campaignId:'900001',adsetId:'900002'}}]:[]};
 }};
 const out=await readCampaignProgress(progressPool,actor,runId);
 assert.equal(out.runStatus,'executing');
 assert.equal(out.planStatus,'running');
 assert.equal(out.result.campaignId,'900001');
 assert.equal(out.result.adId,undefined,'a stage only appears after Meta confirms it');
 assert.equal(out.brief.countryCode,'BR');
 await assert.rejects(readCampaignProgress(progressPool,{...actor,active_tenant_id:randomUUID()},runId),e=>e.status===404);
 await assert.rejects(readCampaignProgress(progressPool,{...actor,role:'agent'},runId),e=>e.status===403);
 await assert.rejects(readCampaignProgress(progressPool,actor,'nao-e-uuid'),e=>e.status===422);
});
test('missing Meta connection, permissions and currency stop orchestration',async()=>{
 const pool=fakePool();
 await assert.rejects(speakToAdSkill(pool,{...actor,role:'agent'},{message:'Quero anunciar roupa feminina em Sorocaba R$ 6 por dia'},{resolve,read}),e=>e.status===403);
 await assert.rejects(speakToAdSkill(pool,{...actor,features:{...actor.features,ai:false}},{message:'Quero anunciar roupa feminina em Sorocaba R$ 6 por dia'},{resolve,read}),e=>e.status===403);
 await assert.rejects(speakToAdSkill(pool,actor,{message:'Crie uma campanha de moda feminina em Sorocaba R$ 6 por dia'},
  {resolve:async()=>({id:'act_123456789',currency:'USD'}),read}),e=>e.status===409);
});
test('website campaigns plan a Pixel only when none exists, and text approval creates Pixel first and paused ads second',async()=>{
 const pool=fakePool(),prepared=[],executed=[];
 const noImages=async(p,a,kind)=>kind==='images'?{items:[]}:read(p,a,kind);
 const opts={resolve,read:noImages,readPixels:async()=>({items:[],hasMore:false}),
  prepare:async(_p,_a,kind,input)=>{prepared.push({kind,input});return {id:randomUUID()};},
  execute:async(_p,_a,id,confirmed)=>{
   assert.equal(confirmed,true);executed.push(id);
   return executed.length===1?{status:'succeeded',result:{pixelId:'1234567890'}}:
    {status:'succeeded',result:{campaignId:'900111',adsetId:'900112',adId:'900113',delivery:'PAUSED'}};
  }};
 const initial=await speakToAdSkill(pool,actor,{
  message:'Quero vender roupa feminina em Sorocaba gastando R$ 6 por dia no site https://example.test'},opts);
 assert.equal(initial.status,'collecting');
 const ready=await speakToAdSkill(pool,actor,{message:'',runId:initial.runId,imageHash},opts);
 assert.equal(ready.status,'ready');assert.equal(prepared.length,2);
 assert.equal(prepared[0].kind,'create_pixel');
 assert.equal(prepared[1].kind,'create');
 assert.equal(prepared[1].input.url,'https://example.test');
 assert.equal(prepared[1].input.objective,'OUTCOME_TRAFFIC');
 assert.equal(prepared[1].input.optimizationGoal,'LANDING_PAGE_VIEWS');
 assert.equal(prepared[1].input.budgetMode,'adset');
 assert.equal(executed.length,0);
 assert.match(ready.message,/vou criar um Pixel/);
 const result=await speakToAdSkill(pool,actor,{message:'pode criar',runId:initial.runId},opts);
 assert.equal(result.status,'completed');
 assert.equal(executed.length,2);
 assert.match(result.message,/Pixel novo também foi criado/);
 assert.match(result.message,/criados e pausados/i);
});
test('when existing Pixel is visible, website skill reuses the account instead of creating a duplicate',async()=>{
 const pool=fakePool(),prepared=[];
 const opts={resolve,read,readPixels:async()=>({items:[{id:'1234567890'}],hasMore:false}),
  prepare:async(_p,_a,kind,input)=>{prepared.push(kind);return {id:randomUUID()};}};
 const a=await speakToAdSkill(pool,actor,
  {message:'Anuncie roupas femininas em Sorocaba por R$ 6 por dia no site https://example.test'},opts);
 assert.equal(a.status,'ready');
 assert.deepEqual(prepared,['create']);
});
test('skill catalog reports WhatsApp group and CAPI as unfinished and does not misstate Pixel inside WhatsApp',()=>{
 const source=SOCIO_AD_SKILLS.map(x=>x.id);
 assert(source.includes('ads.campaign.launch'));
 assert.equal(SOCIO_AD_SKILLS.find(x=>x.id==='ads.whatsapp.owner_commands').availability,'pending_gateway_validation');
 assert.equal(SOCIO_AD_SKILLS.find(x=>x.id==='ads.conversions.capi').availability,'pending_website_integration');
});

test('unverified advertising promises are stopped before preparing any Meta plan',async()=>{
 const pool=fakePool();let prepare=0,execute=0;
 const message='Quero anunciar produto 100% garantido em Sorocaba gastando R$ 6 por dia no WhatsApp imagem abcdef0123456789abcdef0123456789';
 const parsed=extractCampaignBrief(message);
 assert.match(parsed.category,/100% garantido/);
 const answer=await speakToAdSkill(pool,actor,{message},{
  resolve,read,
  prepare:async()=>{prepare++;throw Error('Unverified claim must not reach Meta')},
  execute:async()=>{execute++;throw Error('Never execute')}
 });
 assert.equal(answer.status,'collecting');
 assert.equal(answer.creativeReviewRequired,true);
 assert.match(answer.message,/não verificad/i);
 assert.equal(answer.brief.category,null);
 assert.equal(prepare,0);
 assert.equal(execute,0);
});

test('video received through Sócio can prepare a R$ 6 WhatsApp campaign in Sorocaba, never activated',async()=>{
 const pool=fakePool(),prepared=[],executed=[],videoId='1824013938791734';
 const withoutImages=async(db,a,kind)=>kind==='images'?{items:[]}:read(db,a,kind);
 const opts={resolve,read:withoutImages,
  prepare:async(_p,_a,kind,input)=>{
   prepared.push({kind,input});return {id:randomUUID()};
  },
  execute:async(_p,_a,id,confirmed)=>{
   assert.equal(confirmed,true);
   executed.push(id);
   return {status:'succeeded',result:{campaignId:'998811',adsetId:'998812',adId:'998813',delivery:'PAUSED'}};
  }
 };
 const text='Crie um anúncio para WhatsApp, em Sorocaba, gastando 6 reais por dia, com esse vídeo';
 const first=await speakToAdSkill(pool,actor,{message:text,videoId},opts);
 assert.equal(first.status,'collecting','Never infer the subject from raw video metadata.');
 assert.match(first.message,/produto ou serviço/);
 assert.equal(first.brief.dailyBudgetCents,600);
 assert.equal(first.brief.cityName,'Sorocaba');
 assert.equal(first.brief.hasVideo,true);
 assert.equal(prepared.length,0);
 const ready=await speakToAdSkill(pool,actor,{message:'serviços de publicidade',runId:first.runId},opts);
 assert.equal(ready.status,'ready');
 assert.equal(ready.brief.hasVideo,true);
 assert.equal(ready.brief.hasPhoto,false);
 assert.match(ready.message,/anúncio usa o vídeo que você enviou/);
 assert(!/\d{6,}/.test(ready.message),'the owner must not receive raw Meta IDs');
 assert(!/Página:|WA-AKG|Texto:/.test(ready.message));
 assert.equal(prepared.length,1);
 assert.equal(prepared[0].kind,'create_whatsapp');
 assert.equal(prepared[0].input.videoId,videoId);
 assert.equal(prepared[0].input.imageHash,undefined);
 assert.equal(prepared[0].input.dailyBudgetCents,600);
 assert.equal(prepared[0].input.cityName,'Sorocaba');
 assert.equal(prepared[0].input.whatsappPhone,'5515999999999');
 assert.equal(prepared[0].input.objective,'OUTCOME_ENGAGEMENT');
 assert.equal(prepared[0].input.optimizationGoal,'CONVERSATIONS');
 assert.equal(prepared[0].input.budgetMode,'adset');
 assert.equal(validateAdsPlan('create_whatsapp',prepared[0].input).videoId,videoId);
 assert.equal(executed.length,0);
 const denied=await speakToAdSkill(pool,actor,{message:'não autorizei',runId:first.runId},opts);
 assert.equal(denied.status,'ready');assert.equal(executed.length,0);
 const approved=await speakToAdSkill(pool,actor,{message:'pode criar',runId:first.runId},opts);
 assert.equal(approved.status,'completed');
 assert.equal(executed.length,1);
 assert.match(approved.message,/pausados/i);
 assert(!/\d{6,}/.test(approved.message),'the owner must not receive raw Meta IDs');
 const replay=await speakToAdSkill(pool,actor,{message:'pode criar',runId:first.runId},opts);
 assert.equal(replay.status,'completed');
 assert.equal(executed.length,1);
});
test('a spoken confirmation is understood dressed up, and a negation never approves',async()=>{
 assert.equal(isConfirmation('ok, pode criar'),true);
 assert.equal(isConfirmation('Beleza, pode subir'),true);
 assert.equal(isConfirmation('então manda ver'),true);
 assert.equal(isConfirmation('sim'),true);
 assert.equal(isConfirmation('sim, pode'),true);
 assert.equal(isConfirmation('pode criar agora'),true,'trailing fillers from speech must not block it');
 assert.equal(isConfirmation('não autorizei'),false);
 assert.equal(isConfirmation('não pode criar'),false);
 assert.equal(isConfirmation('ok'),false,'a filler alone never authorizes a write');
 assert.equal(isConfirmation('ainda não'),false);
 const pool=fakePool(),executed=[];
 const opts={resolve,read,prepare:async()=>({id:randomUUID()}),
  execute:async()=>{executed.push(1);return {status:'succeeded',result:{campaignId:'1',adsetId:'2',adId:'3',delivery:'PAUSED'}};}};
 const first=await speakToAdSkill(pool,actor,{message:'Crie um anúncio para WhatsApp, em Sorocaba, gastando 6 reais por dia, com essa foto',imageHash},opts);
 assert.equal(first.status,'collecting');
 const ready=await speakToAdSkill(pool,actor,{message:'serviços de publicidade',runId:first.runId},opts);
 assert.equal(ready.status,'ready');
 assert.equal(executed.length,0);
 const approved=await speakToAdSkill(pool,actor,{message:'ok, pode criar',runId:first.runId},opts);
 assert.equal(approved.status,'completed','a spoken "ok, pode criar" must create the campaign');
 assert.equal(executed.length,1);
});
test('a failed creation explains the real cause and a retry prepares the campaign again',async()=>{
 const pool=fakePool(),prepared=[],outcomes=[
  {status:'failed',error:'A Meta recusou a operação. Remova o parâmetro "link" do valor do tipo de chamada para ação WHATSAPP_MESSAGE.',
   result:{campaignId:'120260294640850386',adsetId:'120260294641030386'}},
  {status:'succeeded',result:{campaignId:'4',adsetId:'5',adId:'6',delivery:'PAUSED'}}
 ];
 const opts={resolve,read:async(db,a,kind)=>kind==='images'?{items:[]}:read(db,a,kind),
  prepare:async(_p,_a,kind,input)=>{prepared.push({kind,input});return {id:randomUUID()};},
  execute:async()=>outcomes.shift()};
 const text='Crie um anúncio para WhatsApp, em Sorocaba, gastando 6 reais por dia, com esse vídeo';
 const first=await speakToAdSkill(pool,actor,{message:text,videoId:'1824013938791734'},opts);
 const ready=await speakToAdSkill(pool,actor,{message:'serviços de publicidade',runId:first.runId},opts);
 assert.equal(ready.status,'ready');
 const failed=await speakToAdSkill(pool,actor,{message:'pode criar',runId:first.runId},opts);
 assert.equal(failed.status,'failed');
 assert.match(failed.message,/destino WhatsApp/,'the owner hears the real cause in plain words');
 assert.match(failed.message,/pausados/,'what was left on Meta is disclosed');
 assert.doesNotMatch(failed.message,/diagnóstico técnico|WHATSAPP_MESSAGE|parâmetro/);
 assert.equal(failed.result.result.campaignId,'120260294640850386','the partial creation is kept for a diagnosis');
 assert.equal(prepared.length,1);
 const diagnosis=await speakToAdSkill(pool,actor,{message:'o que aconteceu?',runId:first.runId},opts);
 assert.equal(diagnosis.status,'failed');
 assert.match(diagnosis.message,/destino WhatsApp/,'asking why repeats the cause instead of a definition');
 assert.equal(prepared.length,1,'asking why never creates another plan');
 const refused=await speakToAdSkill(pool,actor,{message:'não quero tentar de novo',runId:first.runId},opts);
 assert.equal(refused.status,'failed','a negated retry must not recreate the campaign');
 assert.equal(prepared.length,1);
 const retried=await speakToAdSkill(pool,actor,{message:'tentar de novo',runId:first.runId},opts);
 assert.equal(retried.status,'ready','a retry re-prepares the campaign with the same brief');
 assert.equal(prepared.length,2);
 const approved=await speakToAdSkill(pool,actor,{message:'pode criar',runId:first.runId},opts);
 assert.equal(approved.status,'completed');
 assert.match(approved.message,/pausados/i);
});
test('campaign accepts either video or image, never both and not unrecognized video IDs',()=>{
 const base={name:'Criativo teste',message:'Texto legítimo',headline:'Título',
  pageId:'123456789',whatsappPhone:'5515999999999',
  cityKey:'654321',cityName:'Sorocaba',dailyBudgetCents:600};
 const result=validateAdsPlan('create_whatsapp',{...base,videoId:'1824013938791734'});
 assert.equal(result.videoId,'1824013938791734');
 assert.equal(result.imageHash,undefined);
 assert.throws(()=>validateAdsPlan('create_whatsapp',{...base,videoId:'invalid'}),{status:422});
 assert.throws(()=>validateAdsPlan('create_whatsapp',{...base,videoId:'1824013938791734',imageHash}),{status:422});
 assert.throws(()=>validateAdsPlan('create_whatsapp',base),{status:422});
});
test('the owner states only the objective and the Sócio designs the whole campaign',async()=>{
 const pool=fakePool(),prepared=[];
 const withoutImages=async(_p,_a,kind)=>kind==='images'?{items:[]}:read(_p,_a,kind);
 const opts={resolve,read:withoutImages,prepare:async(_p,_a,kind,input)=>{prepared.push({kind,input});return{id:randomUUID()};}};
 const text='Quero vender direto pro meu WhatsApp esse sistema aqui, gastando no máximo seis reais por dia';
 const parsed=extractCampaignBrief(text);
 assert.equal(parsed.category,'sistema');
 assert.equal(parsed.destination,'whatsapp');
 assert.equal(parsed.goal,'sales_whatsapp');
 assert.equal(parsed.dailyBudgetCents,600);
 const started=await speakToAdSkill(pool,actor,{message:text},opts);
 assert.equal(started.status,'collecting');
 assert.equal(started.brief.goal,'sales_whatsapp');
 assert.match(started.message,/cidade/i);
 const city=await speakToAdSkill(pool,actor,{message:'Sorocaba',runId:started.runId},opts);
 assert.equal(city.status,'collecting');
 assert.equal(city.brief.cityName,'Sorocaba');
 assert.match(city.message,/Objetivo: Conversas no WhatsApp/);
 assert.match(city.message,/ABO/);
 assert.match(city.message,/Funil/);
 assert.match(city.message,/arrastar o arquivo/i);
 assert.equal(prepared.length,0,'the plan is shown before the creative is requested');
 const ready=await speakToAdSkill(pool,actor,{message:'',runId:started.runId,imageHash},opts);
 assert.equal(ready.status,'ready');
 assert.equal(ready.design.objective,'OUTCOME_ENGAGEMENT');
 assert.equal(ready.design.budgetMode,'adset');
 assert.equal(prepared.length,1);
 assert.deepEqual([prepared[0].kind,prepared[0].input.objective,prepared[0].input.optimizationGoal,prepared[0].input.budgetMode],
  ['create_whatsapp','OUTCOME_ENGAGEMENT','CONVERSATIONS','adset']);
});
