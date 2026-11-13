import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {readSelectedAdMedia} from '../meta-ads-tools.mjs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';

const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'unit-app-secret',
 SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'unit-test-only-key-at-least-32-characters'};
const a={active_tenant_id:'tenant-1',user_id:'owner-1',role:'owner',tenant_status:'active',features:{meta_ads:true}};
const sealed=sealMarketingSecret(JSON.stringify({tenant:a.active_tenant_id,user:a.user_id,token:'test-token-NEVER-expose'}),env);
function fixture(adAccount='123456',video='https://video.xx.fbcdn.net/ad.mp4?sig=test'){
 const queries=[],requests=[];
 const pool={query:async(sql,args)=>{
  queries.push({sql,args});assert.equal(args[0],a.active_tenant_id);
  if(sql.includes('meta_official_account_selections'))return {rows:[{account_id:'act_123456'}]};
  if(sql.includes('meta_official_grants'))return {rows:[{token_encrypted:sealed,scopes:['ads_read']}]};
  throw Error('Unexpected SQL');
 }};
 const request=async(url,options)=>{
  const u=new URL(url);requests.push({url:u,options});
  assert.equal(u.hostname,'graph.facebook.com');assert.equal(options.method||'GET','GET');
  assert.equal(options.headers.Authorization,'Bearer test-token-NEVER-expose');
  const ok=data=>({ok:true,json:async()=>data});
  if(u.pathname.endsWith('/me/adaccounts'))return ok({data:[{id:'act_123456',name:'Conta',currency:'BRL'}]});
  if(u.pathname.endsWith('/1234567890'))return ok({id:'1234567890',name:'Anúncio',account_id:adAccount,
   campaign_id:'55555555',creative:{id:'77777777',video_id:'9876543210',
    thumbnail_url:'https://scontent.xx.fbcdn.net/ad.jpg'}});
  if(u.pathname.endsWith('/9876543210'))return ok({id:'9876543210',source:video,
   picture:'https://scontent.xx.fbcdn.net/other.jpg'});
  throw Error('Graph path not expected: '+u.pathname);
 };
 return {pool,request,queries,requests};
}
test('Meta media belongs to selected account and includes verified thumbnail / playable HTTPS source',async()=>{
 const f=fixture();
 const result=await readSelectedAdMedia(f.pool,a,'1234567890',{env,request:f.request});
 assert.equal(result.readOnly,true);
 assert.equal(result.status,'video_ready');
 assert.equal(result.accountId,'act_123456');
 assert.match(result.thumbnailUrl,/^https:\/\/scontent/);
 assert.match(result.videoUrl,/^https:\/\/video/);
 assert(!JSON.stringify(result).includes('test-token'));
 assert(f.requests.every(x=>!x.url.searchParams.has('access_token')));
 assert(f.queries.every(x=>x.args[0]==='tenant-1'));
});
test('Reject wrong ad account, invalid identifier, dangerous video hosts and malformed preview',async()=>{
 const other=fixture('999999');
 await assert.rejects(readSelectedAdMedia(other.pool,a,'1234567890',{env,request:other.request}),{status:403});
 assert.equal(other.requests.length,2);
 await assert.rejects(readSelectedAdMedia(other.pool,a,'not-an-ad',{env,request:other.request}),{status:422});
 const malicious=fixture('123456','https://not-meta.example/private.mp4');
 const safe=await readSelectedAdMedia(malicious.pool,a,'1234567890',{env,request:malicious.request});
 assert.equal(safe.videoUrl,null);
 assert.equal(safe.status,'video_unavailable');
});
test('Meta dashboard includes campaign thumbnail, ad video controls, swift navigation and correct audio unlock',()=>{
 const load=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const ui=load('public/socio-workspace-ui.js'),voice=load('public/socio-thalita-ui.js'),
  vad=load('public/socio-francisca-live.mjs'),server=load('server.mjs');
 assert.doesNotThrow(()=>new vm.Script(ui));
 assert.doesNotThrow(()=>new vm.Script(voice));
 assert.match(ui,/data-featured-media/);
 assert.match(ui,/el\.controls=true/);
 assert.match(ui,/el\.preload='metadata'/);
 assert.match(ui,/data-px-media-play/);
 assert.match(ui,/image_url/);
 assert.match(ui,/data-campaign-preview/);
 assert.match(ui,/data-px-marketing/);
 assert.match(ui,/const getCache=new Map/);
 assert.doesNotMatch(ui,/Montando indicadores reais|Consultando campanhas da Meta|Verificando suas conexões autorizadas/);
 assert.match(server,/pathname==='\/api\/marketing\/tools\/ad-media'/);
 assert.match(server,/readSelectedAdMedia/);
 assert.match(voice,/playbackContext\.resume\(\)/);
 assert.match(voice,/decodeAudioData/);
 assert.match(voice,/source\.start\(\)/);
 assert.match(voice,/Sou a Thalita/);
 assert.match(vad,/const assistantSpeaking=canInterrupt\(\)/);
 assert.match(vad,/now-bargeStarted>=650/);
 assert.match(vad,/if\(!bargeStarted\)\{bargeStarted=now;bargeCandidate=true;record\(true\);\}/,
  'barge-in records from the first voiced frame so the opening words are kept');
 assert.match(vad,/if\(bargeCandidate\)\{bargeCandidate=false;discardTurn\(\);\}/,
  'an unconfirmed barge candidate is discarded instead of becoming a turn');
});
