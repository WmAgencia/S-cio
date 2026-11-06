// Deterministic preflight for model-generated answers before an external send.
// This does not authorize messaging. An ambiguous commercial promise must be reviewed by staff.
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const centsOf=value=>{
 const str=String(value).replace(/\./g,'').replace(',','.');
 const n=Number(str);
 return Number.isFinite(n)?Math.round(n*100):null;
};
export function reviewCommercialReply(reply,{products=[]}={}){
 const text=String(reply||'').trim(),lower=normalize(text);
 if(!text)return {approved:false,reason:'EMPTY_REPLY'};
 if(text.length>700)return {approved:false,reason:'TOO_LONG'};
 if(/(?:pagamento (?:ja )?(?:foi )?(?:recebido|compensado|confirmado)|pix (?:pago|confirmado)|comprovante (?:aprovado|validado)|(?:pedido|contrato|reserva|agendamento) (?:ja )?(?:confirmado|feito|assinado)|garant(?:o|imos) (?:vendas|resultado))/.test(lower))
  return {approved:false,reason:'UNVERIFIED_OPERATION'};
 if(/\b(?:sou (?:o|a) (?:dono|proprietari|wesley)|sou humano|sou uma pessoa real)\b/.test(lower))
  return {approved:false,reason:'MISREPRESENTED_IDENTITY'};
 if(/(?:chave pix|envie (?:o )?(?:pix|comprovante)|pague (?:agora|a entrada)|dados do cartao)/.test(lower))
  return {approved:false,reason:'PAYMENT_INSTRUCTIONS'};
 const allowed=new Set((products||[]).filter(x=>x.stock_quantity!==0).map(x=>Number(x.price_cents)));
 for(const match of text.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/g)){
  if(!allowed.has(centsOf(match[1])))return {approved:false,reason:'UNVERIFIED_PRICE'};
 }
 return {approved:true,reason:null};
}
export function conversationHints(message,history=[]){
 const last=normalize(message),joined=normalize(history.slice(-6).map(x=>x.body||x).join(' '));
 if(/\b(?:pare|parar|stop|nao me envie|falar com (?:um )?(?:atendente|humano))\b/.test(last))
  return 'A pessoa pediu interrupção ou atendimento humano: não responda automaticamente.';
 if(/^(sim|isso|isso mesmo|pode|ok|beleza|pode falar|quero saber|aham|uhum)[.!?\s]*$/.test(last))
  return 'Resposta curta de continuidade: retome a pergunta ou explicação anterior, sem reiniciar a apresentação.';
 if(/\b(?:quanto|preco|valor|custa|orcamento|frete|estoque|prazo)\b/.test(last))
  return 'Responda à pergunta específica primeiro, usando apenas dados aprovados; caso contrário, encaminhe ao responsável.';
 if(joined.includes('ola')||joined.includes('bom dia'))return 'O atendimento já começou. Evite repetir saudações ou perguntar dados que já foram informados.';
 return 'Converse com naturalidade, uma pergunta útil de cada vez. Não pressione.';
}
