import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {extractCampaignBrief,chooseMetaCity,skillAdCopy,speakToAdSkill,SOCIO_AD_SKILLS} from '../socio-ad-skills.mjs';
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
 assert.match(confirmed.message,/PAUSADOS/);
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
 assert.match(start.message,/foto/i);
 assert.equal(prepared.length,0,'No Meta write or plan when image is missing');
 const withImage=await speakToAdSkill(pool,actor,{message:'',runId:start.runId,imageHash},opts);
 assert.equal(withImage.status,'ready');
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
 assert.equal(executed.length,0);
 assert.match(ready.message,/Pixel novo/);
 const result=await speakToAdSkill(pool,actor,{message:'pode criar',runId:initial.runId},opts);
 assert.equal(result.status,'completed');
 assert.equal(executed.length,2);
 assert.match(result.message,/Pixel criado: 1234567890/);
 assert.match(result.message,/PAUSADOS/);
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
