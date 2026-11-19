// Guided training interview. Per-tenant durable state; a completed interview
// produces a REVIEW-ONLY Markdown manual. No WhatsApp send, no auto-reply
// activation, no payment, no ad change and no cross-tenant lookup.
//
// Twelve blocks, one question each. Every question offers ready-made options
// so the owner can answer by tapping, with a short field only for what is
// specific to the business (service names, prices, times, objections). The
// answers become a manual with numbered rules the AI follows literally.

import {randomUUID} from 'node:crypto';

const err=(status,message)=>Object.assign(new Error(message),{status});
const clean=(v,max=850)=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=v=>clean(v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const asList=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x):[];

export const STEPS=['company','services','process','style','objections','proof','handoff','restrictions','closing','payment','region','approach'];

const TONE_OPTIONS=[
 {id:'friendly',label:'Próxima e leve',description:'Trata com carinho e informalidade, sem perder o profissionalismo.'},
 {id:'professional',label:'Profissional e direta',description:'Objetiva, sem rodeios, foco em resolver.'},
 {id:'formal',label:'Formal',description:'Tratamento você/senhor(a), linguagem mais cuidada.'},
 {id:'enthusiastic',label:'Entusiasmada',description:'Empolgada com o trabalho, boa para serviços criativos.'}
];

const OBJECTION_OPTIONS=[
 {id:'send_proposal',label:'Enviar link/caso de sucesso e propor conversa',description:'Mostra prova social e chama para a conversa.'},
 {id:'explain_value',label:'Explicar o que está incluso no valor',description:'Mostra o que o cliente ganha antes do preço.'},
 {id:'offer_meeting',label:'Chamar para uma conversa rápida',description:'Prefere entender a necessidade antes de falar em valor.'},
 {id:'call_human',label:'Chamar o responsável na hora',description:'Não discute preço sozinho.'}
];

const HANDOFF_OPTIONS=[
 {id:'price',label:'Pede orçamento ou valor fechado'},
 {id:'complaint',label:'Faz reclamação ou demonstra insatisfação'},
 {id:'discount',label:'Pede desconto'},
 {id:'payment',label:'Quer pagar ou negociar pagamento'},
 {id:'other_offer',label:'Quer algo que não está no catálogo'},
 {id:'calendar',label:'Quer agendar ou marcar horário'}
];

const CLOSING_OPTIONS=[
 {id:'human',label:'Você assume a conversa com um aviso',description:'A IA avisa e entrega para você responder.'},
 {id:'proposal',label:'A IA prepara uma proposta para sua aprovação',description:'Nada é enviado ao cliente sem você aprovar.'},
 {id:'schedule',label:'A IA passa o link de agendamento',description:'Só use se você tiver um link público de agenda.'}
];

const PAYMENT_OPTIONS=[
 {id:'pix',label:'PIX'},
 {id:'card',label:'Cartão (crédito/débito)'},
 {id:'transfer',label:'Transferência'},
 {id:'boleto',label:'Boleto'},
 {id:'cash',label:'Dinheiro'}
];

const APPROACHES=[
 {id:'permission',label:'Pedir permissão',description:'Cumprimenta e pergunta como pode ajudar.',template:'Olá, {{nome}}! Sou o assistente da {{empresa}}. Posso te ajudar?'},
 {id:'direct',label:'Direta e objetiva',description:'Diz o que a empresa faz sem rodeio.',template:'Olá, {{nome}}! Na {{empresa}}, oferecemos {{servico}}. Como posso ajudar?'},
 {id:'consultative',label:'Consultiva',description:'Entende a necessidade antes de tudo.',template:'Olá, {{nome}}! Sou o assistente da {{empresa}}. Me conta o que você precisa para eu te orientar.'},
 {id:'friendly',label:'Leve e próxima',description:'Resposta humana e simpática.',template:'Oi, {{nome}}! Tudo bem? Você está falando com a {{empresa}}. Como podemos ajudar hoje?'},
 {id:'custom',label:'Personalizada',description:'Você escreve o primeiro contato.'}
];

const REGION_OPTIONS=[
 {id:'local',label:'Só presencialmente na nossa cidade'},
 {id:'local_plus_online',label:'Presencial aqui e também online'},
 {id:'national',label:'Atendemos todo o Brasil online'}
];

const serviceKind=name=>{
 const n=normalized(name);
 if(/trafego|anuncio|google ads|meta ads|midia paga/.test(n))return 'traffic';
 if(/site|web|loja virtual|landing/.test(n))return 'web';
 if(/design|logo|social media|identidade|criativo/.test(n))return 'design';
 return 'general';
};

const optionsFor=step=>{
 // Legacy step names still answer with their full option list.
 if(step==='style')return TONE_OPTIONS;
 if(step==='objections')return OBJECTION_OPTIONS;
 if(step==='handoff')return HANDOFF_OPTIONS;
 if(step==='closing')return CLOSING_OPTIONS;
 if(step==='payment')return PAYMENT_OPTIONS;
 if(step==='region')return REGION_OPTIONS;
 if(step==='approach')return APPROACHES.map(({id,label,description})=>({id,label,description}));
 return [];
};

const prompts={
 company:{question:'Como sua empresa se chama e o que ela vende em uma frase?',
  hint:'Ex.: "Consecom — agência de marketing e sites para empresas locais".',example:'Aquarela Studio — estúdio de design e sites'},
 services:{question:'Quais serviços ou produtos você oferece? Lista curta, um por linha ou separados por vírgula.',
  hint:'Depois eu pergunto preço e prazo de cada um.',example:'Site institucional, landing page, gestão de anúncios'},
 process:{question:'Como o cliente contrata? Escolha o que mais se parece com o seu dia a dia.',
  hint:'Isso define o que eu falo quando alguém pergunta "como funciona?".',
  options:[
   {id:'budget_first',label:'Pede orçamento e a gente responde',description:'Cliente descreve o que precisa e recebe um valor.'},
   {id:'meeting_first',label:'Conversamos antes (reunião ou ligação)',description:'A conversa serve para entender o caso.'},
   {id:'direct_buy',label:'Compra direto pelo catálogo/loja',description:'Escolhe o item e finaliza.'},
   {id:'booking',label:'Agenda um horário',description:'Serve para serviços com agenda.'}
  ]},
 style:{question:'Como você quer que eu converse com seus clientes?'},
 objections:{question:'Quando o cliente questiona preço, prazo ou portfólio, o que eu faço?'},
 proof:{question:'Tem algum link ou trabalho que eu possa citar? (site, Instagram, portfólio)',
  hint:'Pode colar mais de um, separados por vírgula. Se preferir, diga "não tenho".'},
 handoff:{question:'Em quais situações eu DEVO parar e chamar você? Marque todas que se aplicam.',
  hint:'Pode marcar mais de uma. Vou sempre avisar antes de sair da conversa.'},
 restrictions:{question:'O que eu NUNCA devo falar ou prometer?',
  hint:'Ex.: não dar desconto, não prometer prazo sem consultar, não falar de concorrentes.',
  example:'Não prometer desconto. Não falar prazo sem consultar. Não falar mal de concorrentes.'},
 closing:{question:'Quando o cliente estiver pronto para fechar, quem conduz?'},
 payment:{question:'Quais formas de pagamento vocês aceitam?'},
 region:{question:'Onde vocês atendem?'},
 approach:{question:'Como eu devo abrir a conversa com quem chega?'}
};

const manualService=(d,index)=>{
 const s=d.services[index];
 const kind=serviceKind(s.name);
 const question={traffic:'em quais plataformas você trabalha e o orçamento de mídia é separado da gestão?',
  web:'quais tipos de site você entrega e qual prazo normalmente informa?',
  design:'quais peças ou entregáveis estão incluídos e qual o prazo?',
  general:'o que inclui, como é entregue e em quanto tempo?'}[kind];
 return {question,price:kind==='traffic'?'Qual o valor de gestão/planejamento mensal ou o ticket mínimo?':'Quanto custa '+s.name+'?',
  placeholder:kind==='traffic'?'Ex.: R$ 800/mês de gestão, mídia à parte':'Ex.: a partir de R$ 350'};
};

const serviceNames=value=>{
 const parts=String(value||'').replace(/\b(e tamb[eé]m|al[eé]m disso)\b/gi,',').split(/[,;\n]|\s+e\s+(?=[a-z])/)
  .map(s=>s.replace(/^(eu )?(trabalho com|ofere[cç]o|fazemos|temos|servi[cç]os de|vendo)\s+/i,'').trim())
  .filter(s=>s.length>=3);
 const unique=[...new Set(parts.map(s=>s.toLowerCase()))].slice(0,8);
 return unique.map(x=>({name:parts.find(s=>s.toLowerCase()===x).slice(0,90),detail:'',price:''}));
};

const normalizedAnswer=(raw)=>{
 const n=normalized(raw);
 if(!n)return '';
 if(/^(nao tenho|none|nada|sem)/.test(n))return 'nenhum';
 return n;
};

const progress=s=>{
 if(s.phase==='review')return 100;
 const count=s.data?.services?.length||1;
 if(s.step==='services')return 10;
 const base=STEPS.indexOf(s.step);
 if(s.step==='process')return base<0?15:Math.min(95,15+base*8);
 if(s.meter){const extra=Math.round(s.meter.done/s.meter.total*70);return Math.min(95,12+extra);}
 return Math.min(95,Math.round((base+1)/STEPS.length*100));
};

export const questionFor=s=>{
 const p=prompts[s.step];
 if(!p)return '';
 if(s.step==='services'&&s.subPhase==='price'){
  const name=s.data.services[s.index]?.name||'esse serviço';
  return 'Qual o valor de '+name+'? '+manualService(s.data,s.index).placeholder+' (Se preferir não informar, diga "orçamento".)';
 }
 if(s.step==='services'&&s.subPhase==='detail'){
  const name=s.data.services[s.index]?.name||'esse serviço';
  return 'Sobre '+name+': '+manualService(s.data,s.index).question;
 }
 return p.question;
};

export const choicesFor=s=>{
 if(s.phase!=='active')return [];
 const declared=prompts[s.step]?.options;
 if(Array.isArray(declared))return declared;
 return optionsFor(s.step);
};

// An interview saved before the twelve-block version carries step names that no
// longer exist ("audience", "service_price"). Rather than leave the owner stuck
// on a blank question, it restarts cleanly; the approved manual is untouched.
const LEGACY_STEPS=new Set(['audience','qualify','notification','closing_mode','payment_methods','service_price']);

const output=s=>s?{
 legacy:LEGACY_STEPS.has(s.step)||undefined,
 mode:s.mode,phase:s.phase,step:s.step,subPhase:s.subPhase||null,
 question:s.phase==='active'?questionFor(s):'',
 hint:s.phase==='active'?(s.step==='services'?(s.subPhase==='price'?'Pode ser uma faixa ("a partir de…") ou "orçamento".':'Descreva em uma frase: o que inclui e em quanto tempo entrega.'):prompts[s.step]?.hint||''):'',
 example:s.phase==='active'?(s.step==='services'?(s.subPhase==='price'?manualService(s.data||{services:[{}]},s.index||0).placeholder:'Ex.: site com até 5 páginas, pronto em 7 dias'):prompts[s.step]?.example||''):'',
 placeholder:s.phase==='active'?(s.step==='services'&&s.subPhase==='price'?'Ex.: R$ 350 ou a partir de R$ 350':''):'',
 stepIndex:s.step==='services'?1:Math.max(0,STEPS.indexOf(s.step)),
 stepLabel:s.step==='services'?(s.subPhase==='price'?'Serviço '+(s.index+1)+' de '+Math.max(1,s.data?.services?.length||1)+' · preço':'Serviço '+(s.index+1)+' de '+Math.max(1,s.data?.services?.length||1)+' · descrição e prazo'):'Passo '+Math.max(1,STEPS.indexOf(s.step)+1)+' de '+STEPS.length,
 choices:choicesFor(s),
 multiple:s.step==='handoff'||s.step==='payment',
 messages:s.messages,progress:progress(s),completed:s.phase==='review',
 draftVersionId:s.draftVersionId||null,
 serviceCount:s.data?.services?.length||0,serviceIndex:(s.index||0)+1
}:null;

const listOr=value=>asList(value).length?asList(value).join(', '):'';
const labeled=(options,ids)=>asList(ids).map(id=>options.find(o=>o.id===id)?.label).filter(Boolean);

export function buildManual(d){
 const services=d.services||[];
 const handoff=[...labeled(HANDOFF_OPTIONS,d.handoff),...(d.handoffNotes||[])];
 const payments=labeled(PAYMENT_OPTIONS,d.payment);
 const closing=CLOSING_OPTIONS.find(o=>o.id===d.closingMode);
 const processLabel=({budget_first:'Pede orçamento e a equipe responde',meeting_first:'Conversa antes da proposta',
  direct_buy:'Compra direto pelo catálogo',booking:'Agendamento de horário'})[d.process]||'Não informado';
 const lines=[
  '# Manual de atendimento do Sócio',
  '',
  '> Rascunho privado para revisão. A IA só usa este manual depois da sua aprovação.',
  '',
  '## 1. Quem é a empresa',
  '- **Empresa:** '+(d.company||'Não informado'),
  '- **Atende em:** '+(d.regionLabel||REGION_OPTIONS.find(o=>o.id===d.region)?.label||'Não informado'),
  '',
  '## 2. Serviços e preços oficiais',
  ...(services.length?services.flatMap((x,i)=>[
   '### '+(i+1)+'. '+x.name,
   '- **O que inclui e prazo:** '+(x.detail||'Confirmar com a equipe'),
   '- **Preço:** '+(x.price||'Sob orçamento — nunca citar valor sem a equipe confirmar'),
   '']):['- Nenhum serviço cadastrado. Sem serviço, a IA só informa o horário e chama um humano.','']),
  '## 3. Como a empresa atende',
  '- **Contratação:** '+processLabel,
  '- **Primeira resposta:** '+(d.approach?.label||'Não definida'),
  '- **Texto sugerido:** '+(d.approach?.template||'Não definido'),
  '- **Variáveis permitidas:** {{nome}}, {{empresa}}, {{servico}} com dados confirmados.',
  '',
  '## 4. Tom de voz',
  '- **Estilo:** '+(TONE_OPTIONS.find(o=>o.id===d.style)?.label||'Profissional e direta'),
  '- **Como responder:** '+(TONE_OPTIONS.find(o=>o.id===d.style)?.description||''),
  '',
  '## 5. Objeções',
  ...(asList(d.objections).length?asList(d.objections).map(id=>{
   const o=OBJECTION_OPTIONS.find(x=>x.id===id);
   return '- Se o cliente questionar preço/prazo: **'+(o?.label||id)+'**. '+(o?.description||'');
  }):['- Não definido. A IA não discute preço; chama o responsável.']),
  '',
  '## 6. Provas que a IA pode citar',
  '- '+(d.proof&&normalizedAnswer(d.proof)!=='nenhum'?d.proof:'Nenhuma. Não citar clientes, números ou resultados.'),
  '',
  '## 7. Quando a IA para e chama um humano',
  ...(handoff.length?handoff.map(x=>'- '+x):['- Sempre que não tiver certeza.']),
  '- A IA avisa: "Vou chamar a equipe para te ajudar com isso." e encerra a resposta.',
  '',
  '## 8. O que a IA nunca faz',
  ...(d.restrictions?d.restrictions.split(/[.;]\s*/).filter(Boolean).slice(0,8).map(x=>'- '+x):
   ['- Não inventar preço, prazo, garantia ou resultado.']),
  '- Não inventar preço, prazo, desconto, garantia ou resultado.',
  '- Não falar mal de concorrentes.',
  '- Não pedir senha, cartão, documento ou dados financeiros.',
  '',
  '## 9. Fechamento',
  '- **Quem conduz:** '+(closing?.label||'Transferir ao responsável'),
  ...(d.closingMode==='proposal'?['- A IA organiza o pedido e a proposta fica aguardando sua aprovação. Nada é enviado ao cliente antes disso.']:[]),
  ...(d.closingMode==='schedule'&&d.scheduleLink?['- Link de agenda autorizado: '+d.scheduleLink]:[]),
  '',
  '## 10. Pagamento',
  '- **Formas aceitas:** '+(payments.length?payments.join(', '):'Confirmar com a equipe'),
  '- Nunca informar chave PIX, dados bancários ou link de cobrança por conta própria.',
  '',
  '## 11. Quando a resposta não está no manual',
  '- Dizer com naturalidade: "Vou confirmar isso com a equipe e já te retorno."',
  '- Registrar a dúvida na conversa para o responsável responder.',
  '- Nunca improvisar um número, prazo ou condição.',
  '',
  '## 12. Segurança',
  '- Este manual não autoriza envio de mensagens, cobranças ou mudanças em anúncios.',
  '- A IA só responde conversas entregues explicitamente a ela.',
  '- Respeitar pedido de atendente humano e nunca acessar dados de outra empresa.'
 ];
 const text=lines.join('\n');
 if(text.length>18000)throw err(422,'Manual muito longo para revisão.');
 return text;
}

const pickIds=(raw,options)=>{
 const ids=new Set();
 for(const item of raw.split(/[,;]\s*/)){const n=normalized(item);if(!n)continue;
  const hit=options.find(o=>o.id===n||normalized(o.label)===n)||(/^\d+$/.test(n)?options[Number(n)-1]:null);
  if(hit)ids.add(hit.id);
 }
 return [...ids];
};

const storeAnswer=(s,raw,v)=>{
 const d=s.data;
 if(s.step==='company'){d.company=clean(v,120)||clean(raw,120);
  // Reach the first service quickly: the price list is what makes the manual useful.
  s.step='services';s.subPhase='list';s.index=0;return;}
 if(s.step==='services'){
  if(s.subPhase==='list'){
   const list=serviceNames(raw||v);
   if(!list.length)throw err(422,'Informe pelo menos um serviço.');
   d.services=list;s.subPhase='detail';s.index=0;s.meter={done:0,total:list.length*2};return;
  }
  const item=d.services[s.index];
  if(!item)throw err(422,'Serviço não encontrado. Recomece a entrevista.');
  if(s.subPhase==='detail'){item.detail=clean(v,350);s.subPhase='price';s.meter.done++;return;}
  item.price=clean(v,180)||'Sob orçamento';s.meter.done++;
  if(s.index+1<d.services.length){s.index++;s.subPhase='detail';return;}
  s.step='process';s.subPhase=null;s.index=0;return;
 }
 if(['process','closing','region','approach'].includes(s.step)){
  const options=choicesFor(s);
  const ids=pickIds(raw,options);
  if(!ids.length)throw err(422,'Escolha uma das opções apresentadas.');
  if(s.step==='approach'&&ids[0]==='custom'){s.data.approachMode='custom';s.step='approach_custom';return;}
  if(s.step==='approach'){const opt=APPROACHES.find(o=>o.id===ids[0]);d.approach={mode:opt.id,label:opt.label,template:opt.template};}
  else if(s.step==='region')d.region=ids[0];
  else if(s.step==='closing')d.closingMode=ids[0];
  else d[s.step]=ids[0];
  const nextStep={process:'style',closing:'payment',region:'approach',approach:'done'}[s.step];
  if(s.step==='closing'&&d.closingMode==='schedule'&&v.includes('http'))d.scheduleLink=clean(v,300);
  s.step=nextStep;return;
 }
 if(s.step==='style'||s.step==='objections'||s.step==='handoff'||s.step==='payment'){
  const options=choicesFor(s);
  const ids=pickIds(raw,options);
  if(!ids.length){
   // A free description still counts when the owner explains in words; it is
   // stored literally so the manual reproduces the owner's own rule.
   if(s.step==='style')throw err(422,'Escolha um dos estilos de conversa.');
   if(s.step==='objections')d.objectionsNote=clean(v,300);
   else if(s.step==='handoff')d.handoffNote=clean(v,300);
   else throw err(422,'Informe ao menos uma forma de pagamento.');
  }
  if(ids.length){if(s.step==='style')d.style=ids[0];else d[s.step]=ids;}
  const nextStep={style:'objections',objections:'proof',handoff:'restrictions',payment:'region'}[s.step];
  s.step=nextStep;return;
 }
 if(s.step==='proof'){d.proof=clean(v,400)||'nenhum';s.step='handoff';return;}
 if(s.step==='restrictions'){d.restrictions=clean(v,400);s.step='closing';return;}
 if(s.step==='approach_custom'){
  if(v.length<12||v.length>420)throw err(422,'Escreva de 12 a 420 caracteres.');
  d.approach={mode:'custom',label:'Personalizada',template:v};s.step='done';return;
 }
 throw err(409,'Passo de treinamento desconhecido.');
};

export function nextState(s,r){
 const raw=clean(r,850);
 if(raw.length<1)throw err(422,'Responda à pergunta para continuar.');
 if((s.messages||[]).length>160)throw err(429,'Limite de respostas atingido. Reinicie a entrevista.');
 s.messages=s.messages||[];s.data=s.data||{services:[]};
 storeAnswer(s,raw,raw);
 if(s.step==='done'){
  s.step='review';s.phase='review';
  s.data.regionLabel=REGION_OPTIONS.find(o=>o.id===s.data.region)?.label||'';
  s.data.handoffNote=null;
  s.messages.push({role:'user',body:raw});
  s.messages.push({role:'assistant',body:'Manual pronto! Revise com calma e clique em Aprovar quando estiver do seu jeito.'});
  return s;
 }
 s.messages.push({role:'user',body:raw});
 s.messages.push({role:'assistant',body:questionFor(s)});
 return s;
}

const readRow=async(c,tenant,lock=false)=>{
 const q=await c.query('SELECT state FROM socio_training_interviews WHERE tenant_id=$1'+(lock?' FOR UPDATE':''),[tenant]);
 return q.rows?.[0]?.state||null;
};

export async function getSocioInterview(pool,tenant){return output(await readRow(pool,tenant));}

export async function startSocioInterview(pool,tenant,mode){
 if(!['voice','text'].includes(mode))throw err(422,'Escolha voz ou chat.');
 const s={mode,step:'company',subPhase:null,index:0,phase:'active',data:{services:[]},messages:[],draftVersionId:null};
 s.messages.push({role:'assistant',body:questionFor(s)});
 await pool.query('INSERT INTO socio_training_interviews(tenant_id,state) VALUES($1,$2::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET state=$2::jsonb,updated_at=now()',[tenant,JSON.stringify(s)]);
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
  const s=nextState(current,text);
  if(s.phase==='review'){
   await c.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant]);
   const jobId=randomUUID(),versionId=randomUUID();
   const v=await c.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM training_versions WHERE tenant_id=$1',[tenant]);
   const version=Number(v.rows[0].next);
   const doc=buildManual(s.data);
   await c.query("INSERT INTO training_jobs(id,tenant_id,status,report_json) VALUES($1,$2,'completed',$3::jsonb)",[jobId,tenant,JSON.stringify({source:'guided_interview',summary:'Entrevista guiada, ainda não aprovada.'})]);
   await c.query("INSERT INTO training_versions(id,tenant_id,job_id,version,status,knowledge_md,report_json) VALUES($1,$2,$3,$4,'draft',$5,$6::jsonb)",
    [versionId,tenant,jobId,version,doc,JSON.stringify({source:'guided_interview',summary:'Manual gerado com as respostas da entrevista e aguarda revisão.'})]);
   s.draftVersionId=versionId;
  }
  await c.query('UPDATE socio_training_interviews SET state=$2::jsonb,updated_at=now() WHERE tenant_id=$1',[tenant,JSON.stringify(s)]);
  await c.query('COMMIT');return output(s);
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
 finally{c.release();}
}

export async function transcribeSocioTraining(bytes,mime,{env=process.env,request=fetch,prompt=null,maxChars=850}={}){
 const accepted=new Set(['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav']);
 if(!accepted.has(mime)||!Buffer.isBuffer(bytes)||bytes.length<80||bytes.length>3*1024*1024)
  throw err(422,'Áudio inválido ou muito grande (máximo 3 MB).');
 if(!env.GROQ_API_KEY||env.GROQ_API_KEY.length<20)throw err(503,'Transcrição de voz ainda não está configurada.');
 const extensions={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav'};
 const data=new FormData();data.set('model','whisper-large-v3-turbo');data.set('language','pt');
 data.set('response_format','verbose_json');data.set('timestamp_granularities[]','segment');data.set('temperature','0');
 // Both vocabularies are needed: the training answers (services, prices) and the
 // owner's spoken questions about ads, which Thalita answers from the same box.
 data.set('prompt',String(prompt||env.SOCIO_STT_PROMPT||
  'Conversa em português do Brasil sobre atendimento e anúncios: serviço, preço, prazo, orçamento, proposta, desconto, pagamento, agendamento, catálogo, campanha, público, orçamento diário em reais, WhatsApp.').slice(0,600));
 data.set('file',new Blob([bytes],{type:mime}),'treinamento.'+extensions[mime]);
 let r;
 try{r=await request('https://api.groq.com/openai/v1/audio/transcriptions',{
  method:'POST',headers:{Authorization:'Bearer '+env.GROQ_API_KEY},body:data,signal:AbortSignal.timeout(20000)
 });}catch{throw err(503,'Transcrição indisponível. Você pode continuar digitando.');}
 if(!r.ok)throw err(503,'O serviço de transcrição não respondeu.');
 let json;try{json=await r.json();}catch{throw err(503,'Transcrição inválida.');}
 const text=clean(json?.text,Number.isSafeInteger(maxChars)&&maxChars>0?maxChars:850);
 const plain=text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 const shortAnswer=/^(?:r\$\s*)?\d{1,3}(?:[.,]\d{1,2})?$/i.test(text.trim());
 if((text.length<2&&!shortAnswer)||/^(?:e ai\s*){1,10}$/.test(plain)||/^(?:oi\s*){2,8}$/.test(plain))
  throw err(422,'Não identifiquei uma solicitação clara. Pode continuar falando.');
 const segments=Array.isArray(json?.segments)?json.segments.filter(x=>x&&typeof x==='object'):[];
 if(segments.length&&segments.every(x=>{
  const probability=Number(x.no_speech_prob),logprob=Number(x.avg_logprob),ratio=Number(x.compression_ratio);
  return (Number.isFinite(probability)&&probability>=0.7&&Number.isFinite(logprob)&&logprob<=-0.55)||
   (Number.isFinite(ratio)&&ratio>2.4&&Number.isFinite(logprob)&&logprob<-0.5);
 }))throw err(422,'Não detectei fala suficientemente clara. Tente novamente.');
 return {text,model:'whisper-large-v3-turbo',approved:false};
}
