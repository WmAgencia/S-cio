import {fork} from 'node:child_process';
import {createHmac,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
export function createFlowRuntime(){
 let running,child;
 const key=randomBytes(32).toString('hex');
 async function start(){
  if(running)return running;
  if(String(process.env.CHANNEL_ENCRYPTION_KEY||'').length<32)throw Object.assign(Error('Flow indisponível.'),{status:503});
  const root=resolve(process.env.SOCIO_META_BROWSER_DIR||'data/meta-browser','flow-owner');
  const names=['PATH','HOME','LANG','DISPLAY','PLAYWRIGHT_BROWSERS_PATH','BROWSER_EXECUTABLE_PATH','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE'];
  const env=Object.fromEntries(names.filter(n=>process.env[n]!==undefined).map(n=>[n,process.env[n]]));
  Object.assign(env,{API_ANYTHING_HOME:resolve(root,'api-anything'),API_ANYTHING_LOCAL_ONLY:'1',
   API_ANYTHING_KEY:createHmac('sha256',process.env.CHANNEL_ENCRYPTION_KEY).update('flow-owner').digest('hex'),
   FLOW_API_KEY:key,FLOW_DATA_DIR:root,FLOW_BINDING:resolve(root,'flow-binding.json')});
  running=new Promise((done,reject)=>{
   child=fork(new URL('./worker.mjs',import.meta.url),[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
   const timer=setTimeout(()=>{child?.kill();reject(Object.assign(Error('Flow indisponível.'),{status:503}));},15000);
   child.once('message',msg=>{clearTimeout(timer);if(msg.ready&&Number.isInteger(msg.port))done(`http://127.0.0.1:${msg.port}`);else reject(Error('Flow indisponível.'));});
   child.once('error',()=>{clearTimeout(timer);reject(Error('Flow indisponível.'));running=null;});
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Flow indisponível.'));running=null;child=null;});
  });
  return running;
 }
 return {
  async request(path,{method='GET',headers={},body}={}){
   const base=await start();
   return fetch(base+path,{method,signal:AbortSignal.timeout(15000),
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  },
  async close(){if(child){const current=child;await new Promise(done=>{const timer=setTimeout(()=>{current.kill('SIGKILL');done();},10000);current.once('exit',()=>{clearTimeout(timer);done();});current.kill('SIGTERM');});}}
 };
}
