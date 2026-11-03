
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const state={me:null,view:'overview',dashboard:null,csrf:'',currentConversation:null};
const titles={overview:'Visão geral',inbox:'Conversas',channels:'WhatsApps',products:'Produtos e serviços',training:'Treinamento',agent:'Meu Sócio',team:'Equipe',admin:'Empresas'};
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=cent=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cent||0)/100);
const date=v=>v?new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}):'—';
const val=(form,k)=>String(new FormData(form).get(k)||'').trim();
const errMsg=error=>String(error?.message||'Não foi possível concluir a solicitação.');
const view=$('#view');
let toastTimer;
function toast(message,error=false){
 const el=$('#toast');el.textContent=message;el.className='toast'+(error?' error':'');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),5000);
}
async function api(path,method='GET',body){
 const opts={method,credentials:'same-origin',headers:{'Accept':'application/json'}};
 if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
 if(method!=='GET'&&state.csrf)opts.headers['X-CSRF-Token']=state.csrf;
 const resp=await fetch(path,opts);
 const data=await resp.json().catch(()=>({error:'Erro de conexão.'}));
 if(!resp.ok){if(resp.status===401&&state.me){state.me=null;boot();}throw new Error(data.error||'Falha ao acessar o servidor.');}
 return data;
}
function heading(eyebrow,title,description,action=''){
 return '<div class="view-heading"><div><span class="eyebrow">'+e(eyebrow)+'</span><h1>'+e(title)+'</h1><p>'+e(description)+'</p></div>'+action+'</div>';
}
function empty(icon,title,description,action=''){
 return '<div class="empty"><div class="empty-icon">'+icon+'</div><h3>'+e(title)+'</h3><p>'+e(description)+'</p>'+action+'</div>';
}
function badge(text,color='gray'){return '<span class="badge '+color+'">'+e(text)+'</span>';}
function panel(title,description,body){return '<div class="card"><div class="panel-head"><div><h2>'+e(title)+'</h2>'+ (description?'<p>'+e(description)+'</p>':'')+'</div></div>'+body+'</div>';}
function formValues(form){return Object.fromEntries(new FormData(form).entries());}
function setLoading(){view.innerHTML='<div class="loading">Preparando seu espaço...</div>';}
function setupAuth(initialized){
 $('#authScreen').classList.remove('hidden');$('#appShell').classList.add('hidden');
 $('#loginForm').classList.toggle('hidden',!initialized);
 $('#setupForm').classList.toggle('hidden',initialized);
 $('#authTitle').textContent=initialized?'Entre na sua conta.':'Vamos preparar seu espaço.';
 $('#authDescription').textContent=initialized?'Seu atendimento começa aqui.':'A primeira conta será a administração principal do Sócio.';
 $('#authError').textContent='';
}
async function boot(){
 try{
  const bootstrap=await api('/api/bootstrap');
  try{
   const me=await api('/api/me');
   state.me=me;state.csrf=me.csrf;
   $('#authScreen').classList.add('hidden');$('#appShell').classList.remove('hidden');
   $('#workspaceName').textContent=me.tenant.name;
   $('#workspaceInitial').textContent=(me.tenant.name[0]||'S').toUpperCase();
   $('#userChip').textContent=me.user.name.split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
   $('#adminNav').classList.toggle('hidden',!me.user.platformOwner);
   await changeView(state.view);
  }catch(error){state.me=null;state.csrf='';setupAuth(bootstrap.initialized);}
 }catch(error){setupAuth(true);$('#authError').textContent='Não foi possível conectar ao servidor. '+errMsg(error);}
}
async function changeView(next){
 if(next==='admin'&&!state.me?.user.platformOwner)return;
 state.view=next;
 $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===next));
 $('#topTitle').textContent=titles[next]||'Sócio';
 setLoading();
 try{
  if(next==='overview')await overview();
  if(next==='channels')await channels();
  if(next==='products')await products();
  if(next==='training')await training();
  if(next==='agent')await agent();
  if(next==='inbox')await inbox();
  if(next==='team')await team();
  if(next==='admin')await admin();
 }catch(error){view.innerHTML=empty('!', 'Não foi possível carregar',errMsg(error),'<button class="btn" id="retryView">Tentar novamente</button>');$('#retryView')?.addEventListener('click',()=>changeView(next));}
}
async function overview(){
 const d=await api('/api/dashboard'),ag=await api('/api/agent');
 state.dashboard=d;
 const stepDone=[d.channels>0,d.products>0,d.imports>=10,!!ag.instructions,!!ag.enabled];
 const checklist=[
  ['Cadastre seu primeiro WhatsApp','Configure o número da sua empresa antes de ativar o canal.','channels'],
  ['Monte seu catálogo','Preços oficiais, serviços e informações comerciais.','products'],
  ['Importe 10 a 20 conversas','Use conversas que levaram a boas vendas.','training'],
  ['Personalize seu Sócio','Escolha nome, tom e regras de atendimento.','agent'],
  ['Prepare o agente para ativação','Teste respostas antes de integrar o WhatsApp real.','agent']
 ];
 const metric=(n,label,icon)=>'<div class="card metric"><div class="metric-head"><span class="metric-name">'+e(label)+'</span><span class="metric-icon">'+icon+'</span></div><strong>'+e(n)+'</strong><small>Dados da sua empresa</small></div>';
 view.innerHTML=heading('BOM TER VOCÊ POR AQUI','Seu espaço de trabalho.','Tudo o que seu Sócio precisa para atender cada vez melhor.')+
 '<section class="card welcome-card"><div class="content"><span class="eyebrow">SEU SÓCIO DIGITAL</span><h2>Seu negócio tem muito a dizer.<br>Seu Sócio aprende a dizer como você.</h2><p>Comece pelas conversas que já deram certo. A gente cuida da organização e prepara a inteligência para atender com o jeito da sua empresa.</p><button class="btn primary" data-go="training">Começar treinamento <span>↗</span></button></div><div class="welcome-orb">s<span>.</span></div></section>'+
 '<div class="grid stats section-gap">'+metric(d.openConversations,'Conversas abertas','▤')+metric(d.channels,'WhatsApps cadastrados','◉')+metric(d.products,'Produtos ativos','▦')+metric(d.imports,'Conversas de referência','✳')+'</div>'+
 '<div class="grid cols2 section-gap">'+panel('Primeiros passos','Configure seu espaço de maneira simples.',
 '<div class="step-list">'+checklist.map((s,i)=>'<div class="step"><div class="step-num">'+String(i+1).padStart(2,'0')+'</div><div class="step-text"><strong>'+e(s[0])+'</strong><small>'+e(s[1])+'</small></div><span class="'+(stepDone[i]?'step-done':'step-pending')+'">'+(stepDone[i]?'✓ Feito':'Pendente')+'</span></div>').join('')+'</div>')+
 '<div class="callout"><div class="callout-head"><div class="callout-icon">✦</div><strong>Conhecimento que evolui com seu negócio.</strong></div><p>Você mantém controle sobre preços, produtos e orientações. As conversas importadas ajudam na linguagem, mas nunca substituem informações oficiais ou a supervisão da sua equipe.</p><div class="progress-track"><div class="progress-fill" style="width:'+((stepDone.filter(Boolean).length/stepDone.length)*100)+'%"></div></div><p>'+stepDone.filter(Boolean).length+' de '+stepDone.length+' etapas preparadas</p><button class="btn soft" data-go="agent">Personalizar meu Sócio →</button></div></div>';
 bindNavWithin();
}
function bindNavWithin(){view.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>changeView(b.dataset.go)));}

async function channels(){
 const data=await api('/api/channels');
 const ready=data.filter(x=>x.status==='connected');
 const rows=data.map(c=>'<tr><td><strong>'+e(c.label)+'</strong><div class="table-detail pill-num">'+e(c.phone)+'</div></td>'+
 '<td>'+badge(c.status==='connected'?'Meta validada':'Não conectado',c.status==='connected'?'green':'yellow')+
 '<div class="table-detail">'+(c.auto_reply?'Respostas automáticas ativas':'Respostas automáticas desligadas')+'</div></td>'+
 '<td><div class="actions-inline">'+(c.status==='connected'?'<button class="btn sm '+(c.auto_reply?'danger':'soft')+'" data-auto="'+e(c.id)+'" data-enabled="'+(!c.auto_reply)+'">'+(c.auto_reply?'Desativar IA':'Ativar IA')+'</button>':'')+'</div></td></tr>').join('');
 const extra=state.me.user.platformOwner&&data.length?'<div class="card card-pad section-gap"><div class="section-title">Vincular canal oficial da Meta</div>'+
 '<p class="form-note">Somente a Consecom pode validar um número. O token será criptografado no banco de dados e não poderá ser lido pelos usuários do painel.</p>'+
 '<form id="metaLinkForm" class="form-stack"><label>Canal<select name="id">'+data.map(c=>'<option value="'+e(c.id)+'">'+e(c.label)+' · '+e(c.phone)+'</option>').join('')+'</select></label>'+
 '<label>Phone Number ID da Meta<input name="phoneId" required inputmode="numeric" placeholder="Identificador oficial do número"></label>'+
 '<label>Token de acesso da Meta<input name="accessToken" type="password" required autocomplete="off" placeholder="Token válido com permissão de envio"></label>'+
 '<button class="btn primary" type="submit">Validar e vincular via Meta →</button></form></div>':'';
 view.innerHTML=heading('CANAIS DE ATENDIMENTO','Seus WhatsApps.','Vincule números oficiais e escolha individualmente quando o Sócio pode responder.')+
 '<div class="two-pane"><div>'+panel('Números cadastrados',data.length+' canal(is) no seu espaço.',
 data.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Canal</th><th>Estado</th><th>IA</th></tr></thead><tbody>'+rows+'</tbody></table></div>':empty('◉','Nenhum número ainda','Cadastre o primeiro WhatsApp comercial da empresa.'))+
 extra+'</div><div class="card card-pad"><div class="section-title">Adicionar WhatsApp</div>'+
 '<form id="channelForm" class="form-stack"><label>Nome para identificar<input name="label" required maxlength="90" placeholder="Ex.: Vendas • WhatsApp 1"></label>'+
 '<label>Número com DDD<input name="phone" required placeholder="5515999999999" inputmode="tel"></label>'+
 '<div class="info-strip"><strong>Conexão segura</strong>O cadastro não ativa envios. A Consecom valida os dados diretamente com a Meta antes de habilitar qualquer resposta.</div>'+
 '<button class="btn primary" type="submit">Cadastrar canal →</button></form></div></div>';
 $('#channelForm').addEventListener('submit',async ev=>{ev.preventDefault();const data=formValues(ev.currentTarget);await action(async()=>{await api('/api/channels','POST',data);toast('Canal cadastrado. Aguarda validação Meta.');await channels();});});
 if(state.me.user.platformOwner&&data.length)$('#metaLinkForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const d=formValues(ev.currentTarget);
  await action(async()=>{await api('/api/channels/'+d.id+'/link','POST',{phoneId:d.phoneId,accessToken:d.accessToken});toast('Canal validado pela Meta. IA continua desligada.');await channels();});
 });
 view.querySelectorAll('[data-auto]').forEach(button=>button.addEventListener('click',async()=>{
  const enabled=button.dataset.enabled==='true';
  if(enabled&&!confirm('Ativar respostas automáticas para novas mensagens recebidas neste canal? O sistema poderá enviar respostas reais com custos de uso.'))return;
  await action(async()=>{await api('/api/channels/'+button.dataset.auto+'/auto','POST',{enabled});toast(enabled?'IA ativada neste canal.':'IA desligada neste canal.');await channels();});
 }));
}

async function products(){
 const list=await api('/api/products');
 view.innerHTML=heading('CATÁLOGO','Produtos e serviços.','Informações oficiais que o Sócio utiliza ao conversar com seus clientes.')+
 '<div class="two-pane"><div>'+panel('Catálogo da empresa',list.length+' item(ns) cadastrados.',
 list.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Produto</th><th>Preço</th><th>Ação</th></tr></thead><tbody>'+list.map(p=>'<tr><td><strong>'+e(p.name)+'</strong><div class="table-detail">'+e(p.description||'Sem descrição')+'</div>'+(!p.active?badge('Inativo'):'')+'</td><td><strong>'+e(brl(p.price_cents))+'</strong></td><td><button class="btn sm ghost" data-edit="'+e(p.id)+'">Editar</button></td></tr>').join('')+'</tbody></table></div>':empty('▦','Seu catálogo está vazio','Adicione um produto, preço ou serviço para começar.'))+'</div>'+
 '<div class="card card-pad"><div class="section-title" id="productFormTitle">Novo item</div><form class="form-stack" id="productForm"><input type="hidden" name="id"><label>Nome do produto ou serviço<input name="name" required maxlength="120" placeholder="Ex.: Consultoria personalizada"></label><label>Preço (R$)<input name="price" required type="number" min="0" max="999999" step="0.01" placeholder="129.00"></label><label>Descrição<textarea name="description" maxlength="1200" placeholder="Detalhes, o que inclui, condições..."></textarea></label><label id="activeLabel" class="hidden">Disponibilidade<select name="active"><option value="true">Ativo</option><option value="false">Inativo</option></select></label><div class="form-actions"><button class="btn primary" type="submit">Salvar item →</button><button id="cancelEdit" type="button" class="btn ghost hidden">Cancelar</button></div></form></div></div>';
 const form=$('#productForm');
 view.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>{
  const p=list.find(x=>x.id===b.dataset.edit);if(!p)return;
  form.elements.id.value=p.id;form.elements.name.value=p.name;form.elements.price.value=(p.price_cents/100).toFixed(2);form.elements.description.value=p.description;
  form.elements.active.value=String(p.active);$('#productFormTitle').textContent='Editar item';$('#activeLabel').classList.remove('hidden');$('#cancelEdit').classList.remove('hidden');
  form.scrollIntoView({behavior:'smooth',block:'center'});
 }));
 $('#cancelEdit').addEventListener('click',()=>products());
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();const f=formValues(form),priceCents=Math.round(Number(f.price)*100);
  if(!Number.isSafeInteger(priceCents))return toast('Preço inválido.',true);
  await action(async()=>{
   await api(f.id?'/api/products/'+f.id:'/api/products',f.id?'PATCH':'POST',{name:f.name,description:f.description,priceCents,active:f.active!=='false'});
   toast('Catálogo atualizado.');await products();
  });
 });
}
async function training(){
 const [list,ag]=await Promise.all([api('/api/imports'),api('/api/agent')]);
 view.innerHTML=heading('PERSONALIZAÇÃO','Aprenda com as boas conversas.','Envie 10 a 20 atendimentos que deram certo. O Sócio extrai exemplos de linguagem sem usar os dados para treinar um modelo compartilhado.')+
 '<div class="two-pane train"><div class="card card-pad"><div class="section-title">Importar conversas de sucesso</div><div class="file-drop"><span class="file-icon">⇧</span><strong>Clique para escolher arquivos .txt ou .md</strong><small>Pode selecionar várias conversas de uma vez · até 700 KB por arquivo</small><input type="file" id="importInput" accept=".txt,.md,text/plain,text/markdown" multiple aria-label="Escolher conversas"></div><p class="form-note">No WhatsApp: abra a conversa → Exportar conversa → Sem mídia. Se receber um arquivo ZIP, extraia o .txt antes de importar.</p><div class="info-strip"><strong>Privacidade em primeiro lugar</strong>Utilize conversas que sua empresa está autorizada a tratar. Telefones, e-mails e documentos numéricos são mascarados; nomes de participantes são substituídos por identificadores genéricos.</div><div id="importFeedback" class="form-note"></div></div>'+
 '<div>'+panel('Base de experiência',list.length+' conversa(s) importada(s).',
 '<div class="card-pad"><div class="progress-track"><div class="progress-fill" style="width:'+Math.min(100,list.length*10)+'%"></div></div><p class="form-note">'+Math.min(list.length,10)+' de 10 referências sugeridas para o primeiro treinamento.</p></div>'+
 (list.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Arquivo</th><th>Mensagens</th></tr></thead><tbody>'+list.map(x=>'<tr><td><strong>'+e(x.filename)+'</strong><div class="table-detail">'+date(x.created_at)+'</div></td><td>'+e(x.message_count)+'</td></tr>').join('')+'</tbody></table></div>':empty('✳','Ainda não há exemplos','Suas primeiras conversas de referência aparecerão aqui.')))+
 '<div class="card card-pad section-gap"><div class="section-title">Conhecimento adquirido</div><p class="form-note">O Sócio consulta exemplos anonimizados para aprender seu jeito de conversar. Produtos e preços são configurados separadamente.</p><div class="code-preview">'+e(ag.knowledge_md||'# Aguardando as primeiras conversas de referência...')+'</div></div></div></div>';
 $('#importInput').addEventListener('change',async ev=>{
  const files=Array.from(ev.target.files||[]);
  const feedback=$('#importFeedback');if(!files.length)return;
  if(files.some(f=>!/\.(txt|md)$/i.test(f.name)||f.size>700000))return toast('Selecione apenas .txt/.md até 700 KB.',true);
  let okay=0;const errors=[];
  for(const file of files){
   feedback.textContent='Importando '+e(file.name)+'... ('+(okay+errors.length+1)+'/'+files.length+')';
   try{await api('/api/imports','POST',{filename:file.name,content:await file.text()});okay++;}
   catch(ex){errors.push(file.name+': '+errMsg(ex));}
  }
  toast(okay+' arquivo(s) importado(s).'+(errors.length?' '+errors.length+' falha(s).':'') ,!okay);
  await training();
  if(errors.length)$('#importFeedback').textContent=errors.join(' | ');
 });
}
async function agent(){
 const ag=await api('/api/agent');
 const missing=!state.me.groqConfigured;
 view.innerHTML=heading('A INTELIGÊNCIA DA SUA EMPRESA','Conheça seu Sócio.','Defina como ele fala, o que pode fazer e como deve se comportar.')+
 '<div class="two-pane train"><div class="card card-pad"><div class="section-title">Identidade e comportamento</div><form id="agentForm" class="form-stack"><label>Nome do agente<input name="name" required maxlength="80" value="'+e(ag.name||'Sócio')+'"></label><label>Tom de voz<input name="tone" required maxlength="300" value="'+e(ag.tone||'Profissional e natural')+'"></label><label>Instruções e limites<textarea name="instructions" required maxlength="6000" rows="8">'+e(ag.instructions||'')+'</textarea></label><label>Modo operacional<select name="enabled"><option value="false"'+(!ag.enabled?' selected':'')+'>Em preparação</option><option value="true"'+(ag.enabled?' selected':'')+'>Preparado para integrar (não envia sozinho)</option></select></label><button type="submit" class="btn primary">Salvar personalidade →</button><p class="form-note">Marcar como preparado não conecta um WhatsApp ou libera envios automáticos.</p></form></div>'+
 '<div class="card"><div class="panel-head"><div><h2>Laboratório de conversas</h2><p>Faça perguntas como se fosse um cliente.</p></div>'+badge('Simulação','gray')+'</div><div class="messages-preview" id="simulationMessages"><div class="bubble">Olá! Este é seu laboratório. Configure produtos e treinamento e faça uma pergunta para experimentar a personalidade do seu Sócio.</div></div><form class="chat-compose" id="simulateForm"><input name="message" required maxlength="1200" placeholder="Ex.: Quais serviços vocês oferecem?" autocomplete="off"><button type="submit" class="btn primary">Enviar ↗</button></form>'+(missing?'<div class="info-strip" style="margin:14px">Conecte GROQ_API_KEY nas variáveis do Railway para ativar respostas reais no simulador.</div>':'')+'</div></div>';
 $('#agentForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/agent','PUT',{...d,enabled:d.enabled==='true'});toast('Personalidade atualizada.');await agent();});});
 $('#simulateForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const form=ev.currentTarget,txt=val(form,'message');if(!txt)return;
  const msgs=$('#simulationMessages');msgs.insertAdjacentHTML('beforeend','<div class="bubble agent">'+e(txt)+'</div>');form.reset();msgs.scrollTop=msgs.scrollHeight;
  await action(async()=>{
   const result=await api('/api/simulate','POST',{message:txt});
   msgs.insertAdjacentHTML('beforeend','<div class="bubble">'+e(result.reply||'Não foi possível gerar uma resposta.')+'</div>');msgs.scrollTop=msgs.scrollHeight;
  });
 });
}
async function inbox(){
 const data=await api('/api/inbox');
 view.innerHTML=heading('ATENDIMENTO','Conversas da sua empresa.','Todas as conversas recebidas pelos canais integrados, em um único lugar.')+
 '<div class="card inbox-layout"><div class="thread-list"><div class="thread-head">Caixa de entrada <span class="muted">('+data.length+')</span></div>'+
 (data.length?data.map(c=>'<button class="thread-item" data-thread="'+e(c.id)+'"><div class="avatar">'+e((c.customer_name||c.customer_phone||'?')[0].toUpperCase())+'</div><div class="thread-body"><strong>'+e(c.customer_name||c.customer_phone)+'</strong><small>'+e(c.last_message||'Sem mensagens')+'</small><small>'+e(c.channel_label)+' · '+date(c.last_message_at)+'</small></div></button>').join(''):empty('▤','Nenhuma conversa ainda','As mensagens de clientes aparecerão quando um canal estiver conectado.'))+
 '</div><div class="thread-view" id="threadView">'+empty('✉','Selecione uma conversa','Aqui você poderá ler mensagens, registrar notas e assumir o atendimento.')+'</div></div>';
 view.querySelectorAll('[data-thread]').forEach(b=>b.addEventListener('click',()=>openThread(b.dataset.thread)));
 if(data.length)await openThread(data[0].id);
}

async function openThread(convId){
 const data=await api('/api/conversations/'+convId+'/messages');
 state.currentConversation=convId;
 view.querySelectorAll('[data-thread]').forEach(b=>b.classList.toggle('active',b.dataset.thread===convId));
 const c=data.conversation;
 const pending=(data.jobs||[]).filter(j=>j.status!=='sent').slice(0,12);
 const stateName={awaiting_ai:'IA preparando',generating:'Gerando resposta',ready:'Aguardando envio',sending:'Enviando',failed:'Falha confirmada',unknown:'Entrega não confirmada',cancelled:'Cancelada'};
 const bubbles=data.messages.map(m=>'<div class="bubble '+(m.direction==='outbound'?'agent':m.direction==='note'?'note':'')+'">'+e(m.body)+'<div class="table-detail">'+e(m.direction==='note'?'Nota interna':m.direction==='outbound'?'Empresa':'Cliente')+' · '+date(m.created_at)+'</div></div>').join('');
 const pendingHTML=pending.map(j=>'<div class="bubble note"><strong>'+e(stateName[j.status]||j.status)+'</strong><div>'+e(j.body||'Resposta aguardando processamento')+'</div><div class="table-detail">'+e(j.error||'')+'</div></div>').join('');
 $('#threadView').innerHTML='<div class="thread-toolbar"><div><strong>'+e(c.customer_name||c.customer_phone)+'</strong><div class="muted-label">'+e(c.customer_phone)+'</div></div><select id="threadStatus" aria-label="Status da conversa"><option value="open">Aberta</option><option value="human">Atendimento humano</option><option value="resolved">Resolvida</option></select></div>'+
 '<div class="messages-preview">'+(bubbles+pendingHTML||empty('▤','Sem mensagens','Nenhuma mensagem neste histórico.'))+'</div>'+
 '<form id="replyForm" class="chat-compose"><input name="text" maxlength="1800" required placeholder="Responder pelo WhatsApp oficial (envio real)"><button class="btn primary" type="submit">Responder ↗</button></form>'+
 '<form id="noteForm" class="chat-compose"><input name="text" maxlength="3000" required placeholder="Nota interna (nunca enviada)"><button class="btn soft" type="submit">Nota</button></form>';
 $('#threadStatus').value=c.status;
 $('#threadStatus').addEventListener('change',async ev=>{const status=ev.target.value;await action(async()=>{await api('/api/conversations/'+convId,'PATCH',{status});toast('Status atualizado.');});});
 $('#replyForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const txt=val(ev.currentTarget,'text');
  if(!confirm('Confirma o envio desta mensagem real ao cliente pelo WhatsApp?'))return;
  await action(async()=>{await api('/api/conversations/'+convId+'/reply','POST',{text:txt});toast('Mensagem colocada na fila. Confira o status, não é confirmação de entrega.');await openThread(convId);});
 });
 $('#noteForm').addEventListener('submit',async ev=>{ev.preventDefault();const txt=val(ev.currentTarget,'text');await action(async()=>{await api('/api/conversations/'+convId+'/note','POST',{text:txt});await openThread(convId);toast('Nota interna registrada.');});});
}

async function team(){
 const data=await api('/api/team');
 view.innerHTML=heading('PESSOAS','Sua equipe.','Convide colaboradores com acesso apenas aos dados da sua empresa.')+
 '<div class="two-pane"><div>'+panel('Pessoas cadastradas',data.length+' usuário(s).',
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Acesso</th></tr></thead><tbody>'+data.map(u=>'<tr><td><strong>'+e(u.name)+'</strong><div class="table-detail">'+e(u.email)+'</div></td><td>'+badge(u.role==='owner'?'Proprietário':u.role==='admin'?'Administrador':'Atendente')+'</td></tr>').join('')+'</tbody></table></div>')+'</div>'+
 '<div class="card card-pad"><div class="section-title">Adicionar colaborador</div><form class="form-stack" id="teamForm"><label>Nome<input name="name" required maxlength="100"></label><label>E-mail<input name="email" type="email" required></label><label>Permissão<select name="role"><option value="agent">Atendente</option><option value="admin">Administrador da empresa</option></select></label><label>Senha temporária (mín. 12 caracteres)<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="btn primary" type="submit">Cadastrar colaborador →</button><p class="form-note">Compartilhe a senha com segurança e peça que o usuário a altere. Recuperação automática de senha será adicionada em uma próxima versão.</p></form></div></div>';
 $('#teamForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/team','POST',d);toast('Colaborador cadastrado.');await team();});});
}
async function admin(){
 const tenants=await api('/api/admin/tenants');
 view.innerHTML=heading('CONTROLE CONSECOM','Empresas do Sócio.','Gerencie clientes, planos e ambientes independentes da plataforma.')+
 '<div class="two-pane"><div>'+panel('Empresas cadastradas',tenants.length+' ambiente(s) isolado(s).',
 '<div class="table-wrap"><table class="data-table"><thead><tr><th>Empresa</th><th>Plano</th><th>Acesso</th></tr></thead><tbody>'+tenants.map(t=>'<tr><td><strong>'+e(t.name)+'</strong><div class="table-detail">'+e(t.slug)+' · '+e(t.members)+' usuário(s)</div></td><td>'+badge(t.plan)+'</td><td><button class="btn sm ghost" data-switch="'+e(t.id)+'">'+(t.id===state.me.tenant.id?'Atual':'Acessar')+'</button></td></tr>').join('')+'</tbody></table></div>')+'</div>'+
 '<div class="card card-pad"><div class="section-title">Cadastrar empresa cliente</div><form id="tenantForm" class="form-stack"><label>Nome da empresa<input name="company" required maxlength="120" placeholder="Ex.: Pizzaria Bella"></label><label>Nome do responsável<input name="ownerName" required maxlength="100"></label><label>E-mail do responsável<input name="ownerEmail" required type="email"></label><label>Plano<select name="plan"><option value="essencial">Essencial · R$129/mês</option><option value="equipe">Equipe</option><option value="voz">Voz (futuro)</option></select></label><label>Senha inicial (mín. 12 caracteres)<input type="password" name="ownerPassword" required minlength="12" maxlength="128" autocomplete="new-password"></label><button class="btn primary" type="submit">Criar espaço da empresa →</button><p class="form-note">O plano é um registro administrativo; cobranças e assinaturas ainda não são processadas automaticamente.</p></form></div></div>';
 $('#tenantForm').addEventListener('submit',async ev=>{ev.preventDefault();const d=formValues(ev.currentTarget);await action(async()=>{await api('/api/admin/tenants','POST',d);toast('Empresa cadastrada e isolada.');await admin();});});
 view.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',()=>action(async()=>{await api('/api/admin/switch','POST',{tenantId:b.dataset.switch});toast('Ambiente alterado.');state.view='overview';await boot();})));
}
async function action(fn){try{await fn();}catch(err){toast(errMsg(err),true);}}
$('#loginForm').addEventListener('submit',async ev=>{
 ev.preventDefault();$('#authError').textContent='';
 try{const data=await api('/api/login','POST',formValues(ev.currentTarget));state.csrf=data.csrf;await boot();}
 catch(err){$('#authError').textContent=errMsg(err);}
});
$('#setupForm').addEventListener('submit',async ev=>{
 ev.preventDefault();$('#authError').textContent='';
 try{const data=await api('/api/setup','POST',formValues(ev.currentTarget));state.csrf=data.csrf;await boot();}
 catch(err){$('#authError').textContent=errMsg(err);}
});
$$('.nav-item[data-view]').forEach(b=>b.addEventListener('click',()=>changeView(b.dataset.view)));
$('#logoutBtn').addEventListener('click',async()=>{try{await api('/api/logout','POST',{});}catch{}state.me=null;state.csrf='';state.view='overview';boot();});
boot();
