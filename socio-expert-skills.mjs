// Versioned, allowlisted expert guidance for Sócio's conversational router.
// SKILL.md is strategy/reference only. The server's RBAC and reviewed executors
// remain the sole authority to change external accounts or send WhatsApp messages.
import {readFileSync} from 'node:fs';
import {wantsCampaignOrder} from './socio-campaign-brief.mjs';
const CATALOG=Object.freeze([
 {id:'meta.campaigns.brief',label:'Briefing de campanha do dono',platform:'meta',availability:'assisted',path:'skills/campaign-brief/SKILL.md',canExecute:true},
 {id:'meta.campaigns',label:'Especialista em campanhas Meta Ads',platform:'meta',availability:'assisted',path:'skills/meta-campaigns/SKILL.md',canExecute:true},
 {id:'google.ads',label:'Especialista em Google Ads',platform:'google',availability:'pending_oauth_api',path:'skills/google-ads/SKILL.md',canExecute:false},
 {id:'tracking.conversions',label:'Especialista em rastreamento e atribuição',platform:'tracking',availability:'pending_website_integration',path:'skills/tracking/SKILL.md',canExecute:false},
 {id:'meta.optimization',label:'Diagnóstico e otimização Meta Ads',platform:'meta',availability:'analysis_only',path:'skills/meta-optimization/SKILL.md',canExecute:false},
 {id:'whatsapp.sales',label:'Funil de atendimento WhatsApp WA-AKG',platform:'whatsapp',availability:'supervised',path:'skills/whatsapp-sales/SKILL.md',canExecute:false},
 {id:'marketing.reports',label:'Relatórios de marketing e receita',platform:'meta',availability:'read_only',path:'skills/marketing-reports/SKILL.md',canExecute:true}
]);
const byId=new Map(CATALOG.map(s=>[s.id,s]));
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const google=/\b(google ads|google adwords|adwords|anuncio(?:s)? (?:no|do|pelo) google|campanha(?:s)? (?:no|do|pelo|para o) google|rede de pesquisa|google tag|google analytics|ga4)\b/;
const meta=/\b(meta ads|facebook ads|instagram ads|gerenciador de anuncios da meta|facebook|instagram)\b/;
const tracking=/\b(capi|conversions api|api de conversoes|rastrear (?:compra|venda|whatsapp)|rastreamento (?:de|do|no) whatsapp|pixel (?:no|dentro do) whatsapp|instalar (?:o )?pixel (?:no|em|dentro do) whatsapp|conversao (?:no|do|pelo) whatsapp)\b/;
const optimize=/\b(otimizar|otimize|otimizacao|melhorar|melhore|analisar|analise|diagnostico|rejeitado|rejeitados|reprovado|reprovados|bloqueado|bloqueados|sem entrega|nao entrega|baixo desempenho|resultado ruim)\b/;
const adTerms=/\b(campanha|campanhas|anuncio|anuncios|criativo|criativos|meta ads|trafego|facebook ads|instagram ads)\b/;
const whatsReport=/\b(whatsapp|zap|wa-akg)\b.*\b(relatorio|resultado|quantas? conversas?|quantos? leads?|quantas? vendas?|atribui|rastre)\b|\b(relatorio|resultado|quantas? conversas?|quantas? vendas?|atribui|rastre)\b.*\b(whatsapp|zap|wa-akg)\b/;

export function listExpertSkills(){
 return CATALOG.map(({path,...s})=>({...s,hasGuide:true,guide:path}));
}
export function getExpertSkillGuide(id){
 const entry=byId.get(id);
 if(!entry)throw Object.assign(new Error('Skill inexistente no catálogo.'),{status:404});
 // Never accept a caller-controlled filename/path.
 const contents=readFileSync(new URL('./'+entry.path,import.meta.url),'utf8');
 if(contents.length>16000||!contents.startsWith('# Skill'))throw Error('Guia de skill inválido.');
 return {skill:{...entry},instructions:contents};
}
export function selectExpertSkill(message){
 const text=normalize(message);
 if(text.length>1400)return {id:null,reason:'too_long'};
 const hasGoogle=google.test(text),hasMeta=meta.test(text);
 if(hasGoogle)return {id:'google.ads',reason:hasMeta?'multi_platform':'explicit_google'};
 // An owner's build instruction outranks read-only diagnosis, even when the
 // same sentence also mentions results or improvement.
 if(wantsCampaignOrder(text))return {id:'meta.campaigns.brief',reason:'owner_brief'};
 if(whatsReport.test(text)||
  (/\b(whatsapp|zap|wa-akg)\b/.test(text)&&/\b(quantos|quantas|chegando|respondendo|responderam|taxa de resposta|vendas|leads|origem|atribui|rastre)\b/.test(text)&&
   !/\b(criar|crie|campanha|anuncio|anunciar)\b/.test(text)))
  return {id:'whatsapp.sales',reason:'whatsapp_attribution_request'};
 if(tracking.test(text))return {id:'tracking.conversions',reason:'tracking_request'};
 if(optimize.test(text)&&adTerms.test(text))return {id:'meta.optimization',reason:'meta_diagnosis'};
 // Existing Meta Ads router owns mutations and reads when request is otherwise supported.
 return {id:'meta.campaigns',reason:'meta_default'};
}
