// Groq model catalogue-based fallback. A failed text generation is safe to retry
// on a compatible model; WhatsApp delivery remains a single separate operation.
import {createHash} from 'node:crypto';
const BASE='https://api.groq.com/openai/v1';
const TASKS=Object.freeze({
 conversation:['openai/gpt-oss-120b','llama-3.3-70b-versatile','qwen/qwen3-32b','openai/gpt-oss-20b'],
 quick:['openai/gpt-oss-20b','llama-3.3-70b-versatile','openai/gpt-oss-120b'],
 training:['openai/gpt-oss-120b','llama-3.3-70b-versatile','openai/gpt-oss-20b'],
 voice:['openai/gpt-oss-20b','llama-3.3-70b-versatile','openai/gpt-oss-120b']
});
const cache=new Map();
export function rankAvailableGroqModels({preferred,task='conversation',available=[]}={}){
 const ids=new Set(available);
 const ordered=[preferred,...(TASKS[task]||TASKS.conversation)];
 return [...new Set(ordered.filter(x=>typeof x==='string'&&ids.has(x)))].slice(0,4);
}
export async function groqAvailableModels({env=process.env,fetchImpl=fetch,force=false,clock=Date.now}={}){
 const key=String(env.GROQ_API_KEY||'');
 if(key.length<20)return {ids:[],status:'not_configured'};
 const token=createHash('sha256').update(key).digest('hex').slice(0,18);
 const found=cache.get(token);
 if(!force&&found&&found.expire>clock())return {ids:[...found.ids],status:'cached'};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetchImpl(BASE+'/models',{headers:{Authorization:'Bearer '+key},signal:controller.signal});
  if(!response.ok)return {ids:[],status:'unavailable'};
  const data=await response.json();
  const ids=(Array.isArray(data.data)?data.data:[]).map(x=>x.id)
   .filter(x=>typeof x==='string'&&/^[a-z0-9_./-]{5,100}$/i.test(x)&&!x.includes('whisper')&&!x.includes('guard'));
  const unique=[...new Set(ids)].slice(0,100);
  cache.set(token,{ids:unique,expire:clock()+5*60_000});
  if(cache.size>24)cache.delete(cache.keys().next().value);
  return {ids:unique,status:'verified'};
 }catch{return {ids:[],status:'unavailable'};}finally{clearTimeout(timer);}
}
