// Distinguishes an owner's order to build a campaign from a question about the
// campaigns already running. Spoken briefs mix the two in one sentence ("crie
// uma campanha ... e melhorar o desempenho"), and a creation order must win
// over report/diagnosis parsing, otherwise the owner hears about another
// campaign instead of the one they just described.
const normalize=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
const TARGET=/\b(campanha|campanhas|anuncio|anuncios|publicidade|propaganda|trafego pago|anunciar|divulgar|impulsionar)\b/;
// A verb that only exists to order the build, regardless of any other detail.
const BUILD=/\b(criar|crie|cria|montar|monte|fazer|faca|subir|suba|sobe|lancar|lance|gerar|gere|anunciar|anuncie|divulgar|divulgue|impulsionar|turbinar)\b/;
const WANT=/\b(quero|queria|preciso|gostaria|vamos|pode)\b/;
const MONEY=/\bR\$\s*\d|\b\d{1,6}(?:[.,]\d{1,2})?\s*(?:reais|real)\b|\bpor dia\b/;
const DESTINATION=/\b(whatsapp|zap|wpp|site|landing page|loja online|e-commerce|ecommerce|instagram)\b/;
const MEDIA=/\b(foto|video|imagem|criativo)\b/;
const SELL=/\b(vender|venda|vendas|divulgar|anunciar|promover)\b/;
const CITY_STOP=/\bem\s+(?:geral|casa|conta|conjunto|seguida|breve|todos|tudo|media|detalhe|dia|dinheiro|um|uma|meu|minha)\b/;
const cityCue=raw=>{
 const s=String(raw||'');
 return /\bem\s+[A-ZÀ-Ú]/.test(s)||(/\bem\s+[a-z]{4,}\b/.test(normalize(s))&&!CITY_STOP.test(normalize(s)));
};
// "Quero melhorar os resultados" is a diagnosis wish, not a build order.
const IMPROVE=/\b(melhorar|melhore|otimizar|otimize|otimizacao|analisar|analise|diagnostico|desempenho|resultados?)\b/;
const READ_START=/^(?:como|quais|quant[oa]s?|quando|onde|por que|porque|me\s+(?:explica|ensina|mostra|mostre|diga|diz|ajuda|fala|manda)|explique|explica|relatorio|resumo|analise|analisa|otimiz|diagnostico|(?:me\s+)?(?:faca|faz|manda)\s+(?:um\s+|o\s+|a\s+)?(?:resumo|relatorio|analise|diagnostico|comparacao|lista))\b/;
const ASK_START=/^(?:quero|queria|preciso|gostaria|pode)\s+(?:saber|ver|entender|conferir|consultar|acompanhar|me\s+(?:dizer|explicar|mostrar|falar))\b/;
const CHANGE_WITH_ID=/\b(?:id|#)\s*\d{4,30}\b/;
const CHANGE_VERB=/\b(pausar|pause|desativar|desative|ativar|ative|aumentar|aumente|reduzir|reduza|alterar|altere|mudar|mude|excluir|exclua|deletar)\b/;

function sharedText(text){
 if(typeof text!=='string')return null;
 const t=normalize(text);
 if(!t||t.length>1400)return null;
 if(/\bgoogle\s*ads\b|\badwords\b/.test(t))return null;
 // Pixel, tracking, CAPI and WhatsApp reporting have their own skills.
 if(/\b(pixel|pixels|capi|conversions api|rastreamento)\b/.test(t))return null;
 if(/\b(whatsapp|zap|wa-akg)\b/.test(t)&&/\b(relatorio|resultado|conversas|leads|vendas|atribui|quantos?)\b/.test(t))return null;
 if(READ_START.test(t)||ASK_START.test(t))return null;
 if(CHANGE_WITH_ID.test(t)&&CHANGE_VERB.test(t))return null;
 return TARGET.test(t)?t:null;
}

export function isCampaignCreationRequest(text){
 const t=sharedText(text);
 if(!t)return false;
 if(BUILD.test(t))return true;
 // Without an explicit build verb, the message must carry a concrete brief
 // detail, and an improvement wish keeps its diagnosis meaning.
 if(IMPROVE.test(t))return false;
 return WANT.test(t)&&(MONEY.test(t)||DESTINATION.test(t)||MEDIA.test(t)||
  SELL.test(t)||cityCue(text));
}

// A detailed brief can arrive without any verb ("Campanha de roupas em
// Sorocaba, R$ 20 por dia"), but it still has to name a place, budget or media.
export function isCampaignBriefDetails(text){
 const t=sharedText(text);
 if(!t)return false;
 return MONEY.test(t)||cityCue(text);
}

export function wantsCampaignOrder(text){
 return isCampaignCreationRequest(text)||isCampaignBriefDetails(text);
}
