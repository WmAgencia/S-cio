import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {handleMediaOAuth,authenticateMediaOAuth,mediaAuthChallenge,resourceUrl} from '../ads-media-oauth.mjs';
import {handleAdsMediaMcp} from '../ads-media-mcp.mjs';
const env={SOCIO_PUBLIC_URL:'https://socio-app-production-762c.up.railway.app',
 CHANNEL_ENCRYPTION_KEY:'test oauth mcp sign key 64 bytes long enough to sign secure grants !'};
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const resource=env.SOCIO_PUBLIC_URL+'/mcp/ads-media';
const user='1d3f2581-1695-4a34-a92d-a093576932f2',tenant='8a3179c7-9174-4c34-ae3f-038a1081727b';
const actor={user_id:user,active_tenant_id:tenant,role:'owner',platform_owner:false,phone:null,tenant_status:'active',features:{meta_ads:true}};
class Db {
 constructor(){this.clients=new Map();this.codes=new Map();this.tokens=new Map();}
 async query(sql,params=[]){
  if(sql.startsWith('INSERT INTO ads_oauth_clients')){
   this.clients.set(params[0],{client_id:params[0],redirect_uris:JSON.parse(params[1])});return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT client_id,redirect_uris')){
   const row=this.clients.get(params[0]);return {rowCount:row?1:0,rows:row?[row]:[]};
  }
  if(sql.startsWith('INSERT INTO ads_oauth_codes')){
   const [id,code_hash,client_id,redirect_uri,code_challenge,resource,scope,user_id,tenant_id]=params;
   this.codes.set(code_hash,{id,code_hash,client_id,redirect_uri,code_challenge,resource,scope,user_id,tenant_id,used:false});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE ads_oauth_codes SET')){
   const row=this.codes.get(params[0]);
   if(!row||row.used||row.client_id!==params[1]||row.redirect_uri!==params[2]||row.resource!==params[3])
    return {rowCount:0,rows:[]};
   row.used=true;return {rowCount:1,rows:[row]};
  }
  if(sql.startsWith('INSERT INTO ads_oauth_tokens')){
   const [id,access_hash,refresh_hash,client_id,user_id,tenant_id,resource,scope]=params;
   this.tokens.set(access_hash,{id,access_hash,refresh_hash,client_id,user_id,tenant_id,resource,scope,revoked:false});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('UPDATE ads_oauth_tokens SET revoked_at=now()')){
   const r=[...this.tokens.values()].find(x=>x.refresh_hash===params[0]&&x.client_id===params[1]&&x.resource===params[2]&&!x.revoked);
   if(!r)return {rowCount:0,rows:[]};
   r.revoked=true;return {rowCount:1,rows:[r]};
  }
  if(sql.includes('FROM ads_oauth_tokens tok JOIN tenants')){
   const r=this.tokens.get(params[0]);
   if(!r||r.revoked||r.resource!==params[1])return {rowCount:0,rows:[]};
   return {rowCount:1,rows:[{...actor,scope:r.scope}]};
  }
  throw Error('Unexpected OAuth query: '+sql);
 }
}
function response(){
 const headers={},parts=[];
 return {statusCode:200,headers,setHeader(k,v){headers[k.toLowerCase()]=v;},
  writeHead(code,obj){this.statusCode=code;Object.assign(headers,obj);},
  end(data){if(data)parts.push(Buffer.from(data));this.done=true;},
  get text(){return Buffer.concat(parts).toString('utf8');},
  get json(){return JSON.parse(this.text);}};
}
function request(method,path,payload,headers={}){
 const data=payload===undefined?Buffer.alloc(0):Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));
 const req=Readable.from(data.length?[data]:[]);req.url=path;req.method=method;req.headers={
  'origin':env.SOCIO_PUBLIC_URL,'content-type':typeof payload==='string'?'application/x-www-form-urlencoded':'application/json',
  ...headers};
 req.socket={remoteAddress:'198.51.100.25'};return req;
}
const ctx={sessionFor:async()=>actor,limiter:()=>true,authAttempts:new Map()};
async function oauth(db,method,path,payload,headers){
 const res=response(),req=request(method,path,payload,headers);
 await handleMediaOAuth(db,req,res,ctx,env);return res;
}
test('metadados OAuth publicados para ChatGPT e challenge do MCP',async()=>{
 const db=new Db();
 const p=await oauth(db,'GET','/.well-known/oauth-protected-resource');
 assert.equal(p.statusCode,200);assert.equal(p.json.resource,resource);
 assert.deepEqual(p.json.authorization_servers,[env.SOCIO_PUBLIC_URL]);
 const m=await oauth(db,'GET','/.well-known/oauth-authorization-server');
 assert.equal(m.json.code_challenge_methods_supported[0],'S256');
 assert.equal(m.json.authorization_response_iss_parameter_supported,true);
 assert.equal(m.json.token_endpoint_auth_methods_supported[0],'none');
 assert.equal(m.json.grant_types_supported[1],'refresh_token');
 assert.ok(mediaAuthChallenge(env).includes('resource_metadata='));
 assert.equal(resourceUrl(env),resource);
});
test('DCR só aceita redirect oficial ChatGPT, sem open redirect',async()=>{
 const db=new Db();
 const invalid=await oauth(db,'POST','/oauth/register',{redirect_uris:['https://evil.example/callback']});
 assert.equal(invalid.statusCode,400);
 const accepted=await oauth(db,'POST','/oauth/register',{
  client_name:'Sócio Meta Ads',redirect_uris:[callback],
  token_endpoint_auth_method:'none'});
 assert.equal(accepted.statusCode,201);
 assert.ok(accepted.json.client_id.startsWith('socio_client_'));
 assert.equal(accepted.json.token_endpoint_auth_method,'none');
});
test('OAuth end-to-end com PKCE, login consentido, token e rotação de refresh',async()=>{
 const db=new Db(),registered=await oauth(db,'POST','/oauth/register',{redirect_uris:[callback]});
 const clientId=registered.json.client_id,verifier='A'.repeat(43);
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const q=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:'code',
  code_challenge:challenge,code_challenge_method:'S256',scope:'ads_media:read ads_media:write offline_access',
  state:'csrf-client-123',resource});
 const page=await oauth(db,'GET','/oauth/authorize?'+q.toString());
 assert.equal(page.statusCode,200);
 assert.ok(page.text.includes('Conectar vídeos ao ChatGPT'));
 assert.equal(page.headers['Referrer-Policy'],'same-origin',
  'authorization form must preserve its same-origin POST Origin in browsers');
 const hidden=[...page.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)];
 const form=new URLSearchParams(hidden.map(m=>[m[1],m[2]]));form.set('decision','approve');
 for(const headers of [{origin:'null'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}]){
  await assert.rejects(oauth(db,'POST','/oauth/authorize',form.toString(),headers),
   /OAuth request origin invalid/);
 }
 const grant=await oauth(db,'POST','/oauth/authorize',form.toString());
 assert.equal(grant.statusCode,303);
 const redirect=new URL(grant.headers.Location);
 assert.equal(redirect.origin,'https://chatgpt.com');
 assert.equal(redirect.searchParams.get('state'),'csrf-client-123');
 assert.equal(redirect.searchParams.get('iss'),env.SOCIO_PUBLIC_URL);
 const code=redirect.searchParams.get('code');assert.ok(code.startsWith('socio_code_'));
 const body=new URLSearchParams({client_id:clientId,redirect_uri:callback,grant_type:'authorization_code',
  code,code_verifier:verifier,resource});
 const response=await oauth(db,'POST','/oauth/token',body.toString());
 assert.equal(response.statusCode,200);
 assert.ok(response.json.access_token.startsWith('socio_oauth_'));
 assert.ok(response.json.refresh_token.startsWith('socio_refresh_'));
 assert.equal(response.json.expires_in,3600);
 const auth=await authenticateMediaOAuth(db,response.json.access_token,env);
 assert.equal(auth.active_tenant_id,tenant);
 assert.ok(auth.oauthScopes.includes('ads_media:write'));
 const replay=await oauth(db,'POST','/oauth/token',body.toString());
 assert.equal(replay.json.error,'invalid_grant');
 const refresh=await oauth(db,'POST','/oauth/token',new URLSearchParams({
  client_id:clientId,grant_type:'refresh_token',refresh_token:response.json.refresh_token,resource}).toString());
 assert.equal(refresh.statusCode,200);
 assert.ok(refresh.json.access_token!==response.json.access_token);
 assert.equal(await authenticateMediaOAuth(db,response.json.access_token,env),null);
 const old=await oauth(db,'POST','/oauth/token',new URLSearchParams({
  client_id:clientId,grant_type:'refresh_token',refresh_token:response.json.refresh_token,resource}).toString());
 assert.equal(old.json.error,'invalid_grant');
});
test('MCP bloqueia anônimos, aceita token OAuth, lista ferramentas sem tocar na Meta',async()=>{
 const db=new Db(),registered=await oauth(db,'POST','/oauth/register',{redirect_uris:[callback]});
 const client=registered.json.client_id,acc='socio_oauth_'+ 'A'.repeat(43);
 db.tokens.set(createHash('sha256').update(acc).digest('hex'),{
  client_id:client,scope:'ads_media:read',resource,revoked:false});
 async function mcp(authorization){
  const payload=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'});
  const req=request('POST','/mcp/ads-media',payload,{'content-type':'application/json',
   authorization:authorization||''});
  const res=response();await handleAdsMediaMcp(db,req,res);return res;
 }
 // Runtime uses process.env to build the audience; temporarily set only inside this test.
 const original=process.env.SOCIO_PUBLIC_URL;
 process.env.SOCIO_PUBLIC_URL=env.SOCIO_PUBLIC_URL;
 try{
  const none=await mcp();assert.equal(none.statusCode,401);
  assert.ok(none.headers['www-authenticate'].includes('resource_metadata='));
  const yes=await mcp('Bearer '+acc);
  assert.equal(yes.statusCode,200);assert.equal(yes.json.result.tools.length,5);
 }finally{if(original===undefined)delete process.env.SOCIO_PUBLIC_URL;else process.env.SOCIO_PUBLIC_URL=original;}
});
