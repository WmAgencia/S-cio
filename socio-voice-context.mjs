// Speech recognition gets better when it is told what the speaker is likely to
// say. Whisper accepts a prompt that biases decoding toward names, so every
// transcription carries the tenant's own vocabulary: company name, catalog
// items, campaigns and the question the assistant just asked. This module owns
// that vocabulary and the small set of speech artifacts worth normalising
// before intent detection. It never stores audio or transcripts.

const STATIC_ADS=
 'Atendimento e anúncios em português do Brasil: Meta Ads, Gerenciador de Anúncios, '+
 'campanha, conjunto de anúncios, anúncio, criativo, público, orçamento diário em reais, '+
 'cliques, impressões, CTR, CPC, custo por conversa, conversas no WhatsApp, '+
 'pausar, ativar, aumentar orçamento, reduzir orçamento, relatório, faturamento.';

const cleanLine=value=>String(value??'').replace(/[<>\r\n\t]/g,' ').replace(/\s+/g,' ').trim();

// Keep the prompt on whole words: a truncated "Campanh" can bias the decoder
// toward a word that does not exist.
function cutWords(text,limit){
 if(text.length<=limit)return text;
 const slice=text.slice(0,limit);
 const at=Math.max(slice.lastIndexOf(', '),slice.lastIndexOf('. '),slice.lastIndexOf(' '));
 return (at>limit*0.6?slice.slice(0,at):slice).trim();
}

export function buildSttPrompt({tenantName='',products=[],campaigns=[],asked='',leading='',limit=600}={}){
 const parts=[];
 const name=cleanLine(tenantName).slice(0,60);
 if(name)parts.push('Empresa: '+name+'.');
 const items=products.map(cleanLine).filter(x=>x.length>1).slice(0,10);
 if(items.length)parts.push('Produtos e serviços: '+items.join(', ')+'.');
 const campaignNames=campaigns.map(cleanLine).filter(x=>x.length>2).slice(0,8);
 if(campaignNames.length)parts.push('Campanhas: '+campaignNames.join('; ')+'.');
 const question=cleanLine(asked).slice(0,160);
 if(question)parts.push('A pergunta feita foi: '+question);
 parts.push(cleanLine(leading)||STATIC_ADS);
 return cutWords(parts.join(' '),limit);
}

// Speech artifacts that change a command's meaning. Only unambiguous mappings
// are applied; real Portuguese words ("metade") are never replaced.
// Accented letters are not word characters in JavaScript's \b, so the spelled
// acronyms are matched with explicit spacing instead of word boundaries.
const ARTIFACTS=[
 [/\bmeta\s*(?:edge|edis|adis?|ads?)\b/gi,'Meta Ads'],
 [/\bgoogle\s*adis\b/gi,'Google Ads'],
 [/\bwhats\s*app\b|\bwhats\s*zap\b|\bwhatsap\b/gi,'WhatsApp'],
 [/(^|\s)c[êe]\s*p[êe]\s*c[êe](?=\s|$)/gi,'$1CPC'],
 [/(^|\s)c[êe]\s*p[êe]\s*[ée]le(?=\s|$)/gi,'$1CPL'],
 [/(^|\s)c[êe]\s*t[êe]\s*r[êe](?=\s|$)/gi,'$1CTR'],
 [/\bce\s*pe\s*ce\b/gi,'CPC'],
 [/\bce\s*pe\s*ele\b/gi,'CPL'],
 [/\bce\s*te\s*re\b/gi,'CTR']
];
export function normalizeSpokenIntent(text){
 let value=String(text??'');
 for(const [pattern,replacement] of ARTIFACTS)value=value.replace(pattern,replacement);
 return value.replace(/\s{2,}/g,' ').trim();
}

const TTL_MS=10*60*1000;
const cache=new Map();

async function tenantVocabulary(pool,a,{readAds=null,timeoutMs=2500}={}){
 const key=String(a?.active_tenant_id||'');
 if(!key)return {tenantName:'',products:[],campaigns:[]};
 const hit=cache.get(key);
 const now=Date.now();
 if(hit&&now-hit.at<TTL_MS)return hit.value;
 const [tenant,products]=await Promise.all([
  pool.query('SELECT name FROM tenants WHERE id=$1',[key]).catch(()=>({rows:[]})),
  pool.query('SELECT name FROM products WHERE tenant_id=$1 AND active=true ORDER BY updated_at DESC NULLS LAST LIMIT 10',[key])
   .catch(()=>({rows:[]}))
 ]);
 const value={tenantName:tenant.rows?.[0]?.name||'',
  products:(products.rows||[]).map(x=>x.name).filter(Boolean),campaigns:[]};
 cache.set(key,{at:now,value});
 // Campaign names are the most valuable hints and the most expensive to read,
 // so they load in the background and enrich the next transcription.
 if(readAds&&!hit?.campaignsLoaded){
  Promise.resolve()
   .then(()=>Promise.race([
    readAds(pool,a,'campaigns',{}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),timeoutMs))
   ]))
   .then(result=>{
    const names=(result?.items||[]).map(x=>x?.name).filter(Boolean).slice(0,8);
    const current=cache.get(key);
    if(current)current.value={...current.value,campaigns:names};
    cache.set(key,{at:Date.now(),value:{...value,campaigns:names},campaignsLoaded:true});
   })
   .catch(()=>{cache.set(key,{at:Date.now(),value,campaignsLoaded:true});});
 }
 return value;
}

export function createVoiceVocabulary(pool,{readAds=null}={}){
 return async function vocabulary(a,{asked='',leading=''}={}){
  let tenant={tenantName:'',products:[],campaigns:[]};
  try{tenant=await tenantVocabulary(pool,a,{readAds});}catch{}
  return buildSttPrompt({...tenant,asked,leading});
 };
}
