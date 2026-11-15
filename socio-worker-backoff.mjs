// In-memory per-worker cooldown. Workers still rely on durable database leases
// for cross-replica coordination. This only prevents retry storms on a sick node.
export function createWorkerBackoff({baseMs=10000,maxMs=120000,now=()=>Date.now()}={}){
 if(!Number.isSafeInteger(baseMs)||baseMs<1000||!Number.isSafeInteger(maxMs)||maxMs<baseMs||
    typeof now!=='function')throw new TypeError('Invalid worker backoff settings');
 let failures=0,nextAt=0;
 return Object.freeze({
  canRun:()=>now()>=nextAt,
  recovered:()=>{failures=0;nextAt=0;},
  failed:()=>{
   failures=Math.min(20,failures+1);
   const delayMs=Math.min(maxMs,baseMs*Math.pow(2,Math.min(16,failures-1)));
   nextAt=now()+delayMs;
   return {failures,delayMs};
  },
  snapshot:()=>({failures,retryInMs:Math.max(0,nextAt-now())})
 });
}
