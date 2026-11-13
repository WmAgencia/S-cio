// Sócio Creative Studio v1. Drafts only; never authorizes Meta POST or spend.
// Uses ONLY provided business/category/location — no unverified superiority,
// discounts, prices, deadlines, health results, scarcity, or buyer attributes.
export const CREATIVE_STUDIO_VERSION='socio-creative-studio-v1';
const trim=x=>String(x??'').replace(/[\r\n\t<>]+/g,' ')
 .replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s{2,}/g,' ').trim();
const truncated=(x,n)=>trim(x).slice(0,n).trim();
const normalize=x=>trim(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const risky=/\b(?:garantid[oa]s?|comprovad[oa]s?|milagros[oa]s?|cura|curar|resultados? em \d+ dias?|100\s?%|primeiro lugar|melhor do mundo|sem risco|desconto|promocao|gratis|gratuit[oa]|ultima[s]? unidade[s]?|so hoje|metade do preco)\b/i;
// The owner answers by voice, so a slot question can come back as a fragment of
// conversation ("então, o sistema", "Sistema, sócio") or as a word that names
// nothing ("produto", "coisa"). Those reached the campaign name before and
// produced "Sócio | Então, o sistema | todo o Brasil".
const CHATTER=new Set(('socio entao tipo olha bom bem agora claro beleza ok sim nao tambem apenas mais menos muito pouco aqui ai la mesmo todo toda todos todas coisa coisas negocio empresa produto produtos servico servicos item itens catalogo qualquer vou quero queria preciso pode faz fazer criar anunciar divulgar vender venda campanha anuncio anuncios reais whatsapp zap site link brasil').split(' '));
const VAGUE_SUBJECT=/^(?:produtos?|servicos?|itens?|coisas?|catalogo|qualquer|algo|tudo|nada|isso|aqui|coisa|negocio)$/;
// A word can be the subject of the conversation and still be too generic to name
// a campaign; the name falls back to the objective in that case.
const GENERIC_NAME=/^(?:sistema|produto|servicos?|coisa|negocio|empresa|app|aplicativo|catalogo|tudo|isso|aqui|nada|algo|qualquer|produtos e servicos|sua regiao)$/;
const LEADING_FILLER=/^(?:e|mas|ai|entao|tipo|olha|bom|bem|agora|claro|beleza|ok|sim|nao|tambem|apenas|mais|menos|muito|pouco|esse|essa|este|esta|isso|aquele|aquela)(?:\s|$)/;
const flatten=x=>normalize(x).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
export function plausibleProduct(value){
 const spoken=trim(value);
 const raw=spoken.replace(/^[\s"'“”‘’\-–—]+|[\s"'“”‘’\-–—]+$/g,'')
  .replace(/^(?:(?:o|a|os|as|um|uma|meu|minha|meus|minhas|nosso|nossa|nossos|nossas|esse|essa|este|esta|isso)\s+)+/i,'')
  .replace(/[.,;:!?]+$/,'').trim();
 if(raw.length<3||raw.length>70)return null;
 const flat=flatten(raw);
 if(!flat)return null;
 // "Sistema, sócio" addresses the assistant; "sistema sócio" names the product.
 if(/^socio\b/.test(flatten(spoken))||/,\s*socio\b/.test(normalize(spoken)))return null;
 if(LEADING_FILLER.test(flat))return null;
 const words=flat.split(' ');
 if(words.length>7)return null;
 if(words.every(w=>w.length<3||VAGUE_SUBJECT.test(w)||CHATTER.has(w)))return null;
 return raw;
}
export function nameableProduct(value){
 const product=plausibleProduct(value);
 return product&&!GENERIC_NAME.test(flatten(product))?product:null;
}
const capitalize=x=>x.charAt(0).toUpperCase()+x.slice(1);
// The campaign name is built from what is certain: the product when it is a real
// product, the objective the owner asked for, the place and the day.
export function campaignObjectiveLabel(brief={}){
 if(brief.goal==='awareness')return 'Reconhecimento da marca';
 if(brief.destination==='whatsapp')return 'Conversas no WhatsApp';
 if(brief.destination==='website')return brief.goal==='sales_site'?'Vendas pelo site':'Acessos ao site';
 return 'Campanha';
}
function safeInput(raw,limit){return truncated(raw,limit);}
function assess(raw){
 const text=normalize(raw);
 return risky.test(text)||/\b\d+\s?%\b/.test(text);
}
const dayStamp=(d=new Date())=>String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
export function buildApprovedAdCreativeDrafts(brief={},tenantName='Empresa'){
 const name=safeInput(tenantName,55)||'Empresa';
 const rawCategory=safeInput(brief.category,65);
 const product=plausibleProduct(rawCategory);
 const nameProduct=nameableProduct(rawCategory);
 const category=product||'produtos e serviços';
 const city=safeInput(brief.cityName,52)||'sua região';
 const destination=brief.destination==='website'?'site':brief.destination==='whatsapp'?'WhatsApp':'atendimento';
 const cta=destination==='WhatsApp'?'Fale com nossa equipe pelo WhatsApp.':
  destination==='site'?'Confira os detalhes no nosso site.':'Entre em contato para saber mais.';
 // The review follows what the owner actually wrote, even when the phrase is too
 // vague to be used as a product name.
 const unsafeClaims=assess(rawCategory)||assess(name);
 const opening=capitalize(category);
 const campaignParts=['Sócio'];
 if(nameProduct)campaignParts.push(capitalize(nameProduct));
 campaignParts.push(campaignObjectiveLabel(brief),city,dayStamp());
 const variants=[
  {style:'apresentacao',headline:truncated(opening+' em '+city,120),
   message:truncated('Conheça '+category+' de '+name+' em '+city+'. '+cta,500)},
  {style:'consultivo',headline:truncated('Quer saber mais sobre '+category+'?',120),
   message:truncated('Buscando informações sobre '+category+' em '+city+'? Converse com a equipe de '+name+' e tire suas dúvidas. '+cta,500)},
  {style:'objetivo',headline:truncated(name+' | '+opening,120),
   message:truncated('Confira as opções de '+category+' com '+name+'. '+cta,500)}
 ];
 const results=variants.map(v=>({...v,headline:v.headline||'Conheça nossos produtos',
  message:v.message||'Fale com a equipe para mais detalhes.'}));
 return {
  name:truncated(campaignParts.join(' · '),120),
  variants:results,
  reviewRequired:unsafeClaims,
  reviewReason:unsafeClaims?'A descrição fornecida pode conter promessa, oferta, resultado ou urgência não verificados. Revise o produto antes de anunciar.':null,
  rules:['Não declarar preços, prazos, descontos, estoque ou resultados não verificados.',
   'A Meta revisa o anúncio; a aprovação não é garantida.',
   'A criação ocorre pausada e veiculação requer autorização separada.'],
  provenance:'briefing_do_proprietario_sem_verificacao_de_alegacoes',
  executionAllowed:!unsafeClaims
 };
}
export function primaryCreativeDraft(brief={},tenantName='Empresa'){
 const result=buildApprovedAdCreativeDrafts(brief,tenantName);
 return {name:result.name,headline:result.variants[0].headline,message:result.variants[0].message};
}
