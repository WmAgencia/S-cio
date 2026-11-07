// Adapted directly from Prospector/dashboard/francisca-semantic-turn.mjs.
// Client-side deterministic endpointing after STT; no audio/transcript storage.
const norm=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const trailing=/\b(?:e|mas|porque|pois|para|pra|pro|com|sem|de|do|da|dos|das|que|se|quando|entao|tipo|assim|aí|ai|eu|voce|voces|quero|preciso|pode|consegue|vou|deixa|fala|envia|manda)\s*[,.…-]*$/;
const unfinished=/\b(?:o seguinte|eu quero que|preciso que|queria que|a ideia e|a minha duvida e|eu estava pensando|so que|o problema e|sobre aquele|me explica como)\s*[,.…-]*$/;
const startsQuestion=/^(?:quem|como|quando|quanto|onde|qual|quais|o que|por que|porque|sera que|pode me dizer)/;
export function semanticTurnAssessment(utterance){
 const s=norm(utterance).replace(/[!?]+$/,'');
 if(s.length<7)return {incomplete:false};
 if(/[?!.]\s*$/.test(String(utterance||'').trim()))return {incomplete:false};
 if(trailing.test(s)||unfinished.test(s)||/\b(?:ahn|ahm|hum|eh|er)\s*[,.…-]*$/.test(s))return {incomplete:true};
 if(startsQuestion.test(s))return {incomplete:false};
 return {incomplete:false};
}
export function newSemanticTurnBuffer({maxWaitMs=16000,maxParts=3,maxChars=950}={}){
 let pieces=[],started=0;
 return {
  take(text,{now=Date.now()}={}){
   const raw=String(text||'').trim();
   if(pieces.length&&now-started>maxWaitMs){pieces=[];started=0;}
   const combined=pieces.length?pieces.join(' ')+' '+raw:raw;
   if(semanticTurnAssessment(combined).incomplete&&pieces.length<maxParts&&combined.length<maxChars){
    pieces.push(raw);started ||= now;
    return {hold:true,spoken:'',count:pieces.length};
   }
   pieces=[];started=0;
   return {hold:false,text:combined};
  },
  reset(){pieces=[];started=0;},
  get pending(){return pieces.length;}
 };
}
