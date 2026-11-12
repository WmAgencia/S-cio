// Shared safety watchdog for scheduled, read-only backup workers.
// No customer data, connection strings, credentials, SQL or object paths in logs.
// A stalled cron must FAIL visibly rather than remain "running" indefinitely.
// Finishing the watchdog does not prove that the remote backup is restorable.
const DEFAULT_MS=40*60*1000;
const MAX_MS=3*60*60*1000;
export function createBackupWatchdog({scope,getStage,timeoutMs}={}){
 if(!/^(postgres|mysql)$/.test(String(scope)))throw new Error('Unsupported backup scope');
 if(typeof getStage!=='function')throw new Error('Stage callback required');
 const raw=timeoutMs??process.env.SOCIO_BACKUP_MAX_RUNTIME_MS??DEFAULT_MS;
 const ms=Number(raw);
 if(!Number.isInteger(ms)||ms<1||ms>MAX_MS)throw new Error('Invalid backup runtime limit');
 const started=Date.now();
 let stopped=false;
 const timer=setTimeout(()=>{
  if(stopped)return;
  const stage=String(getStage()||'unknown').replace(/[^a-z0-9-]/gi,'').slice(0,56);
  console.error(JSON.stringify({
   ok:false,code:'BACKUP_TIMEOUT',scope,stage,
   elapsedSeconds:Math.ceil((Date.now()-started)/1000),
   timeoutSeconds:Math.ceil(ms/1000)
  }));
  // Read-only source, standalone cron process. Hard-fail to avoid an
  // indefinite job occupying the scheduler; no database migration or write.
  process.exit(124);
 },ms);
 return Object.freeze({
  progress(stage){
   const name=String(stage||'unknown').replace(/[^a-z0-9-]/gi,'').slice(0,56);
   console.info(JSON.stringify({event:'BACKUP_STAGE',scope,stage:name}));
  },
  stop(){
   if(stopped)return;
   stopped=true;
   clearTimeout(timer);
  }
 });
}
