import test from 'node:test';
import assert from 'node:assert/strict';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {META_TOOL_CATALOG,readAdvancedMetaTool} from '../meta-ads-advanced.mjs';
import {parseMetaCommand} from '../meta-ads-commands.mjs';

function fixture({malformed=false}={}){
 const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'test-secret',
 SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'unit-test-only-key-at-least-32-characters'};
 const actor={active_tenant_id:'tenant-toolbox',user_id:'user-toolbox',role:'owner',tenant_status:'active',features:{meta_ads:true}};
 const encrypted=sealMarketingSecret(JSON.stringify({tenant:actor.active_tenant_id,user:actor.user_id,token:'private-test-token'}),env);
 const pool={query:async(sql,args)=>{
  assert.equal(args[0],actor.active_tenant_id);
  if(sql.includes('meta_official_account_selections'))return {rows:[{account_id:'act_123456'}]};
  if(sql.includes('meta_official_grants'))return {rows:[{token_encrypted:encrypted,scopes:['ads_read']}]};
  throw Error('Unexpected SQL');
 }};
 const calls=[];
 const request=async(url,opts)=>{
  const u=new URL(url);calls.push(u);
  assert.equal(opts.method||'GET','GET');
  assert.equal(u.hostname,'graph.facebook.com');
  assert(!u.searchParams.has('access_token'));
  const data=u.pathname.endsWith('/me/adaccounts')?{data:[{id:'act_123456',name:'Test account',currency:'BRL'}]}:
   malformed?{unexpected:true}:{data:[{id:'999999',spend:'5',clicks:'2',impressions:'100'}],
    paging:{cursors:{after:'next_cursor'},next:'https://untrusted.example/?access_token=NEVER_FORWARD'}};
  return {ok:true,json:async()=>data};
 };
 return {pool,actor,options:{env,request},calls};
}
test('expanded catalog has sixteen distinct, read-only tools',()=>{
 assert.equal(new Set(META_TOOL_CATALOG.map(t=>t.id)).size,16);
 assert(META_TOOL_CATALOG.every(t=>t.readOnly===true));
});
for(const [kind,edge] of [['activity','activities'],['labels','adlabels'],['rules','adrules_library'],
 ['delivery','ads'],['budget_report','campaigns'],['video_report','insights'],
 ['conversion_report','insights'],['creative_report','insights']]){
 test('expanded '+kind+' reads only the selected account and preserves pagination',async()=>{
  const f=fixture();
  const data=await readAdvancedMetaTool(f.pool,f.actor,kind,{after:'cursor_safe',period:'last_7d'},f.options);
  const call=f.calls.find(u=>u.pathname.endsWith('/'+edge));
  assert(call);
  assert.equal(call.pathname,'/v26.0/act_123456/'+edge);
  assert.equal(call.searchParams.get('after'),'cursor_safe');
  assert.equal(data.accountId,'act_123456');
  assert.equal(data.readOnly,true);
  assert.equal(data.after,'next_cursor');
  assert.equal(data.hasMore,true);
  assert(!JSON.stringify(data).includes('untrusted.example'));
  assert(!JSON.stringify(data).includes('private-test-token'));
  if(['video_report','creative_report'].includes(kind))assert.equal(call.searchParams.get('level'),'ad');
  if(kind==='video_report')assert(call.searchParams.get('fields').includes('video_p95_watched_actions'));
  if(kind==='conversion_report')assert(call.searchParams.get('fields').includes('action_values'));
 });
}
test('invalid report cursors never become remote query parameters',async()=>{
 const f=fixture();
 await assert.rejects(readAdvancedMetaTool(f.pool,f.actor,'reports',{after:'https://evil.example/?token=secret'},f.options),{status:422});
 assert(!f.calls.some(u=>u.pathname.endsWith('/insights')));
});
test('invalid Meta response cannot silently become an empty success',async()=>{
 for(const kind of ['labels','reports']){
  const f=fixture({malformed:true});
  await assert.rejects(readAdvancedMetaTool(f.pool,f.actor,kind,{},f.options),{status:503});
 }
});
test('missing read permission does not issue a Graph request',async()=>{
 const f=fixture();
 await assert.rejects(readAdvancedMetaTool(f.pool,{...f.actor,role:'invalid'},'labels',{},f.options));
 assert.equal(f.calls.length,0);
});
test('specialized commands select tools without creating spend-capable plans',()=>{
 for(const [text,kind] of [['ver histórico de alterações','activity'],['listar etiquetas','labels'],
  ['ver regras automáticas','rules'],['problemas de entrega','delivery'],
  ['retenção dos vídeos','video_report'],['ver conversões','conversion_report'],
  ['listar orçamentos','budget_report'],['desempenho dos criativos','creative_report']]){
  const command=parseMetaCommand(text);
  assert.equal(command.kind,kind);
  assert.equal(command.intent,'read');
  assert.equal(command.willSpend,false);
 }
});
