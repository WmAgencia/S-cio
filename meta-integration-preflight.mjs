// Read-only, tenant-scoped live Meta app preflight. This uses the Sócio OAuth grant,
// NEVER the ChatGPT Meta Ads connector or credentials from another tenant.
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {officialStatus} from './meta-official.mjs';
import {readAdsTool} from './meta-ads-tools.mjs';

const KINDS=Object.freeze(['campaigns','adsets','ads','insights','pages','images']);
const err=e=>String(e?.message||'Consulta indisponível').replace(/[\u0000-\u001f<>]/g,' ').slice(0,160);

export async function metaConnectionPreflight(pool,actor,{statusFn=officialStatus,readFn=readAdsTool,env=process.env,request=fetch}={}){
 requirePermission(actor,'marketing.read');
 assertApiFeature(actor.features,'/api/marketing/tools');
 const official=await statusFn(pool,actor,{env});
 const scopes=Array.isArray(official.grant?.scopes)?official.grant.scopes:[];
 const account=official.selectedAccount||null;
 const base={configured:official.configured===true,
  connected:official.connected===true,
  accountId:account?.account_id||null,accountName:account?.account_name||null,
  currency:account?.currency||null,
  hasAdsRead:scopes.includes('ads_read'),
  hasAdsManagement:scopes.includes('ads_management'),
  checks:[],status:'needs_connection',readOnly:true,
  warning:'Este teste usa exclusivamente a autorização Meta salva no Sócio, sem modificar anúncios ou orçamento.'};
 if(!base.configured)return {...base,reason:'O aplicativo Meta precisa ser configurado no Railway.'};
 if(!base.connected||!base.hasAdsRead)return {...base,reason:'Conecte o Facebook ao Sócio e autorize ads_read.'};
 if(!account)return {...base,reason:'Selecione a conta de anúncios desta empresa.'};
 // Read-only tasks. Partial failures are surfaced rather than silently claiming success.
 const answers=await Promise.all(KINDS.map(async kind=>{
  try{
   const data=await readFn(pool,actor,kind,{period:'last_7d'},{env,request});
   const items=Array.isArray(data.items)?data.items:[];
   return {kind,ok:true,count:items.length,more:Boolean(data.hasMore),
    examples:items.slice(0,3).map(x=>({
     id:typeof x.id==='string'?x.id:null,name:typeof x.name==='string'?x.name.slice(0,100):null,
     status:x.effective_status||x.status||null,
     ...(kind==='insights'?{spend:x.spend||null,clicks:x.clicks||null,impressions:x.impressions||null}: {})
    }))};
  }catch(error){return {kind,ok:false,error:err(error)};}
 }));
 base.checks=answers;
 const critical=['campaigns','adsets','ads','insights'];
 base.status=critical.every(kind=>answers.find(x=>x.kind===kind)?.ok)?'read_ready':'partial';
 base.reason=base.status==='read_ready'?
  'Consultas essenciais de campanhas, conjuntos, anúncios e métricas confirmadas na conta selecionada.':
  'Uma ou mais consultas essenciais falharam. Confira as permissões e a conexão Meta.';
 return base;
}
