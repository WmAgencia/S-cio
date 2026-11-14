// One brain, chosen by task. Campaign reasoning, copy and the reading of the
// account use DeepSeek when it is configured; conversation never comes here.
// If the brain provider fails, the Groq planning tier answers instead and the
// caller learns which provider actually replied, so a fallback is never
// mistaken for a successful DeepSeek call.
import {groqResponse,groqReady,groqModel} from './groq-client.mjs';
import {deepseekResponse,deepseekReady,deepseekModel} from './deepseek-client.mjs';
export const brainReady=(env=process.env)=>deepseekReady(env)||groqReady(env);
export const brainProvider=(env=process.env)=>
 deepseekReady(env)?'deepseek':groqReady(env)?'groq':null;
export const brainModel=(env=process.env)=>
 deepseekReady(env)?deepseekModel(env):groqModel(env,'planning');
export async function brainResponse(options={}){
 const env=options.env||process.env;
 if(deepseekReady(env)){
  try{
   return await deepseekResponse({...options,env});
  }catch(error){
   // Losing the brain must not stall a campaign, but it must be visible: the
   // returned provider tells the caller Groq answered, not DeepSeek.
   console.warn('[brain]',String(error?.message||'DEEPSEEK_FAILED').slice(0,160));
  }
 }
 return {...await groqResponse({...options,purpose:'planning',env}),provider:'groq'};
}
