// DeepSeek V4.1 Flash is the campaign brain: strategy, copy and the reading of
// the account. Conversation never comes through here — the WhatsApp reply, the
// simulator and the orb stay on Groq. Every request uses the OpenAI-compatible
// shape so a different provider can be adopted by changing the base URL.
const DEFAULT_BASE='https://api.deepseek.com';
const DEFAULT_MODEL='deepseek-flash';
const EFFORTS=new Set(['low','high','max']);
const bad=(status,message)=>Object.assign(new Error(message),{status});
export const deepseekReady=(env=process.env)=>
 typeof env.DEEPSEEK_API_KEY==='string'&&env.DEEPSEEK_API_KEY.trim().length>=20;
export const deepseekBaseUrl=(env=process.env)=>{
 const raw=String(env.DEEPSEEK_BASE_URL||DEFAULT_BASE).replace(/\/+$/,'');
 return /^https:\/\/[a-z0-9.-]{3,253}(:\d{2,5})?(\/[a-z0-9._~-]+)*$/i.test(raw)?raw:DEFAULT_BASE;
};
export const deepseekModel=(env=process.env)=>{
 const name=String(env.DEEPSEEK_MODEL||DEFAULT_MODEL);
 return /^[a-z0-9_.\/-]{3,80}$/i.test(name)?name:DEFAULT_MODEL;
};
// Thinking is on by default at "high". Copy does not need depth and answers
// faster at "low"; "off" is kept for tasks that must return immediately.
export const deepseekThinking=(effort)=>{
 if(effort==='off')return {thinking:{type:'disabled'}};
 return {thinking:{type:'enabled'},reasoning_effort:EFFORTS.has(effort)?effort:'high'};
};
export async function deepseekResponse({instructions,input,maxOutputTokens=450,effort='high',
 env=process.env,fetchImpl=fetch,timeoutMs=60000}={}){
 if(!deepseekReady(env))throw bad(503,'DEEPSEEK_API_KEY não configurada para o Sócio.');
 if(typeof input!=='string'||!input.trim()||input.length>200000)
  throw bad(422,'Conteúdo de análise inválido.');
 if(typeof instructions!=='string'||instructions.length>25000)
  throw bad(422,'Instruções inválidas.');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),
  Math.min(120000,Math.max(5000,timeoutMs)));
 try{
  const resp=await fetchImpl(deepseekBaseUrl(env)+'/chat/completions',{
   method:'POST',
   headers:{Authorization:'Bearer '+env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({model:deepseekModel(env),
    messages:[{role:'system',content:instructions},{role:'user',content:input}],
    max_tokens:Math.max(240,Math.min(8192,Number(maxOutputTokens)||700)),
    ...deepseekThinking(effort),
    stream:false}),
   signal:controller.signal
  });
  if(!resp.ok)throw bad(503,resp.status===401||resp.status===403?
   'Credencial DeepSeek rejeitada. Confira DEEPSEEK_API_KEY.':
   resp.status===429?'Limite de uso do DeepSeek atingido.':'Serviço DeepSeek indisponível no momento.');
  const result=await resp.json();
  const reply=result.choices?.[0]?.message?.content;
  if(typeof reply!=='string'||!reply.trim())
   throw bad(503,'DeepSeek não retornou texto utilizável.');
  return {ok:true,reply:reply.trim(),model:result.model||deepseekModel(env),provider:'deepseek'};
 }catch(error){
  if(error.name==='AbortError')throw bad(503,'A resposta do DeepSeek excedeu o tempo limite.');
  if(error.status)throw error;
  throw bad(503,'Não foi possível comunicar com o DeepSeek.');
 }finally{clearTimeout(timeout);}
}
