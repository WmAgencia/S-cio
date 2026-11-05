// Model Context Protocol Streamable HTTP companion for the OFFICIAL Meta Ads MCP.
// No access to Meta tokens; never creates, activates or spends on ads.
import {authenticateMediaMcp,adVideoUploadLink,adVideoExportUrl,listAdVideos,findVideo,
 importWhatsAppAdVideo} from './ads-media.mjs';
const error=(id,message,code=-32603)=>({jsonrpc:'2.0',id,error:{code,message}});
const ok=(id,result)=>({jsonrpc:'2.0',id,result});
const tools=[
 {name:'ads_media_create_upload_link',
  description:'Prepare a short-lived upload page for an MP4/MOV advertising video. User uploads file there, then call ads_media_status. Does not create or publish Meta ads.',
  inputSchema:{type:'object',properties:{filename:{type:'string',description:'Original filename ending .mp4 or .mov'}},required:['filename'],additionalProperties:false}},
 {name:'ads_media_list',
  description:'List private advertising media for the authorized Sócio business, without exposing public URLs.',
  inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},
  annotations:{readOnlyHint:true}},
 {name:'ads_media_status',
  description:'Check whether an uploaded MP4/MOV is ready for Meta Ads. Only returns records for this business.',
  inputSchema:{type:'object',properties:{asset_id:{type:'string'}},required:['asset_id'],additionalProperties:false},
  annotations:{readOnlyHint:true}},
 {name:'ads_media_get_url',
  description:'Create a short-lived signed HTTPS file URL for ads_creative_upload_media (official Meta Ads MCP). Never call ads_activate_entity without user authorization.',
  inputSchema:{type:'object',properties:{asset_id:{type:'string'}},required:['asset_id'],additionalProperties:false}},
 {name:'ads_media_import_whatsapp',
  description:'Import an existing incoming WhatsApp video ONLY from the logged-in manager phone and an authorized company WA-AKG channel. Does not send WhatsApp messages.',
  inputSchema:{type:'object',properties:{channel_id:{type:'string'},jid:{type:'string'},message_id:{type:'string'},filename:{type:'string'}},
   required:['channel_id','jid','message_id','filename'],additionalProperties:false}}
];
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'none'});res.end(JSON.stringify(payload));}
function textContent(o){return {content:[{type:'text',text:JSON.stringify(o)}],structuredContent:o};}
async function readJson(req){
 let len=0,parts=[];
 for await(const chunk of req){len+=chunk.length;if(len>30000)throw new Error('request_too_large');parts.push(chunk);}
 const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_json');
 return value;
}
export async function handleAdsMediaMcp(pool,req,res){
 if(req.method!=='POST')return json(res,405,error(null,'Método não permitido.',-32600));
 const authorization=String(req.headers.authorization||'');
 if(!/^Bearer socioads_[A-Za-z0-9_-]{48}$/.test(authorization)){
  res.setHeader('WWW-Authenticate','Bearer realm="socio-ads-media"');
  return json(res,401,error(null,'MCP requer token de acesso Sócio.',-32001));
 }
 let actor;
 try{actor=await authenticateMediaMcp(pool,authorization.slice(7));}
 catch{res.setHeader('WWW-Authenticate','Bearer realm="socio-ads-media"');
  return json(res,401,error(null,'MCP não autorizado.',-32001));}
 let request;
 try{request=await readJson(req);}
 catch{return json(res,400,error(null,'JSON RPC inválido.',-32700));}
 const id=request.id??null;
 if(request.method==='notifications/initialized')return json(res,202,{});
 if(request.jsonrpc!=='2.0')return json(res,400,error(id,'Protocolo inválido.',-32600));
 if(request.method==='initialize'){
  return json(res,200,ok(id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},
   serverInfo:{name:'socio-ads-media-bridge',version:'1.0.0'},
   instructions:'Use estas ferramentas apenas para preparar vídeos e obter URLs temporárias. O MCP oficial da Meta é responsável por upload, criativos, anúncios e publicação autorizada. Nunca afirme que um anúncio foi publicado por este servidor.'}));
 }
 if(request.method==='ping')return json(res,200,ok(id,{}));
 if(request.method==='tools/list')return json(res,200,ok(id,{tools}));
 if(request.method!=='tools/call')return json(res,400,error(id,'Método não disponível.',-32601));
 const name=request.params?.name,args=request.params?.arguments||{};
 if(typeof args!=='object'||!args||Array.isArray(args)||!tools.some(x=>x.name===name))
  return json(res,200,error(id,'Ferramenta ou argumentos inválidos.',-32602));
 try{
  let output;
  if(name==='ads_media_create_upload_link')output=await adVideoUploadLink(pool,actor,args.filename);
  else if(name==='ads_media_list')output={items:await listAdVideos(pool,actor.active_tenant_id,args.limit)};
  else if(name==='ads_media_status'){
   const row=await findVideo(pool,actor.active_tenant_id,args.asset_id);
   output={id:row.id,status:row.status,filename:row.filename,bytes:row.bytes,source:row.source,ready:row.status==='ready'};
  }else if(name==='ads_media_get_url')
   output=await adVideoExportUrl(pool,actor.active_tenant_id,args.asset_id);
  else if(name==='ads_media_import_whatsapp')
   output=await importWhatsAppAdVideo(pool,actor,{channelId:args.channel_id,jid:args.jid,messageId:args.message_id,filename:args.filename});
  return json(res,200,ok(id,textContent(output)));
 }catch(e){
  return json(res,200,ok(id,{isError:true,content:[{type:'text',text:String(e.message||'Não foi possível concluir.').slice(0,200)}]}));
 }
}
