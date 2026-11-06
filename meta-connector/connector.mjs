import {mkdirSync,writeFileSync,readFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir,hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {parseConnectionLink,connectorRequest,PRODUCTION_ORIGIN} from './protocol.mjs';
const root=resolve(process.env.SOCIO_CONNECTOR_DATA||join(process.env.LOCALAPPDATA||homedir(),'SocioMetaConnector','connections'));
mkdirSync(root,{recursive:true});
let link=process.argv[2];
if(!link){
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 try{const code=(await terminal.question('Cole o código de conexão exibido no Sócio (ou use o botão Conectar): ')).trim();link='socio-meta://connect?server='+encodeURIComponent(PRODUCTION_ORIGIN)+'&code='+code;}finally{terminal.close();}
}
const resumed=link==='--resume';
const slot=join(root,'last-connection.json');
let configuration;
if(resumed)configuration=JSON.parse(readFileSync(slot,'utf8'));
else{
 const target=parseConnectionLink(link,{allowLocalTest:process.env.SOCIO_CONNECTOR_ALLOW_LOCAL_TEST==='true'});
 const paired=await connectorRequest(target.server,'/api/meta-connector/pair',{code:target.code,deviceLabel:hostname().slice(0,80)});
 configuration={server:target.server,id:paired.connectionId};
 if(!/^[a-f0-9]{32}$/.test(configuration.id||''))throw Error('Identificador de conexão inválido.');
 configuration.token=paired.token;
}
if(!/^[a-f0-9]{32}$/.test(configuration.id||'')||(!resumed&&!/^[a-f0-9]{64}$/.test(configuration.token||'')))throw Error('Configuração inválida.');
// Revalidate even saved origins. Never send a token to a URL chosen by a job.
parseConnectionLink('socio-meta://connect?server='+encodeURIComponent(configuration.server)+'&code='+'0'.repeat(64),{allowLocalTest:process.env.SOCIO_CONNECTOR_ALLOW_LOCAL_TEST==='true'});
const home=join(root,createHash('sha256').update(configuration.server).digest('hex').slice(0,16)+'-'+configuration.id);
mkdirSync(home,{recursive:true});
process.env.API_ANYTHING_HOME=home;process.env.API_ANYTHING_LOCAL_ONLY='1';process.env.API_ANYTHING_ALLOW_IMPORT='';delete process.env.API_ANYTHING_PLAINTEXT;
const lock=join(home,'connector.lock');
let descriptor;
try{descriptor=openSync(lock,'wx',0o600);writeFileSync(descriptor,String(process.pid));}
catch(error){
 let stale=false;
 if(error.code==='EEXIST'){
  const pid=Number(readFileSync(lock,'utf8'));
  if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(probe){stale=probe.code==='ESRCH';}}
 }
 if(stale){try{unlinkSync(lock);descriptor=openSync(lock,'wx',0o600);writeFileSync(descriptor,String(process.pid));}catch{}}
 if(descriptor===undefined){console.log('Já existe um conector para esta conexão. Feche a janela anterior antes de abrir outra.');process.exit(1);}
}
const {loadRuntime}=await import('./runtime.mjs');
let runtime,stopping=false,heartbeatBusy=false;
const configPath=join(home,'connector.sealed'),configLabel='socio-connector:'+configuration.id;
const request=(path,data={})=>connectorRequest(configuration.server,path,data,configuration.token);
async function heartbeat(){
 if(heartbeatBusy||!runtime||stopping)return;
 heartbeatBusy=true;
 try{const state=runtime.status();await request('/api/meta-connector/heartbeat',{sessionPresent:state.sessionPresent,browserOpen:state.browserOpen});}
 catch(error){if([401,403].includes(error.status)){stopping=true;console.log(error.message);await runtime.close();}}
 finally{heartbeatBusy=false;}
}
let timer;
try{
 runtime=await loadRuntime();
 if(resumed)configuration.token=runtime.seal.readSealed(configPath,null,configLabel,'Conecte novamente pelo Sócio.')?.token;
 if(!/^[a-f0-9]{64}$/.test(configuration.token||''))throw Error('Conexão salva inválida.');
 if(!resumed){runtime.seal.writeSealed(configPath,JSON.stringify({token:configuration.token}),configLabel);writeFileSync(slot,JSON.stringify({server:configuration.server,id:configuration.id}),{mode:0o600});}
 console.log('Conector Sócio ativo. O login abre no navegador deste computador. Não compartilhe cookies, senha ou código de verificação.');
 console.log('Depois de concluir o login, feche a janela da Meta aberta pelo conector. Mantenha esta janela do conector aberta para usar as operações no Sócio.');
 timer=setInterval(()=>void heartbeat(),12000);await heartbeat();
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;void runtime.close();});
 while(!stopping){
  try{
   const polled=await request('/api/meta-connector/poll');
   if(!polled.job){await pause(4000);continue;}
   const job=polled.job;let result;
   try{result=await runtime.run(job.kind,job.input);}catch{result={ok:false,message:'Operação não concluída. Confira a janela da Meta e tente novamente somente após verificar o resultado.'};}
   await heartbeat();
   // A failed delivery never executes the command a second time.
   for(let attempt=0;attempt<2&&!stopping;attempt++){
    try{await request('/api/meta-connector/result',{jobId:job.id,lease:polled.lease,result});break;}
    catch(error){if(error.status===409)break;if([401,403].includes(error.status)){stopping=true;break;}await pause(3000);}
   }
  }catch(error){if([401,403].includes(error.status)){stopping=true;console.log(error.message);}else await pause(10000);}
 }
}finally{
 clearInterval(timer);if(runtime)await runtime.close().catch(()=>{});
 if(descriptor!==undefined)closeSync(descriptor);try{unlinkSync(lock);}catch{}
}
