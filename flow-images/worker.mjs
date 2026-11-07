import {resolve} from 'node:path';
import {createApp} from './server.js';
import {createProvider} from './provider.js';
process.umask(0o077);
const app=createApp({key:process.env.FLOW_API_KEY,dbPath:resolve(process.env.FLOW_DATA_DIR,'jobs.sqlite'),provider:createProvider(process.env.FLOW_BINDING)});
app.server.listen(0,'127.0.0.1',()=>process.send?.({ready:true,port:app.server.address().port}));
let closing=false;
let browserModule,sequence=Promise.resolve();
process.on('message',message=>{sequence=sequence.then(async()=>{
 try{browserModule??=await import('./browser.mjs');const result=await browserModule.flowBrowserCommand(message.method,message.data);process.send?.({id:message.id,ok:true,result});}
 catch(error){const allowed=['LOGIN_NOT_FINISHED','BROWSER_NOT_OPEN','CHROMIUM_UNAVAILABLE','BROWSER_UNAVAILABLE','BROWSER_NAVIGATION_FAILED'];process.send?.({id:message.id,ok:false,code:allowed.includes(error.code)?error.code:'CONNECTION_FAILED'});}
 });});
async function close(){if(closing)return;closing=true;await browserModule?.closeFlowBrowser();await app.close();process.exit(0);}
process.once('SIGTERM',close);process.once('disconnect',close);
