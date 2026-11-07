import {resolve} from 'node:path';
import {createApp} from './server.js';
import {createProvider} from './provider.js';
process.umask(0o077);
const app=createApp({key:process.env.FLOW_API_KEY,dbPath:resolve(process.env.FLOW_DATA_DIR,'jobs.sqlite'),provider:createProvider(process.env.FLOW_BINDING)});
app.server.listen(0,'127.0.0.1',()=>process.send?.({ready:true,port:app.server.address().port}));
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();process.exit(0);}
process.once('SIGTERM',close);process.once('disconnect',close);
