import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sealMarketingSecret} from '../marketing-integrations.mjs';
import {readSelectedAdMedia} from '../meta-ads-tools.mjs';
import {voiceReplyPlan,voiceStyleInstruction,polishVoiceReply} from '../socio-thalita-dialogue-style.mjs';
import {semanticTurnAssessment,newSemanticTurnBuffer} from '../public/socio-semantic-turn.mjs';
import {askThalita} from '../socio-thalita-assistant.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const env={SOCIO_PUBLIC_URL:'https://socio.example',SOCIO_META_APP_SECRET:'mock-secret',
 SOCIO_META_GRAPH_VERSION:'v26.0',CHANNEL_ENCRYPTION_KEY:'unit-test-only-key-at-least-32-characters'};
const actor={active_tenant_id:'tenant-hd',user_id:'owner-hd',role:'owner',tenant_status:'active',
 token_hash:'test-session',features:{meta_ads:true,ai:true,whatsapp:true,quotes:true,catalog:true}};
const grant=sealMarketingSecret(JSON.stringify({tenant:actor.active_tenant_id,user:actor.user_id,
 token:'secret-only-server-value'}),env);
function fixture({imageUrl=null,video=true,source=null,previewBody=null}={}){
 const calls=[];
 const pool={query:async(sql,args)=>{
  assert.equal(args[0],actor.active_tenant_id);
  if(sql.includes('meta_official_account_selections'))return {rows:[{account_id:'act_123456'}]};
  if(sql.includes('meta_official_grants'))return {rows:[{token_encrypted:grant,scopes:['ads_read']}]};
  throw Error('Unexpected DB query');
 }};
 const request=async(url,opts)=>{
  const u=new URL(url);calls.push(u);
  assert.equal(u.hostname,'graph.facebook.com');
  assert.match(opts.headers.Authorization,/Bearer /);
  const ok=data=>({ok:true,json:async()=>data});
  if(u.pathname.endsWith('/me/adaccounts'))return ok({data:[{id:'act_123456',name:'Conta',currency:'BRL'}]});
  if(u.pathname.endsWith('/1111111111'))return ok({id:'1111111111',account_id:'123456',name:'Anúncio ao vivo',
   creative:{id:'8888888888',image_url:imageUrl||undefined,thumbnail_url:'https://scontent.xx.fbcdn.net/64px.jpg',
    video_id:video?'2222222222':undefined}});
  if(u.pathname.endsWith('/1111111111/previews'))return ok({data:[{body:previewBody||
   '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=mock123&amp;safe=1"></iframe>'}]});
  if(u.pathname.endsWith('/2222222222'))return ok({
   id:'2222222222',source:source||undefined,picture:'https://scontent.xx.fbcdn.net/video-small.jpg',
   ...(u.searchParams.get('fields')?.startsWith('thumbnails')?
    {thumbnails:{data:[{uri:'https://scontent.xx.fbcdn.net/poster-hd.jpg',width:1080,height:1920},
     {uri:'https://scontent.xx.fbcdn.net/poster-tiny.jpg',width:64,height:64}]}}:{})
  });
  throw Error('Unexpected Graph route: '+u.pathname);
 };
 return {pool,request,calls};
}
test('HD poster takes priority over Meta 64px thumbnail, video has trusted external fallback',async()=>{
 const f=fixture({imageUrl:'https://scontent.xx.fbcdn.net/original-1080x1920.jpg',video:true,
  source:'https://video.xx.fbcdn.net/highquality.mp4'});
 const m=await readSelectedAdMedia(f.pool,actor,'1111111111',{env,request:f.request});
 assert.equal(m.quality,'original_or_video');
 assert.match(m.posterUrl,/original-1080x1920/);
 assert.match(m.thumbnailUrl,/64px/);
 assert.match(m.videoUrl,/highquality.mp4/);
 assert.equal(m.watchUrl,'https://www.facebook.com/watch/?v=2222222222');
 assert(!JSON.stringify(m).includes('secret-only-server-value'));
 assert(f.calls.every(u=>!u.searchParams.has('access_token')));
});
test('when Meta MP4 is not available the verified watch URL is available, and optional HD poster is used',async()=>{
 const f=fixture();
 const m=await readSelectedAdMedia(f.pool,actor,'1111111111',{env,request:f.request});
 assert.equal(m.status,'video_unavailable');
 assert.equal(m.videoUrl,null);
 assert.match(m.watchUrl,/facebook.com\/watch\/\?v=2222222222/);
 assert.match(m.posterUrl,/poster-hd.jpg/);
 assert.match(m.previewUrl,/^https:\/\/www\.facebook\.com\/ads\/api\/preview_iframe\.php\?/);
 const malicious=fixture({previewBody:'<iframe src="https://fake-preview.example.invalid/embed"></iframe>'});
 const unsafe=await readSelectedAdMedia(malicious.pool,actor,'1111111111',{env,request:malicious.request});
 assert.equal(unsafe.previewUrl,null);
});
test('Prospector voice style is now shared with Thalita without repeated greetings',async()=>{
 const history=[{role:'user',content:'Quero analisar anúncios'},
 {role:'assistant',content:'Vou consultar as campanhas.'}];
 const instruction=voiceStyleInstruction({heard:'E a campanha de ontem?',history});
 assert.match(instruction,/NÃO comece cada resposta com oi/);
 assert.match(instruction,/Thalita/);
 assert.match(instruction,/CONTINUAÇÃO/);
 assert.equal(voiceReplyPlan('E a campanha de ontem?',history).backAndForth,true);
 const polished=polishVoiceReply('Olá! O anúncio teve bons cliques.',{history,heard:'E o anúncio?'});
 assert.equal(polished,'O anúncio teve bons cliques.');
 let used=false;
 const answer=await askThalita({query(){throw Error('should not query unrelated tools')}},actor,{
  message:'Você pode explicar melhor?',history:[{role:'user',text:'Quero uma explicação sem jargão.'},
   {role:'assistant',text:'Vou falar de forma simples.'}]
 },{chat:async({instructions,maxOutputTokens,input})=>{
  used=true;assert.match(instructions,/Thalita/);
  assert.match(input,/sem jargão/);
  assert(maxOutputTokens>=175);
  return {reply:'Olá! Vou explicar sem termos técnicos.'};
 }});
 assert(used);assert.equal(answer.message,'Vou explicar sem termos técnicos.');
});
test('Semantic turns hold incomplete fragments like Prospector, and merge follow-up',()=>{
 const buffer=newSemanticTurnBuffer();
 assert.equal(semanticTurnAssessment('Eu preciso que').incomplete,true);
 assert.equal(buffer.take('Eu preciso que',{now:100}).hold,true);
 const combined=buffer.take('você analise a campanha de ontem.',{now:700});
 assert.equal(combined.hold,false);
 assert.equal(combined.text,'Eu preciso que você analise a campanha de ontem.');
 assert.equal(buffer.pending,0);
});
test('UI and CSS explicitly show media play control and prevent overflow',()=>{
 const ui=read('public/socio-workspace-ui.js'),css=read('public/socio-executive.css');
 const server=read('server.mjs'),voice=read('public/socio-thalita-ui.js'),ads=read('meta-ads-tools.mjs');
 assert.doesNotThrow(()=>new vm.Script(ui));
 assert.doesNotThrow(()=>new vm.Script(voice));
 assert(css.includes('px-featured-item>.px-feature-media'));
 assert(css.includes('overflow-wrap:anywhere'));
 assert(css.includes('flex:0 0 min(34%,220px)'));
 assert(css.includes('px-media-play'));
 assert(ui.includes('const posterFromAd=ad=>mediaUrl(ad?.creative?.image_url'));
 assert(ui.includes("playButton('Ver vídeo do anúncio"));
 assert(ui.includes('watchUrl(result.watchUrl)'));
 assert(ui.includes('data-campaign-preview'));
 assert(ads.includes('creative{id,name,image_url'));
 assert.match(server,/socio-semantic-turn.mjs/);
 assert(server.includes('frame-src https://www.facebook.com'));
 assert(ui.includes('trustedMetaPreview(result.previewUrl)'));
 assert(ui.includes('px-meta-preview-frame'));

 assert.match(voice,/newSemanticTurnBuffer/);
 assert(voice.includes('assessed.hold'));
});
