import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const SITE='adsmanager.facebook.com';
export async function loadRuntime(){
 const require=createRequire(import.meta.url),dist=dirname(require.resolve('api-anything'));
 const internal=name=>import(pathToFileURL(join(dist,name+'.js')).href);
 const aa=await import('api-anything'),host=await import('api-anything/host');
 const sessions=await internal('session'),login=await internal('login'),seal=await internal('seal');
 if(!seal.sealing().sealed)throw Error('Não foi possível proteger a conexão com a cifra do sistema operacional.');
 if(!aa.loadSite(SITE))aa.saveSite({name:SITE,baseUrl:'https://adsmanager.facebook.com/',loginCookies:['c_user','xs'],operations:[]});
 return {...createCommandRunner({aa,host,sessions,windowLogin:login.windowLogin}),seal,aa};
}
export function createCommandRunner({aa,host,sessions,windowLogin}){
 let browserOpen=false;
 const plans=new Map();
 function status(){
  const cookies=sessions.loadSession(SITE).cookies;
  return {sessionPresent:cookies.some(c=>c.name==='c_user'&&c.value)&&cookies.some(c=>c.name==='xs'&&c.value),browserOpen,operations:host.hostSite(SITE)?.operations||[],liveValidated:false};
 }
 return {
  status,
  async run(kind,input={}){
   if(kind==='status')return {ok:true,...status()};
   if(kind==='login'){
    browserOpen=true;
    try{
     // A visible browser on this computer; no passwords, cookies or keystrokes cross the relay.
     const result=await windowLogin(SITE,'https://adsmanager.facebook.com/',{loginCookies:['c_user','xs'],waitForEnter:false});
     return {ok:result.ok,sessionPresent:status().sessionPresent,liveValidated:false,message:result.ok?'Sessão salva neste computador.':'Conclua o login e as verificações na janela da Meta; depois feche essa janela.'};
    }finally{browserOpen=false;}
   }
   if(kind==='plan'){
    if(browserOpen)return {ok:false,message:'Feche a janela de login antes de preparar uma operação.'};
    const plan=host.planCall(SITE,input.operation,input.args||{},{maxTier:1});
    if(!plan.ok)return plan.result;
    for(const [id,row] of plans)if(row.expires<Date.now())plans.delete(id);
    if(plans.size>=50)throw Error('Muitos planos pendentes.');
    const id=randomBytes(24).toString('hex');plans.set(id,{plan,expires:Date.now()+300000});
    return {ok:true,plan_id:id,read_only:plan.readOnly,request:plan.request,expires_in:300};
   }
   if(kind==='execute'){
    const row=plans.get(input.plan_id);plans.delete(input.plan_id);
    if(!row||row.expires<Date.now())return {ok:false,message:'Plano expirado ou já utilizado.'};
    return host.callPlanned(row.plan,{maxTier:1,allowWrites:input.allow_writes===true,timeoutMs:45000});
   }
   throw Error('Comando não autorizado.');
  },
  async close(){await aa.closeBrowser();await aa.shutdown();},
 };
}
