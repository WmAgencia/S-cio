// Etapa 6: supervised, tenant-scoped sales assistant. No model guesses,
// outbound sends, payments, order creation or automatic quote issuance.
import {requirePermission} from './team-permissions.mjs';
import {assertApiFeature} from './tenant-features.mjs';
import {proposedQuantity} from './sales-intents.mjs';
import {getTenantBusinessMonitor,formatBusinessMonitor} from './socio-business-monitor.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
const money=x=>'R$ '+(Number(x)/100).toFixed(2).replace('.',',');
const safe=x=>String(x||'').replace(/[\r\n\t]/g,' ').slice(0,130);
function authorize(actor){
 requirePermission(actor,'sales.read');
 assertApiFeature(actor.features,'/api/sales');
 assertApiFeature(actor.features,'/api/products');
 assertApiFeature(actor.features,'/api/agent');
 if(actor.tenant_status==='paused')throw fail(403,'Empresa pausada.');
}
function productText(p){
 const variants=p.variants||[];
 if(variants.length)return safe(p.name)+' — possui '+variants.length+' variação(ões); selecionar antes de cotar.';
 const stock=p.stock_quantity===null?'estoque não informado':Number(p.stock_quantity)===0?'sem estoque':'estoque cadastrado: '+p.stock_quantity;
 return safe(p.name)+' — '+money(p.price_cents)+' (preço cadastrado; '+stock+').';
}
export function suggestQuoteForRequest(request,products){
 if(!request||!Array.isArray(products))throw fail(422,'Solicitação ou catálogo inválido.');
 if(request.status==='resolved'||request.delivery_status!=='not_sent'||String(request.draft_text||'').trim()){
  return {readyToReview:false,amountCents:null,text:null,
   reason:'Este pedido já tem um rascunho, foi resolvido ou teve tentativa de envio; confira o histórico antes de substituir.'};
 }
 const search=norm(request.summary);
 const matched=products.filter(p=>p.active===true&&norm(p.name).length>=4&&search.includes(norm(p.name)));
 if(matched.length!==1)return {readyToReview:false,amountCents:null,text:null,
  reason:matched.length?'Mais de um produto cadastrado foi mencionado; confirme os itens com o cliente.':
   'Nenhum produto do catálogo foi identificado com segurança. Confirme o item com o cliente.'};
 const p=matched[0];
 const quantity=proposedQuantity(request.summary);
 if(!quantity)return {readyToReview:false,amountCents:null,text:null,productId:p.id,
  reason:'O cliente não informou uma quantidade inequívoca; confirme a quantidade antes de calcular.'};
 if(p.variants?.length)return {readyToReview:false,amountCents:null,text:null,productId:p.id,
  reason:'Produto com variações; confirme tamanho, cor ou modelo antes de precificar.'};
 if(!Number.isSafeInteger(Number(p.price_cents))||Number(p.price_cents)<=0)
  return {readyToReview:false,amountCents:null,text:null,productId:p.id,
   reason:'Preço não definido para este produto. Peça revisão do cadastro.'};
 if(p.stock_quantity===null||Number(p.stock_quantity)<quantity)
  return {readyToReview:false,amountCents:null,text:null,productId:p.id,
   reason:p.stock_quantity===null?'Estoque não informado; confirme disponibilidade antes de cotar.':
    'Estoque insuficiente para a quantidade solicitada.'};
 const amountCents=Number(p.price_cents)*quantity;
 if(!Number.isSafeInteger(amountCents)||amountCents>=100000000)
  return {readyToReview:false,amountCents:null,text:null,reason:'Total fora do limite permitido.'};
 const text=quantity+' × '+safe(p.name)+' — '+money(amountCents)+
  '. Valores baseados no catálogo vigente. Frete, prazo, descontos e condições dependem de confirmação da equipe.';
 return {readyToReview:true,amountCents,text,productId:p.id,quantity,
  reason:'Prévia calculada com preço e estoque cadastrados. Exige revisão humana antes de salvar ou enviar.'};
}
async function readCatalog(pool,tenant){
 const [products,variants]=await Promise.all([
  pool.query('SELECT id,name,description,price_cents,stock_quantity,active FROM products WHERE tenant_id=$1 AND active=true ORDER BY name,id LIMIT 500',[tenant]),
  pool.query('SELECT v.id,v.product_id,v.name,v.price_cents,v.stock_quantity FROM product_variants v JOIN products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id WHERE v.tenant_id=$1 AND p.active=true ORDER BY v.product_id,v.name LIMIT 12500',[tenant])
 ]);
 const vByProduct=new Map();
 for(const v of variants.rows){const a=vByProduct.get(v.product_id)||[];a.push(v);vByProduct.set(v.product_id,a);}
 return products.rows.map(p=>({...p,variants:vByProduct.get(p.id)||[]}));
}
export async function askSalesAssistant(pool,actor,{message,requestId=null}={}){
 authorize(actor);
 if(typeof message!=='string'||message.length>1000||!message.trim())
  throw fail(422,'Descreva sua dúvida comercial em até 1.000 caracteres.');
 if(requestId!==null&&!uuid.test(requestId))throw fail(422,'Identificador de orçamento inválido.');
 const normalizedQuery=norm(message);
 const wantsReport=/\b(relatorio|relatorios|resumo|indicadores|monitoramento|desempenho)\b/.test(normalizedQuery)&&
  /\b(vendas|negocio|empresa|comercial|clientes|pedidos|atendimento|operacao)\b/.test(normalizedQuery);
 if(wantsReport&&!requestId){
  const monitoring=await getTenantBusinessMonitor(pool,actor);
  return {status:'completed',readOnly:true,executed:false,skillId:'commerce.assistant',
   data:monitoring,message:formatBusinessMonitor(monitoring),
   limits:'Relatório só de leitura. Não alterei cobranças, mensagens nem campanhas.'};
 }

 const tenant=actor.active_tenant_id;
 const [catalog,requests,intents,training]=await Promise.all([
  readCatalog(pool,tenant),
  requestId?
   pool.query("SELECT id,conversation_id,customer_name,summary,status,delivery_status,draft_text,created_at FROM quote_requests WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','preparing') LIMIT 1",[tenant,requestId]):
   pool.query("SELECT id,conversation_id,customer_name,summary,status,delivery_status,draft_text,created_at FROM quote_requests WHERE tenant_id=$1 AND status IN ('pending','preparing') ORDER BY created_at DESC LIMIT 30",[tenant]),
  pool.query("SELECT id,conversation_id,customer_name,summary,status,amount_cents,created_at FROM sale_intents WHERE tenant_id=$1 AND status IN ('pending','contacted') ORDER BY created_at DESC LIMIT 30",[tenant]),
  pool.query("SELECT EXISTS(SELECT 1 FROM training_versions WHERE tenant_id=$1 AND status='approved') AS approved",[tenant])
 ]);
 const approvedTraining=training.rows[0]?.approved===true;
 const trimMessage=norm(message),quotes=requests.rows||[],sales=intents.rows||[];
 const base={status:'completed',readOnly:true,executed:false,skillId:'commerce.assistant',
  catalogCount:catalog.length,pendingQuoteRequests:quotes.length,openPurchaseIntents:sales.length,
  approvedTraining,limits:'Nenhuma mensagem, orçamento ou pagamento foi criado ou enviado.'};
 const normalizedMessage=norm(message);
 const wantsPreview=/\b(prepara|prepare|preparar|preparacao|sugestao|rascunho|monta|montar|cotacao)\b/.test(normalizedMessage)&&
  /\b(orcamento|orcamentos|cotacao|proposta|rascunho)\b/.test(normalizedMessage);
 let chosenId=requestId;
 if(!chosenId&&wantsPreview){
  if(/\b(ultimo|ultima|mais recente)\b/.test(normalizedMessage))chosenId=quotes[0]?.id||null;
  else{
   const matches=quotes.filter(q=>norm(q.customer_name).length>=3&&normalizedMessage.includes(norm(q.customer_name)));
   if(matches.length===1)chosenId=matches[0].id;
  }
 }
 if(chosenId){
  const q=quotes.find(x=>x.id===chosenId);
  if(!q)throw fail(404,'Solicitação pendente não encontrada nesta empresa.');
  const preview=suggestQuoteForRequest(q,catalog);
  return {...base,requestId:q.id,preview,
   message:'Pedido de '+safe(q.customer_name||'cliente')+': '+safe(q.summary)+
    '\n'+(preview.readyToReview?'Sugestão para revisão: '+preview.text+' Total: '+money(preview.amountCents)+'.':
     'Não calculei um valor: '+preview.reason)+
    '\nNenhuma proposta foi salva ou enviada. Confira as informações com o cliente antes de aprovar.'};
 }
 if(wantsPreview){
  return {...base,message:'Informe o nome do cliente ou peça “prepare o orçamento do último pedido”. Se houver produtos ou quantidades incertos, confirmarei antes de calcular. Nenhum orçamento foi salvo ou enviado.'};
 }
 const wantsQuotes=/\b(orcamento|orcamentos|cotacao|cotacoes|proposta|propostas)\b/.test(trimMessage);
 const wantsOpportunities=/\b(lead|leads|interessados?|interessadas?|oportunidade|oportunidades|vendas|pedidos|comprar|clientes)\b/.test(trimMessage);
 const wantsProducts=/\b(produto|produtos|catalogo|estoque|preco|precos|valor|valores|quanto custa)\b/.test(trimMessage);
 if(wantsProducts&&!wantsQuotes&&!wantsOpportunities){
  const specific=catalog.filter(p=>norm(p.name).length>=3&&trimMessage.includes(norm(p.name)));
  const selected=(specific.length?specific:catalog).slice(0,8);
  return {...base,products:selected.map(p=>({id:p.id,name:p.name,priceCents:p.price_cents,
   stockQuantity:p.stock_quantity,variantCount:p.variants.length})),
   message:selected.length?'Produtos do catálogo da sua empresa:\n'+selected.map(productText).join('\n')+
    '\nNão informei frete, disponibilidade futura ou descontos que não constam do catálogo.':
    'Ainda não existem produtos ativos cadastrados nessa empresa. Cadastre ou ative os produtos antes de cotar.'};
 }
 const lines=['Resumo comercial da sua empresa: '+quotes.length+' pedido(s) de orçamento pendente(s), '+
   sales.length+' oportunidade(s) de compra aberta(s) e '+catalog.length+' produto(s) ativo(s).'];
 if(wantsQuotes||!wantsOpportunities||/\b(pedidos|clientes)\b/.test(trimMessage)){
  lines.push(quotes.length?'Solicitações recentes:\n'+quotes.slice(0,5).map(q=>'• '+safe(q.customer_name||'Cliente')+
   ' — '+safe(q.summary)+' (ID '+q.id+')').join('\n'):
   'Nenhuma solicitação de orçamento pendente foi encontrada.');
 }
 if(wantsOpportunities){
  lines.push(sales.length?'Interesses recentes:\n'+sales.slice(0,5).map(s=>'• '+safe(s.customer_name||'Cliente')+
   ' — '+safe(s.summary)+' (ID '+s.id+')').join('\n'):
   'Nenhum interesse de compra aberto foi encontrado.');
 }
 lines.push(approvedTraining?'Existe um treinamento aprovado para a empresa.':
  'Não há versão de treinamento aprovada: revise os exemplos antes de ativar atendimento por IA.');
 lines.push('Para receber uma sugestão de orçamento, escolha o pedido na lista do Sócio. O preço só será calculado quando produto, quantidade, variação e estoque estiverem inequívocos.');
 lines.push('Pedidos e interesses não são vendas pagas. Não enviei nenhuma mensagem nem executei cobrança.');
 return {...base,message:lines.join('\n')};
}
