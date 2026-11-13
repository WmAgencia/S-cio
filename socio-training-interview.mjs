// Interview training parity with Prospector's Francisca flow.
// Per-tenant durable state; completed interviews produce REVIEW-ONLY Markdown.
// No WhatsApp send, auto-reply activation, payment, ad changes or cross-tenant lookup.
import {randomUUID} from 'node:crypto';
const err=(status,message)=>Object.assign(new Error(message),{status});
const clean=(v,max=850)=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const APPROACHES=[
 {id:'permission',label:'Pedir permissão',description:'Cumprimenta e pergunta como pode ajudar.',template:'Olá, {{nome}}! Sou o assistente da {{empresa}}. Posso te ajudar com nossos serviços?'},
 {id:'direct',label:'Direta e objetiva',description:'Explica os serviços sem insistência.',template:'Olá, {{nome}}! Na {{empresa}}, oferecemos {{servico}}. Como podemos ajudar?'},
 {id:'consultative',label:'Consultiva',description:'Entende primeiro a necessidade do cliente.',template:'Olá, {{nome}}! Sou o assistente da {{empresa}}. Me conta o que você precisa para eu te orientar.'},
 {id:'friendly',label:'Leve e próxima',description:'Responde de maneira cordial e humana.',template:'Oi, {{nome}}! Tudo bem? Você está falando com a {{empresa}}. Como podemos ajudar hoje?'},
 {id:'custom',label:'Personalizada',description:'Crie seu próprio texto de saudação.'}
];
const sequence=['company','audience','services','service_detail','service_price','region','process','qualify','style','objections','social_proof','handoff','restrictions','notification','closing_mode','payment_methods','payment_terms','approach','approach_custom'];
const serviceKind=name=>/trafego|anuncio|google ads|meta ads|m[ií]dia paga/.test(normalized(name))?'traffic':/site|web|loja virtual|landing/.test(normalized(name))?'web':/design|logo|social media|identidade|criativo/.test(normalized(name))?'design':'general';
const serviceQuestion=name=>({
 traffic:'Sobre '+name+': em quais plataformas você trabalha e o orçamento de mídia é separado da gestão?',
 web:'Sobre '+name+': quais tipos de site você entrega e qual prazo normalmente informa?',
 design:'Sobre '+name+': quais peças ou entregáveis estão incluídos e qual o prazo?',
 general:'Sobre '+name+': o que inclui, como é entregue e em quanto tempo?'
})[serviceKind(name)];
const question=s=>{
 const d=s.data||{},k=s.step,name=d.services?.[s.index||0]?.name||'esse serviço';
 return ({
 company:'Olá! Vamos preparar meu atendimento para seu negócio. Primeiro: como se chama sua empresa?',
 audience:'Qual é o perfil de cliente que sua empresa atende?',
 services:'Quais produtos ou serviços você oferece? Liste os principais, separados por vírgula.',
 service_detail:serviceQuestion(name),
 service_price:'Quanto custa '+name+'? Pode informar uma faixa ou dizer que depende de orçamento.',
 region:'Em quais cidades ou regiões vocês atendem? Também atendem online?',
 process:'Como funciona a contratação, pedido ou agendamento? Precisa de orçamento ou reunião?',
 qualify:'Quais perguntas devo fazer para entender a necessidade de um novo cliente?',
 style:'Como você quer que eu converse: mais formal ou descontraído? Respostas curtas ou detalhadas?',
 objections:'Como devo responder quando perguntarem sobre desconto, preço, prazos e portfólio?',
 social_proof:'Quais links ou exemplos de trabalhos aprovados posso mencionar? Se não houver, responda "não tenho".',
 handoff:'Quando devo parar e chamar você ou um atendente humano?',
 restrictions:'Quais ofertas, promessas, descontos ou condições nunca devo sugerir sem sua aprovação?',
 notification:'Onde gostaria de receber avisos de oportunidades? Se ainda não souber, diga "depois". Isso não ativa notificações.',
 closing_mode:'Quando um cliente estiver interessado: 1 — avisar e transferir para você; ou 2 — preparar uma proposta supervisionada para aprovação humana?',
 payment_methods:'Quais formas de pagamento aceitam (PIX, cartão, transferência ou boleto)? Não forneça chave PIX nesta conversa.',
 payment_terms:'Qual porcentagem de entrada é solicitada? Digite um número entre 0 e 100.',
 approach:'Como devo dar a primeira resposta a um cliente que entrar em contato? Escolha: 1 permissão, 2 direta, 3 consultiva, 4 leve ou 5 personalizada.',
 approach_custom:'Escreva sua mensagem inicial personalizada (até 420 caracteres). Pode usar {{nome}}, {{empresa}} e {{servico}}.'
 })[k]||'';
};
const serviceNames=value=>{
 const parts=clean(value,700).replace(/\b(e tamb[eé]m|al[eé]m disso)\b/gi,',').split(/[,;]|\s+e\s+/i)
  .map(s=>s.replace(/^(eu )?(trabalho com|ofere[cç]o|fazemos|temos|servi[cç]os de)\s+/i,'').trim()).filter(s=>s.length>=3);
 return [...new Set(parts.map(s=>s.toLowerCase()))].slice(0,8).map((x,i)=>({
  name:parts.find(s=>s.toLowerCase()===x).slice(0,90),detail:'',price:''
 }));
};
const progress=s=>{
 if(s.phase==='review')return 100;
 const count=s.data?.services?.length||1,offset=Math.max(0,sequence.indexOf(s.step));
 if(offset<=2)return Math.round(offset/Math.max(16,count*2+15)*100);
 if(s.step==='service_detail'||s.step==='service_price')return Math.min(98,Math.round((3+s.index*2+(s.step==='service_price'?1:0))/(15+2*count)*100));
 return Math.min(98,Math.round((3+2*count+Math.max(0,offset-5))/(15+2*count)*100));
};
const output=s=>s?{mode:s.mode,phase:s.phase,step:s.step,question:s.phase==='active'?question(s):'',
 choices:s.step==='approach'&&s.phase==='active'?APPROACHES.map(({id,label,description})=>({id,label,description})):[],
 messages:s.messages,progress:progress(s),completed:s.phase==='review',draftVersionId:s.draftVersionId||null}:null;
const markdown=d=>{
 const lines=['# Manual de atendimento — Sócio','','> Rascunho privado para revisão. Nunca utilizar antes da aprovação explícita.','','## Identidade e público',
 '- **Empresa:** '+(d.company||'Não informado'),'- **Público:** '+(d.audience||'Não informado'),'- **Região:** '+(d.region||'Não informado'),'',
 '## Produtos e serviços aprovados',
 ...d.services.flatMap((x,i)=>['### '+(i+1)+'. '+x.name,'- **Descrição e prazos:** '+(x.detail||'Não informado'),'- **Preço informado:** '+(x.price||'Consultar humano para orçamento'),'']),
 '## Processo comercial','- **Contratação:** '+(d.process||'Não informado'),'- **Qualificação:** '+(d.qualify||'Não informado'),
 '- **Estilo:** '+(d.style||'Não informado'),'- **Objeções:** '+(d.objections||'Não informado'),'- **Materiais autorizados:** '+(d.social_proof||'Nenhum indicado'),'',
 '## Primeira resposta para contatos que procuraram a empresa','- **Estilo:** '+(d.approach?.label||'Não definido'),
 '- **Texto sugerido:** '+(d.approach?.template||'Não definido'),
 '- **Variáveis permitidas:** {{nome}}, {{empresa}}, {{servico}} com informações confirmadas.','',
 '## Fechamento supervisionado','- **Modo:** '+(d.closingMode==='prepare'?'Preparar proposta para aprovação':'Transferir ao responsável'),
 '- **Formas de pagamento:** '+(d.paymentMethods||[]).join(', '),
 '- **Entrada:** '+(Number.isInteger(d.depositPercent)?d.depositPercent+'%':'Não definida'),
 '- **Saldo:** '+(Number.isInteger(d.depositPercent)?100-d.depositPercent+'%':'Não definido'),
 '- Nunca informar chave PIX sem a configuração privada e aprovada. Não afirmar pagamento confirmado sem webhook financeiro verificado.','',
 '## Encaminhamento e limites','- **Quando chamar humano:** '+(d.handoff||'Sempre que necessário'),
 '- **Preferência de aviso:** '+(d.notification||'Configurar depois'),
 '- **Restrições:** '+(d.restrictions||'Sem autorização para descontos ou promessas'),'',
 '## Segurança operacional','- Não inventar preços, prazos, produtos, garantias ou resultados.',
 '- Não enviar propostas, mensagens ou avisos automaticamente por causa deste treinamento.',
 '- Só responder automaticamente em conversas entregues explicitamente à IA desta empresa.',
 '- Respeitar solicitações de atendente humano e não acessar dados de outros clientes.',
 '- O conhecimento só entra em uso após aprovação do responsável no Sócio.'];
 const text=lines.join('\n');if(text.length>18000)throw err(422,'Manual muito longo para revisão.');return text;
};
const next=(s,user)=>{
 const d=s.data,k=s.step,i=s.index||0,v=clean(user),n=normalized(v);
 if(v.length<2&&!(['approach','closing_mode','payment_methods'].includes(k)&&/^[1-5]$/.test(v)))throw err(422,'Responda à pergunta para continuar.');
 if(s.messages.length>100)throw err(429,'Limite de respostas atingido. Reinicie a entrevista.');
 if(k==='services'){d.services=serviceNames(v);if(!d.services.length)throw err(422,'Informe pelo menos um serviço.');s.step='service_detail';s.index=0;}
 else if(k==='company'){d.company=v.slice(0,120);s.step='audience';}
 else if(k==='audience'){d.audience=v.slice(0,300);s.step='services';}
 else if(k==='service_detail'){d.services[i].detail=v.slice(0,350);s.step='service_price';}
 else if(k==='service_price'){d.services[i].price=v.slice(0,180);s.step=i+1<d.services.length?'service_detail':'region';if(s.step==='service_detail')s.index=i+1;}
 else if(k==='closing_mode'){
  if(/^(1|um|transferir|avisar|handoff)/.test(n))d.closingMode='handoff';
  else if(/^(2|dois|preparar|proposta)/.test(n))d.closingMode='prepare';
  else throw err(422,'Escolha 1 para transferir ou 2 para preparar proposta.');
  s.step=d.closingMode==='prepare'?'payment_methods':'approach';
 }else if(k==='payment_methods'){
  d.paymentMethods=[...new Set([/pix/.test(n)?'pix':null,/cart[aã]o|credito|debito/.test(n)?'cartão':null,/transferencia|ted/.test(n)?'transferência':null,/boleto/.test(n)?'boleto':null].filter(Boolean))];
  if(!d.paymentMethods.length)throw err(422,'Informe PIX, cartão, transferência ou boleto.');
  s.step='payment_terms';
 }else if(k==='payment_terms'){
  const percent=/^(cinquenta|metade|meio a meio)$/.test(n)?50:Number(v.replace('%','').trim());
  if(!Number.isInteger(percent)||percent<0||percent>100)throw err(422,'Informe um percentual de entrada de 0 a 100.');
  d.depositPercent=percent;s.step='approach';
 }else if(k==='approach'){
  const opt=APPROACHES.find(o=>o.id===n||normalized(o.label)===n)||
   (/^[1-5]$/.test(n)?APPROACHES[Number(n)-1]:null);
  if(!opt)throw err(422,'Escolha uma opção de 1 a 5.');
  d.approachMode=opt.id;
  if(opt.id==='custom')s.step='approach_custom';
  else {d.approach={mode:opt.id,label:opt.label,template:opt.template};s.step='done';}
 }else if(k==='approach_custom'){
  if(v.length<12||v.length>420)throw err(422,'Escreva de 12 a 420 caracteres para a primeira resposta.');
  d.approach={mode:'custom',label:'Personalizada',template:v};s.step='done';
 }else{
  d[k]=v.slice(0,400);
  const nextMap={region:'process',process:'qualify',qualify:'style',style:'objections',objections:'social_proof',
   social_proof:'handoff',handoff:'restrictions',restrictions:'notification',notification:'closing_mode'};
  s.step=nextMap[k]||'done';
 }
 s.messages.push({role:'user',body:v});
 if(s.step==='done'){s.phase='review';s.messages.push({role:'assistant',body:'Preparei seu manual. Revise o Markdown e clique em Aprovar para que a IA use este treinamento.'});}
 else s.messages.push({role:'assistant',body:question(s)});
 return s;
};
const readRow=async(c,tenant,lock=false)=>{
 const q=await c.query('SELECT state FROM socio_training_interviews WHERE tenant_id=$1'+(lock?' FOR UPDATE':''),[tenant]);
 return q.rows?.[0]?.state||null;
};
export async function getSocioInterview(pool,tenant){return output(await readRow(pool,tenant));}
export async function startSocioInterview(pool,tenant,mode){
 if(!['voice','text'].includes(mode))throw err(422,'Escolha voz ou chat.');
 const s={mode,step:'company',index:0,phase:'active',data:{services:[]},messages:[],draftVersionId:null};
 s.messages.push({role:'assistant',body:question(s)});
 await pool.query('INSERT INTO socio_training_interviews(tenant_id,state) VALUES($1,$2::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET state=$2::jsonb,updated_at=now()', [tenant,JSON.stringify(s)]);
 return output(s);
}
export async function resetSocioInterview(pool,tenant){
 await pool.query('DELETE FROM socio_training_interviews WHERE tenant_id=$1',[tenant]);
 return {interview:null,knowledgePreserved:true};
}
export async function advanceSocioInterview(pool,tenant,text){
 if(typeof text!=='string'||text.length>850)throw err(422,'Resposta de até 850 caracteres.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const current=await readRow(c,tenant,true);
  if(!current||current.phase!=='active')throw err(409,'Inicie uma nova entrevista.');
  const s=next(current,text);
  if(s.phase==='review'){
   await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant]);
   const jobId=randomUUID(),versionId=randomUUID();
   const v=await c.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM training_versions WHERE tenant_id=$1',[tenant]);
   const version=Number(v.rows[0].next);
   const doc=markdown(s.data);
   await c.query("INSERT INTO training_jobs(id,tenant_id,status,report_json) VALUES($1,$2,'completed',$3::jsonb)",[jobId,tenant,JSON.stringify({source:'prospector_interview',summary:'Entrevista guiada, ainda não aprovada.'})]);
   await c.query("INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md,report_json) VALUES($1,$2,$3,$4,'draft',$5,$6::jsonb)",
    [versionId,tenant,jobId,version,doc,JSON.stringify({source:'prospector_interview',summary:'Manual gerado com respostas da entrevista e aguarda revisão.'})]);
   s.draftVersionId=versionId;
  }
  await c.query('UPDATE socio_training_interviews SET state=$2::jsonb,updated_at=now() WHERE tenant_id=$1',[tenant,JSON.stringify(s)]);
  await c.query('COMMIT');return output(s);
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
 finally{c.release();}
}
export async function transcribeSocioTraining(bytes,mime,{env=process.env,request=fetch}={}){
 const accepted=new Set(['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']);
 if(!accepted.has(mime)||!Buffer.isBuffer(bytes)||bytes.length<80||bytes.length>3*1024*1024)
  throw err(422,'Áudio inválido ou muito grande (máximo 3 MB).');
 if(!env.GROQ_API_KEY||env.GROQ_API_KEY.length<20)throw err(503,'Transcrição de voz ainda não está configurada.');
 const extensions={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav'};
 const data=new FormData();data.set('model','whisper-large-v3-turbo');data.set('language','pt');
 data.set('response_format','verbose_json');data.set('timestamp_granularities[]','segment');data.set('temperature','0');
 // Domain vocabulary keeps short, accent-heavy answers from drifting into
 // unrelated words ("anúncio" heard as "anuncio", "seis reais" as "seis reis").
 data.set('prompt',String(env.SOCIO_STT_PROMPT||
  'Conversa em português do Brasil sobre anúncios: campanha, conjunto de anúncios, público, cidade, orçamento diário em reais, WhatsApp, Página do Facebook, vídeo, foto, criar, pausar, ativar.').slice(0,600));
 data.set('file',new Blob([bytes],{type:mime}),'treinamento.'+extensions[mime]);
 let r;
 try{r=await request('https://api.groq.com/openai/v1/audio/transcriptions',{
  method:'POST',headers:{Authorization:'Bearer '+env.GROQ_API_KEY},body:data,signal:AbortSignal.timeout(20000)
 });}catch{throw err(503,'Transcrição indisponível. Você pode continuar digitando.');}
 if(!r.ok)throw err(503,'O serviço de transcrição não respondeu.');
 let json;try{json=await r.json();}catch{throw err(503,'Transcrição inválida.');}
 const text=clean(json?.text,850);
 const plain=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 // A one-word numeric answer ("6" to the daily-budget question) is a complete
 // reply, not noise.
 const shortAnswer=/^(?:r\$\s*)?\d{1,3}(?:[.,]\d{1,2})?$/i.test(text.trim());
 if((text.length<2&&!shortAnswer)||/^(?:e ai\s*){1,10}$/.test(plain)||/^(?:oi\s*){2,8}$/.test(plain))
  throw err(422,'Não identifiquei uma solicitação clara. Pode continuar falando.');
 const segments=Array.isArray(json?.segments)?json.segments.filter(x=>x&&typeof x==='object'):[];
 // Whisper verbose_json exposes segment confidence. Silence/low-confidence
 // segments are not allowed to create phantom messages or request tools.
 if(segments.length&&segments.every(x=>{
  const probability=Number(x.no_speech_prob),logprob=Number(x.avg_logprob),ratio=Number(x.compression_ratio);
  return (Number.isFinite(probability)&&probability>=0.7&&Number.isFinite(logprob)&&logprob<=-0.55)||
   (Number.isFinite(ratio)&&ratio>2.4&&Number.isFinite(logprob)&&logprob<-0.5);
 }))throw err(422,'Não detectei fala suficientemente clara. Tente novamente.');
 return {text,model:'whisper-large-v3-turbo',approved:false};
}
