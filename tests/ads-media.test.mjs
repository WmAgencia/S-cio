import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {
 reserveAdVideo,listAdVideos,findVideo,storeAdVideo,adVideoExportUrl,adVideoUploadLink,
 resolveSignedAsset,serveSignedVideo,createMediaMcpToken,revokeMediaMcpTokens,authenticateMediaMcp,
 importWhatsAppAdVideo,MAX_AD_VIDEO_BYTES
} from '../ads-media.mjs';
import {handleAdsMediaMcp} from '../ads-media-mcp.mjs';
import {readFile} from 'node:fs/promises';
const env={NODE_ENV:'test',SOCIO_STORAGE_DRIVER:'memory',CHANNEL_ENCRYPTION_KEY:'socio-video-strong-secret-for-tests-0123456789abcdef',
 SOCIO_PUBLIC_URL:'https://socio-test.example.com'};
const T='8a3179c7-9174-4c34-ae3f-038a1081727b',USER='82d4ab34-b3fe-4b0a-80ba-82f02096f16b',OTHER='2af90123-8ab7-40db-9471-2d1f225511d9';
const actor={active_tenant_id:T,user_id:USER,role:'owner',phone:'+5515987654321'};
class Pool {
 constructor(){this.assets=new Map();this.tokens=[];}
 async query(sql,values=[]){
  if(sql.startsWith('INSERT INTO ads_media(')){
   const [id,tenant,owner,filename,source,key,type]=values;
   this.assets.set(id,{id,tenant_id:tenant,created_by:owner,filename,source,object_key:key,
    content_type:type,status:'reserved',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),bytes:null,sha256:null});
   return {rows:[this.assets.get(id)],rowCount:1};
  }
  if(sql.startsWith('SELECT id,tenant_id,filename')){
   const row=this.assets.get(values[1]);
   return {rows:row&&row.tenant_id===values[0]?[row]:[],rowCount:row&&row.tenant_id===values[0]?1:0};
  }
  if(sql.startsWith('SELECT id,filename,source')){
   const rows=[...this.assets.values()].filter(x=>x.tenant_id===values[0]);
   return {rows:rows.slice(0,values[1]),rowCount:rows.length};
  }
  if(sql.startsWith("UPDATE ads_media SET status='uploading'")){
   const row=this.assets.get(values[1]);
   if(!row||row.tenant_id!==values[0]||row.status!=='reserved')return {rowCount:0,rows:[]};
   row.status='uploading';return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith("UPDATE ads_media SET status='ready'")){
   const row=this.assets.get(values[1]);row.status='ready';row.bytes=values[2];row.sha256=values[3];return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith("UPDATE ads_media SET status='failed'")){
   const row=this.assets.get(values[1]);row.status='failed';return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith('SELECT id,tenant_id,object_key')){
   const row=this.assets.get(values[0]);return {rows:row?[row]:[],rowCount:row?1:0};
  }
  if(sql.startsWith('INSERT INTO ads_media_mcp_tokens')){
   const [id,tenant,owner,hash,expiresAt]=values;
   this.tokens.push({id,tenant,owner,hash,expiresAt,revoked:false});return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE ads_media_mcp_tokens SET')){
   for(const t of this.tokens)if(t.tenant===values[0]&&t.owner===values[1])t.revoked=true;
   return {rowCount:1,rows:[]};
  }
  if(sql.includes('FROM ads_media_mcp_tokens tok')){
   const token=this.tokens.find(x=>x.hash===values[0]&&!x.revoked&&x.expiresAt>new Date());
   return {rows:token?[actor]:[],rowCount:token?1:0};
  }
  throw Error('Unexpected SQL '+sql);
 }
}
function video(){const b=Buffer.alloc(1800);b.writeUInt32BE(24,0);b.write('ftyp',4);b.write('isom',8);return b;}
function res(){
 const chunks=[],headers={};
 return {writeHead(status,value){this.status=status;Object.assign(headers,value);},setHeader(k,v){headers[k]=v;},
  end(data){if(data)chunks.push(Buffer.from(data));this.finished=true;},
  get data(){return Buffer.concat(chunks);},get headers(){return headers;}};
}
test('cofre separa tenant e rejeita bytes falsos sem marcar upload como pronto',async()=>{
 const p=new Pool(),asset=await reserveAdVideo(p,actor,'criativo-1.mp4');
 await assert.rejects(findVideo(p,OTHER,asset.id),{status:404});
 await assert.rejects(storeAdVideo(p,T,asset.id,Readable.from([Buffer.from('arquivo-falso')] ),{env}),{status:422});
 assert.equal(p.assets.get(asset.id).status,'failed');
 assert.equal((await listAdVideos(p,T)).length,1);
 assert.equal((await listAdVideos(p,OTHER)).length,0);
 await assert.rejects(reserveAdVideo(p,actor,'../../../../test.mp4'),{status:422});
 assert.equal(MAX_AD_VIDEO_BYTES,90*1024*1024);
});
test('MP4 armazenado privado usa URL HMAC expirada e suporta Range do Meta downloader',async()=>{
 const p=new Pool(),a=await reserveAdVideo(p,actor,'vencedor.mp4');
 const out=await storeAdVideo(p,T,a.id,Readable.from([video()]),{env,declaredBytes:1800});
 assert.equal(out.status,'ready');assert.equal(out.bytes,1800);
 const u=await adVideoExportUrl(p,T,a.id,env);
 assert.ok(u.url.startsWith('https://socio-test.example.com/media/ads/'));
 assert.ok(!u.url.includes('SOCIO_S3_'));
 const parsed=new URL(u.url),expires=parsed.searchParams.get('expires'),signature=parsed.searchParams.get('signature');
 const ready=await resolveSignedAsset(p,a.id,expires,signature,'meta-fetch',env);
 assert.equal(ready.status,'ready');
 await assert.rejects(resolveSignedAsset(p,a.id,expires,signature.slice(0,-3)+'abc','meta-fetch',env),{status:403});
 await assert.rejects(resolveSignedAsset(p,a.id,'1',signature,'meta-fetch',env),{status:403});
 await assert.rejects(adVideoExportUrl(p,OTHER,a.id,env),{status:404});
 const response=res();
 await serveSignedVideo(p,a.id,expires,signature,{method:'GET',headers:{range:'bytes=0-15'}},response,env);
 assert.equal(response.status,206);
 assert.equal(response.data.length,16);
 assert.equal(response.headers['Content-Range'],'bytes 0-15/1800');
 assert.equal(response.data.toString('ascii',4,8),'ftyp');
 await assert.rejects(serveSignedVideo(p,a.id,expires,signature,{method:'GET',headers:{range:'bytes=2000-3000'}},res(),env),{status:416});
});
test('ticket upload só vale para mídia reservada e não permite download',async()=>{
 const p=new Pool(),result=await adVideoUploadLink(p,actor,'anuncio.mp4',env);
 const link=new URL(result.uploadPage),expires=link.searchParams.get('expires'),sig=link.searchParams.get('signature');
 const a=await resolveSignedAsset(p,result.id,expires,sig,'upload',env);
 assert.equal(a.status,'reserved');
 await assert.rejects(resolveSignedAsset(p,result.id,expires,sig,'meta-fetch',env),{status:403});
 await storeAdVideo(p,T,result.id,Readable.from([video()]),{env});
 await assert.rejects(storeAdVideo(p,T,result.id,Readable.from([video()]),{env}),{status:409});
});
test('token MCP é tenant bound, rotacionável e sem acesso ao Meta token',async()=>{
 const p=new Pool(),token=await createMediaMcpToken(p,actor);
 assert.ok(token.token.startsWith('socioads_'));
 assert.equal(token.endpoint,'https://socio-test.example.com/mcp/ads-media');
 const valid=await authenticateMediaMcp(p,token.token);assert.equal(valid.active_tenant_id,T);
 const old=token.token,newToken=await createMediaMcpToken(p,actor);
 await assert.rejects(authenticateMediaMcp(p,old),{status:401});
 await authenticateMediaMcp(p,newToken.token);
 await revokeMediaMcpTokens(p,actor);
 await assert.rejects(authenticateMediaMcp(p,newToken.token),{status:401});
});
test('MCP JSONRPC lista ferramentas, exige Bearer, e nunca publica anúncios',async()=>{
 const p=new Pool(),token=await createMediaMcpToken(p,actor);
 async function call(payload,authorization){
  const data=Buffer.from(JSON.stringify(payload)),request=Readable.from([data]);
  request.method='POST';request.headers={authorization:authorization||'',accept:'application/json'};
  const response=res();await handleAdsMediaMcp(p,request,response);
  return {status:response.status,body:JSON.parse(response.data.toString())};
 }
 const noAuth=await call({jsonrpc:'2.0',id:1,method:'initialize'});
 assert.equal(noAuth.status,401);
 const header='Bearer '+token.token;
 const hello=await call({jsonrpc:'2.0',id:1,method:'initialize'},header);
 assert.equal(hello.status,200);assert.equal(hello.body.result.serverInfo.name,'socio-ads-media-bridge');
 const result=await call({jsonrpc:'2.0',id:2,method:'tools/list'},header);
 assert.equal(result.body.result.tools.length,5);
 assert.ok(result.body.result.tools.every(x=>!x.name.includes('publish')&&!x.name.includes('activate')));
});
test('WhatsApp import exige que mensagem pertença ao próprio telefone do gestor',async()=>{
 const p=new Pool();
 await assert.rejects(importWhatsAppAdVideo(p,actor,{channelId:USER,jid:'5515999999999@s.whatsapp.net',
  messageId:'ABC1234',filename:'video.mp4'}),{status:403});
});
test('front e rotas mostram biblioteca separada da criação e aprovação da Meta',async()=>{
 const text=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const frontend=await readFile(new URL('../public/ads-media-ui.js',import.meta.url),'utf8');
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.ok(text.includes("pathname==='/mcp/ads-media'"));
 assert.ok(text.includes("pathname==='/api/ads-media/reserve'"));
 assert.ok(text.includes("pathname==='/api/ads-media/import-whatsapp'"));
 assert.ok(text.includes("serveSignedVideo(pool"));
 assert.ok(text.includes("requirePermission(a,'marketing.manage')"));
 assert.ok(text.includes("const a=await sessionFor(req);"));
 assert.ok(html.includes('/ads-media-ui.js'));
 assert.ok(frontend.includes('fetch('));
 assert.ok(!frontend.includes('sk_live_'));
});
