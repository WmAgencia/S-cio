/* Sócio — WhatsApp-familiar inbox: gestures, mouse, keyboard and assistive tech.
   Runs entirely within tenant-scoped Sócio APIs. Never claims a WhatsApp send
   when the dedicated WA-AKG gateway is operating in read-only mode. */
(function(){
 'use strict';
 function create({api,e,toast,view,changeView}){
  let conversations=[],active=null,thread=null,filter='all',search='',filterMessages='',selected=new Set();
  let reply=null,menuId=null,pointer=null,longTimer=null,refreshTimer=null,searchTimer=null,draftTimer=null;
  let infoOpen=false,helpOpen=false,menuAt=null,team=null,lock=false,disposed=false,lastFetch=0,syncing=false,cancelSync=false,suppressClick=false;
  let prefs={fontScale:'normal',contrast:'normal',compact:false};
  try{const saved=JSON.parse(localStorage.getItem('socio-inbox-accessibility')||'{}');
   if(saved.fontScale==='large')prefs.fontScale='large';
   if(saved.contrast==='high')prefs.contrast='high';
   prefs.compact=saved.compact===true;
  }catch{}
  const state={
   get active(){return active;},get conversation(){return thread;},get selectedCount(){return selected.size;}
  };
  const wrap=()=>view.querySelector('#socioInbox');
  const byId=id=>view.querySelector('#'+id);
  const t=(value,max=10000)=>e(String(value??'').slice(0,max));
  const icon=(symbol)=>'<span aria-hidden="true">'+symbol+'</span>';
  const stamp=raw=>{
   const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
  };
  const fullDate=raw=>{
   const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'}):'';
  };
  const initials=name=>String(name||'?').trim().slice(0,1).toUpperCase();
  const cleanId=value=>/^[0-9a-f-]{36}$/i.test(String(value||''))?String(value):'';
  const savedPrefs=()=>{try{localStorage.setItem('socio-inbox-accessibility',JSON.stringify(prefs));}catch{}};
  const statusLabel=c=>c?.status==='resolved'?'Resolvida':c?.handling_mode==='ai_assist'?'IA auxiliando':c?.status==='human'?'Atendimento humano':'Em atendimento';
  const current=()=>conversations.find(c=>c.id===active)||null;
  function clearTimers(){
   clearTimeout(searchTimer);clearTimeout(draftTimer);clearTimeout(longTimer);clearInterval(refreshTimer);
   searchTimer=draftTimer=longTimer=refreshTimer=null;
  }
  function cleanup(){
   clearTimers();disposed=true;pointer=null;menuId=null;active=null;thread=null;selected.clear();
  }
  function layout(){
   const filters=[
    ['all','Todas'],['unread','Não lidas'],['favorites','Favoritas'],['pinned','Fixadas'],
    ['human','Humano'],['ai_assist','IA'],['resolved','Resolvidas'],['archived','Arquivadas']
   ];
   return '<section class="wa-inbox'+(prefs.contrast==='high'?' wa-high-contrast':'')+
    (prefs.fontScale==='large'?' wa-large-type':'')+(prefs.compact?' wa-compact':'')+
    '" id="socioInbox" aria-label="Central de conversas do Sócio">'+
    '<aside class="wa-inbox-side" aria-label="Lista de conversas">'+
     '<header class="wa-inbox-side-head"><div><span class="wa-inbox-eyebrow">SEU ATENDIMENTO</span>'+
      '<h1>Conversas <span id="inboxCount" aria-live="polite"></span></h1></div>'+
      '<div class="wa-side-head-buttons"><button type="button" class="wa-round-icon" data-inbox-sync aria-label="Sincronizar histórico de WhatsApps conectados" title="Sincronizar conversas">⟳</button>'+' <button type="button" class="wa-round-icon" id="inboxSettings" aria-label="Opções de acessibilidade" title="Acessibilidade">⚙</button></div></header>'+
     '<div class="wa-inbox-search">'+icon('⌕')+
      '<input id="inboxSearch" type="search" maxlength="90" placeholder="Buscar nome, número ou mensagem" autocomplete="off" aria-label="Pesquisar conversas" value="'+t(search,90)+'"></div>'+
     '<nav class="wa-filters" role="group" aria-label="Filtrar conversas">'+filters.map(([key,label])=>
      '<button type="button" data-inbox-filter="'+key+'" class="'+(filter===key?'active':'')+'" aria-pressed="'+(filter===key)+'">'+label+'</button>').join('')+'</nav>'+
     '<div class="wa-inbox-items" id="inboxItems" role="list" aria-live="polite">'+
      '<div class="wa-loading">Carregando conversas...</div></div>'+
     '<div class="wa-inbox-side-bottom"><span class="wa-live-dot"></span>'+
      '<span>Atualização automática durante o atendimento</span></div></aside>'+
    '<section class="wa-inbox-main" aria-label="Conversa selecionada" id="inboxMain">'+
     '<div class="wa-inbox-welcome">'+
      '<span class="wa-inbox-welcome-mark">✳</span><h2>Selecione uma conversa</h2>'+
      '<p>Leia o histórico, registre notas e organize seus atendimentos.</p>'+
      '<small>Conversas e ações internas protegidas por empresa</small></div></section>'+
    '<aside class="wa-inbox-details hidden" id="inboxDetails" aria-label="Detalhes do contato"></aside>'+
    '<div class="wa-context-menu hidden" role="menu" id="inboxContextMenu" aria-label="Ações da mensagem"></div>'+
    '<div class="wa-inbox-dialog hidden" id="inboxDialog" role="dialog" aria-modal="true" aria-label="Ferramentas da conversa"></div>'+
    '<div class="wa-inbox-sr" role="status" aria-live="polite" id="inboxAnnouncer"></div>'+
   '</section>';
  }
  function announce(message){
   const el=byId('inboxAnnouncer');if(el)el.textContent=message;
  }
  function renderList(){
   const host=byId('inboxItems');if(!host)return;
   const list=conversations;
   byId('inboxCount').textContent='('+list.length+(list.length===150?'+':'')+')';
   host.innerHTML=list.length?list.map((c,i)=>{
    const name=c.customer_name||c.customer_phone||'Contato sem nome';
    const latest=String(c.last_message||'Sem mensagens').replace(/\s+/g,' ').trim();
    const unread=c.unread===true;
    return '<div role="listitem" class="wa-list-row-wrap">'+
     '<button type="button" class="wa-list-row'+(c.id===active?' active':'')+
      (unread?' is-unread':'')+'" data-thread="'+t(c.id)+'" aria-current="'+(c.id===active)+'" aria-label="'+t(name)+', '+t(statusLabel(c))+', '+t(latest,90)+'">'+
       '<span class="wa-chat-avatar wa-chat-avatar-'+i%5+'">'+t(initials(name))+'</span>'+
       '<span class="wa-chat-text"><span class="wa-chat-name-line"><strong>'+t(name,120)+'</strong>'+
       '<small>'+t(stamp(c.last_message_at))+'</small></span>'+
       '<span class="wa-chat-preview">'+(c.draft?'<em>Rascunho: '+t(c.draft,60)+'</em>':t(latest,80))+'</span>'+
       '<span class="wa-chat-meta">'+t(c.channel_label||'Canal')+(c.labels?.length?' · '+t(c.labels[0],25):'')+'</span></span>'+
       '<span class="wa-chat-indicators">'+(c.pinned?'<span title="Conversa fixada">⌖</span>':'')+
       (c.muted?'<span title="Silenciada">◌</span>':'')+
       (unread?'<span class="wa-unread-dot" title="Não lida"></span>':'')+'</span>'+
      '</button></div>';
   }).join(''):'<div class="wa-inbox-empty-list"><strong>Nenhuma conversa encontrada</strong>'+
    '<p>Conecte um WhatsApp para receber mensagens ou altere os filtros.</p>'+
    '<button class="btn soft" type="button" data-inbox-go="channels">Gerenciar WhatsApps</button></div>';
  }
  function renderHeader(c){
   const name=c?.customer_name||c?.customer_phone||'Contato';
   return '<div class="wa-thread-header">'+
    '<button class="wa-mobile-back wa-round-icon" type="button" data-chat-action="back" aria-label="Voltar à lista de conversas">‹</button>'+
    '<button class="wa-thread-identity" type="button" data-chat-action="details" aria-label="Ver detalhes de '+t(name)+'">'+
     '<span class="wa-chat-avatar">'+t(initials(name))+'</span><span><strong>'+t(name)+'</strong>'+
     '<small>'+t(c?.customer_phone||'')+' · '+t(statusLabel(c))+'</small></span></button>'+
    '<span class="wa-thread-actions"><button type="button" class="wa-small-action" data-chat-action="search" aria-label="Buscar nesta conversa" title="Pesquisar">⌕</button>'+
     '<button type="button" class="wa-small-action" data-chat-action="details" aria-label="Detalhes do contato" title="Informações">ⓘ</button>'+
     '<button type="button" class="wa-small-action" data-chat-action="help" aria-label="Atalhos de teclado" title="Atalhos">⌨</button></span>'+
   '</div>';
  }
  function renderMessage(m,prior){
   const self=m.direction==='outbound',note=m.direction==='note';
   const author=note?'Nota interna':self?'Empresa':'Cliente';
   const quote=m.reply_to_id?'<button type="button" class="wa-message-quote" data-go-quote="'+t(m.reply_to_id)+'" aria-label="Ir à mensagem citada">↳ Resposta a mensagem anterior</button>':'';
   const reaction=m.reaction?'<span class="wa-msg-reaction" title="Marcação interna, não enviada ao WhatsApp">'+t(m.reaction,16)+'</span>':'';
   const day=fullDate(m.created_at),prevDay=prior?fullDate(prior.created_at):null;
   const daySep=day!==prevDay?'<div class="wa-date-marker" role="separator">'+t(day)+'</div>':'';
   const body=String(m.body||'').trim()||'[Conteúdo não disponível]';
   return daySep+'<div class="wa-message-row '+(self?'outgoing':note?'internal':'incoming')+'" data-message-id="'+t(m.id)+'" role="listitem">'+
    '<div class="wa-message-bubble'+(selected.has(m.id)?' selected':'')+
     (m.starred?' starred':'')+'" tabindex="0" role="group" data-message="'+t(m.id)+'"'+
     ' aria-label="'+t(author+', '+stamp(m.created_at)+': '+body,300)+'"'+
     ' title="Duplo clique para responder; clique para abrir opções; botão direito para mais ações">'+
     quote+'<div class="wa-message-copy">'+t(body,5000)+'</div>'+
     '<div class="wa-message-meta"><span>'+t(note?'Visível apenas à equipe':author)+'</span>'+
      (m.starred?'<span title="Favorita">★</span>':'')+
      '<time datetime="'+t(m.created_at)+'">'+t(stamp(m.created_at))+'</time></div>'+
     reaction+'<button type="button" class="wa-message-more" data-more="'+t(m.id)+'" aria-label="Ações desta mensagem" title="Abrir opções">⌄</button></div>'+
    '</div>';
  }
  function renderMessageList({keepScroll=false}={}){
   const el=byId('inboxMessageList');if(!el||!thread)return;
   const nearEnd=el.scrollHeight-el.scrollTop-el.clientHeight<90,oldScroll=el.scrollTop;
   const data=thread.messages.filter(m=>!filterMessages||
      String(m.body||'').toLocaleLowerCase('pt-BR').includes(filterMessages.toLocaleLowerCase('pt-BR')));
   el.innerHTML='<div class="wa-history-load">'+(thread.hasMore?
    '<button type="button" data-chat-action="more" class="wa-load-history">Carregar mensagens anteriores</button>':
    '<span>'+t(thread.messages.length?'Início do histórico disponível':'Sem mensagens neste histórico')+'</span>')+'</div>'+
    (data.length?data.map((m,i)=>renderMessage(m,i?data[i-1]:null)).join(''):
     '<p class="wa-empty-messages">'+(filterMessages?'Nenhuma mensagem corresponde à busca.':'Ainda não há mensagens nesta conversa.')+'</p>');
   if(keepScroll&&!nearEnd)el.scrollTop=oldScroll;
   else el.scrollTop=el.scrollHeight;
  }
  function renderComposer(){
   const box=byId('inboxCompose');if(!box)return;
   const hasReply=reply&&thread?.messages.some(m=>m.id===reply.id);
   box.innerHTML=
    '<div class="wa-compose-top">'+
     '<div class="wa-compose-ownership">'+
      '<button type="button" data-chat-action="take" class="wa-mode-btn'+(current()?.handling_mode!=='ai_assist'?' active':'')+'">♙ Assumir conversa</button>'+
      '<button type="button" data-chat-action="assist" class="wa-mode-btn'+(current()?.handling_mode==='ai_assist'?' active':'')+'">✳ Entregar para IA</button>'+
     '</div><span class="wa-compose-disclaimer">Gateway em leitura: sem envio para WhatsApp</span></div>'+
    (hasReply?'<div class="wa-reply-banner"><div><strong>Respondendo como nota interna</strong>'+
      '<small>'+t(reply.body,155)+'</small></div>'+
      '<button type="button" class="wa-small-action" data-chat-action="cancel-reply" aria-label="Cancelar resposta">×</button></div>':'')+
    '<div class="wa-compose-row">'+
     '<button type="button" class="wa-small-action wa-unsupported" data-chat-action="attach" aria-label="Anexar arquivo indisponível no gateway" title="Envio de anexos ainda não habilitado">＋</button>'+
     '<textarea id="inboxDraft" aria-label="Escrever nota interna, não enviada ao WhatsApp" rows="1" maxlength="3000" placeholder="Nota interna para a equipe (não enviada ao cliente)">'+t(current()?.draft||'',3000)+'</textarea>'+
     '<button type="button" class="wa-small-action wa-unsupported" data-chat-action="voice" aria-label="Gravar áudio indisponível no gateway" title="Áudio indisponível">♩</button>'+
     '<button type="button" class="wa-compose-send" data-chat-action="save-note" aria-label="Salvar nota interna" title="Salvar nota interna">➤</button>'+
    '</div>'+
    '<div class="wa-compose-foot"><span>Enter salva a nota · Shift + Enter quebra linha · Alt + R responde</span>'+
      '<button type="button" class="wa-inline-link" data-chat-action="ai-suggest">✳ Sugerir resposta com IA</button></div>'+
    '<div class="wa-ai-suggestion hidden" id="inboxSuggestion" role="status" aria-live="polite"></div>';
  }
  function threadMarkup(c){
   return '<div class="wa-thread-container">'+renderHeader(c)+
    '<div class="wa-thread-search hidden" id="inboxThreadSearch"><input type="search" id="inboxMessageSearch" placeholder="Buscar nas mensagens carregadas" aria-label="Pesquisar mensagens deste histórico">'+
      '<button type="button" data-chat-action="clear-search" aria-label="Fechar pesquisa">×</button></div>'+
    '<div class="wa-message-list" id="inboxMessageList" role="list" aria-label="Histórico de mensagens" tabindex="0"></div>'+
    '<div class="wa-selected-bar hidden" id="inboxSelectedBar" role="toolbar" aria-label="Ações para mensagens selecionadas"></div>'+
    '<div class="wa-compose" id="inboxCompose"></div></div>';
  }
  function renderSelected(){
   const bar=byId('inboxSelectedBar');if(!bar)return;
   bar.classList.toggle('hidden',selected.size===0);
   bar.innerHTML=selected.size?'<span>'+selected.size+' mensagem(ns) selecionada(s)</span>'+
    '<button type="button" data-chat-action="copy-selected">Copiar</button>'+
    '<button type="button" data-chat-action="star-selected">Favoritar</button>'+
    '<button type="button" data-chat-action="clear-selected">Cancelar</button>':'';
  }
  function closeMenu(){menuId=null;menuAt=null;const menu=byId('inboxContextMenu');if(menu){menu.classList.add('hidden');menu.innerHTML='';}}
  function openMenu(id,position){
   if(!thread||!thread.messages.some(m=>m.id===id))return;
   closeMenu();menuId=id;menuAt=position;
   const msg=thread.messages.find(m=>m.id===id);
   const menu=byId('inboxContextMenu');if(!menu)return;
   const actions=[
    ['reply','↳','Responder como nota'],['copy','▣','Copiar mensagem'],['star','★',msg.starred?'Desfavoritar':'Favoritar'],
    ['select','☑','Selecionar'],['forward','➜','Encaminhar como nota interna'],
    ['react','👍','Curtir internamente'],['react-heart','♥','Marcar com coração'],
    ['react-clear','×','Remover reação interna'],['ai-suggest','✳','Pedir sugestão à IA']
   ];
   menu.innerHTML='<div class="wa-menu-note">Ações no Sócio · não são enviadas ao WhatsApp</div>'+
    actions.map(([key,icon,label])=>'<button type="button" data-message-action="'+key+'" role="menuitem">'+
     '<span aria-hidden="true">'+icon+'</span>'+label+'</button>').join('');
   menu.classList.remove('hidden');
   const rect=wrap().getBoundingClientRect(),x=position?.x??rect.left+rect.width*.6,y=position?.y??rect.top+rect.height*.45;
   const maxLeft=window.innerWidth-menu.offsetWidth-12,maxTop=window.innerHeight-menu.offsetHeight-12;
   menu.style.left=Math.max(10,Math.min(x,maxLeft))+'px';
   menu.style.top=Math.max(10,Math.min(y,maxTop))+'px';
   menu.querySelector('[role="menuitem"]')?.focus();
  }
  function updateRowUI(id){
   const msg=thread?.messages.find(m=>m.id===id);if(!msg)return;
   renderMessageList({keepScroll:true});renderSelected();
  }
  function replyTo(id){
   const msg=thread?.messages.find(m=>m.id===id);
   if(!msg)return;
   reply={id:msg.id,body:msg.body};closeMenu();renderComposer();
   byId('inboxDraft')?.focus();
   announce('Mensagem selecionada para responder como nota interna.');
  }
  function toggleSelect(id){
   if(selected.has(id))selected.delete(id);else selected.add(id);
   closeMenu();updateRowUI(id);
   announce(selected.size+' mensagens selecionadas');
  }
  async function messageAction(action,id){
   const msg=thread?.messages.find(m=>m.id===id);if(!msg)return;
   closeMenu();
   if(action==='reply'){replyTo(id);return;}
   if(action==='select'){toggleSelect(id);return;}
   if(action==='copy'){
    try{await navigator.clipboard.writeText(msg.body);toast('Mensagem copiada.');}
    catch{toast('O navegador não permitiu copiar automaticamente. Selecione o texto.',true);}
    return;
   }
   if(action==='star'||action.startsWith('react')){
    const payload=action==='star'?{starred:!msg.starred}:
     {reaction:action==='react'?'👍':action==='react-heart'?'❤️':null};
    const result=await api('/api/conversations/'+active+'/messages/'+id+'/ui','PATCH',payload);
    Object.assign(msg,result.flags);updateRowUI(id);
    toast(action==='star'?'Favorito atualizado.':'Reação interna atualizada (não enviada ao WhatsApp).');
    return;
   }
   if(action==='forward'){showForward(id);return;}
   if(action==='ai-suggest'){await suggestion(msg.body);return;}
  }
  async function setPref(patch,{silent=false}={}){
   if(!active)return;
   const result=await api('/api/conversations/'+active+'/ui','PATCH',patch);
   const c=current();if(c){
    Object.assign(c,result.preferences);
    if(Object.hasOwn(patch,'read'))c.unread=false;
    if(Object.hasOwn(patch,'marked_unread'))c.unread=patch.marked_unread;
   }
   if(thread)thread.preferences=result.preferences;
   if(!silent)toast('Preferências salvas.');
   renderList();
   if(Object.hasOwn(patch,'handling_mode')){renderComposer();if(infoOpen)renderDetails();}
  }
  async function saveDraft(){
   const input=byId('inboxDraft');if(!input||!active)return;
   const value=input.value.slice(0,3000),c=current();if(c)c.draft=value;
   await setPref({draft:value},{silent:true});
  }
  async function submitNote(){
   const input=byId('inboxDraft');if(!input||lock)return;
   const text=input.value.trim();if(!text){input.focus();return;}
   lock=true;
   try{
    const result=await api('/api/conversations/'+active+'/notes','POST',
      {text,replyToMessageId:reply?.id||null});
    thread.messages.push({...result.message,starred:false,reaction:null});
    reply=null;const c=current();if(c)c.draft='';
    renderMessageList();renderComposer();renderSelected();
    await setPref({draft:''},{silent:true});
    announce('Nota interna salva; nenhuma mensagem foi enviada ao WhatsApp.');
    toast('Nota interna registrada. Não enviada ao cliente.');
   }catch(error){toast(error.message,true);}
   finally{lock=false;}
  }
  async function suggestion(input){
   const text=String(input||'').trim();
   if(!text){toast('Selecione uma mensagem para pedir uma sugestão à IA.');return;}
   const box=byId('inboxSuggestion');if(!box)return;
   box.classList.remove('hidden');box.textContent='Gerando sugestão da IA...';
   try{
    const result=await api('/api/simulate','POST',{message:text.slice(0,1200)});
    const value=String(result.reply||'').slice(0,3000);
    box.innerHTML='<strong>Sugestão da IA · não enviada</strong><p>'+t(value,3000)+'</p>'+
     '<button type="button" data-chat-action="copy-suggestion">Copiar sugestão</button>';
    box.dataset.suggestion=value;
    announce('A IA gerou uma sugestão. Revise antes de enviar pelo seu canal autorizado.');
   }catch(error){box.textContent='Não foi possível gerar a sugestão: '+error.message;}
  }
  async function performChatAction(action){
   if(!active)return;
   const c=current();
   if(action==='back'){wrap()?.classList.remove('wa-show-thread');return;}
   if(action==='details'){infoOpen=!infoOpen;await renderDetails();return;}
   if(action==='search'){byId('inboxThreadSearch')?.classList.toggle('hidden');byId('inboxMessageSearch')?.focus();return;}
   if(action==='clear-search'){filterMessages='';byId('inboxMessageSearch').value='';byId('inboxThreadSearch')?.classList.add('hidden');renderMessageList();return;}
   if(action==='help'){showHelp();return;}
   if(action==='cancel-reply'){reply=null;renderComposer();return;}
   if(action==='more'){await loadMore();return;}
   if(action==='save-note'){await submitNote();return;}
   if(action==='take'){await setPref({handling_mode:'human'});return;}
   if(action==='assist'){await setPref({handling_mode:'ai_assist'});toast('IA habilitada para sugestões internas. Envio automático continua desativado.');return;}
   if(action==='pin'){await setPref({pinned:!c.pinned});return;}
   if(action==='favorite'){await setPref({favorite:!c.favorite});return;}
   if(action==='mute'){await setPref({muted:!c.muted});return;}
   if(action==='archive'){await setPref({archived:!c.archived});await refreshList();return;}
   if(action==='unread'){await setPref({marked_unread:true});return;}
   if(action==='mark-read'){await setPref({read:true},{silent:true});return;}
   if(action==='resolve'){
    const next=c.status==='resolved'?'open':'resolved';
    await api('/api/conversations/'+active,'PATCH',{status:next});
    c.status=next;renderList();toast(next==='resolved'?'Conversa resolvida.':'Conversa reaberta.');return;
   }
   if(action==='clear-selected'){selected.clear();renderMessageList({keepScroll:true});renderSelected();return;}
   if(action==='copy-selected'){
    const content=thread.messages.filter(m=>selected.has(m.id))
      .map(m=>(m.direction==='note'?'Nota':m.direction==='outbound'?'Empresa':'Cliente')+
      ' ('+stamp(m.created_at)+'): '+m.body).join('\n');
    try{await navigator.clipboard.writeText(content);toast('Mensagens copiadas.');}
    catch{toast('Copiar não foi permitido pelo navegador.',true);}
    return;
   }
   if(action==='star-selected'){
    try{
     for(const id of [...selected]){await api('/api/conversations/'+active+'/messages/'+id+'/ui','PATCH',{starred:true});
      const m=thread.messages.find(x=>x.id===id);if(m)m.starred=true;}
     selected.clear();renderMessageList({keepScroll:true});renderSelected();toast('Mensagens favoritadas internamente.');
    }catch(error){toast(error.message,true);}
    return;
   }
   if(action==='ai-suggest'){
    const customer=[...thread.messages].reverse().find(m=>m.direction==='inbound');
    await suggestion(customer?.body||'');return;
   }
   if(action==='copy-suggestion'){
    try{await navigator.clipboard.writeText(byId('inboxSuggestion')?.dataset.suggestion||'');toast('Sugestão copiada.');}
    catch{toast('Não foi possível copiar a sugestão.',true);}return;
   }
   if(action==='attach'||action==='voice'){
    toast('Envio de áudio e arquivos não habilitado: o gateway do Sócio está em modo somente leitura.',true);return;
   }
  }
  async function updateChatStatus(status){
   if(!['open','human','resolved'].includes(status)||!active)return;
   await api('/api/conversations/'+active,'PATCH',{status});
   if(current())current().status=status;
   renderList();toast('Status atualizado.');
  }
  async function loadMore(){
   if(!thread?.hasMore||!thread.nextCursor)return;
   const el=byId('inboxMessageList'),top=el?.scrollHeight||0;
   const result=await api('/api/conversations/'+active+'/history?limit=80&before='+encodeURIComponent(thread.nextCursor));
   thread.messages=[...result.messages,...thread.messages];
   thread.hasMore=result.hasMore;thread.nextCursor=result.nextCursor;
   renderMessageList({keepScroll:true});
   if(el)el.scrollTop+=Math.max(0,el.scrollHeight-top);
  }
  async function open(id,{background=false}={}){
   if(!cleanId(id)||disposed)return;
   const same=active===id;
   if(!same){selected.clear();reply=null;infoOpen=false;filterMessages='';closeMenu();}
   active=id;
   const item=current();if(!item)return;
   const result=await api('/api/conversations/'+id+'/history?limit=80');
   if(disposed||active!==id)return;
   thread=result;
   const main=byId('inboxMain');
   if(!main)return;
   main.innerHTML=threadMarkup(item);
   wrap()?.classList.add('wa-show-thread');
   renderList();renderMessageList({keepScroll:background});
   renderComposer();renderSelected();
   if(!background){
    await setPref({read:true},{silent:true}).catch(()=>{});
    byId('inboxDraft')?.focus({preventScroll:true});
   }
   if(infoOpen)await renderDetails();
  }
  function detailsTemplate(c){
   return '<div class="wa-details-top"><h2>Informações</h2><button type="button" data-chat-action="details" aria-label="Fechar detalhes">×</button></div>'+
    '<div class="wa-details-profile"><span class="wa-chat-avatar large">'+t(initials(c.customer_name||c.customer_phone))+'</span>'+
     '<strong>'+t(c.customer_name||c.customer_phone||'Contato')+'</strong><small>'+t(c.customer_phone||'')+'</small></div>'+
    '<div class="wa-details-section"><h3>Atendimento</h3>'+
     '<label>Status<select id="inboxStatus"><option value="open">Aberta</option><option value="human">Humano</option><option value="resolved">Resolvida</option></select></label>'+
     '<label>Responsável<select id="inboxAssignee"><option value="">Sem responsável</option>'+
      (team||[]).map(user=>'<option value="'+t(user.id)+'">'+t(user.name,90)+'</option>').join('')+'</select></label>'+
     '<label>Etiquetas<input id="inboxLabels" type="text" maxlength="160" placeholder="Ex.: VIP, Interessado" value="'+t((c.labels||[]).join(', '),160)+'"></label>'+
     '<button type="button" class="btn soft" data-chat-action="save-labels">Salvar etiquetas</button></div>'+
    '<div class="wa-details-section"><h3>Organização</h3><div class="wa-details-buttons">'+
      [['pin',c.pinned?'Desafixar':'Fixar','⌖'],['favorite',c.favorite?'Remover favorito':'Favoritar','★'],
       ['mute',c.muted?'Ativar som':'Silenciar','◌'],['archive',c.archived?'Desarquivar':'Arquivar','□'],
       ['unread','Marcar como não lida','●'],['resolve',c.status==='resolved'?'Reabrir':'Resolver','✓']]
      .map(([action,label,icon])=>'<button type="button" data-chat-action="'+action+'"><span>'+icon+'</span>'+label+'</button>').join('')+
     '</div></div><div class="wa-details-section"><h3>Preferências</h3>'+
     '<button class="btn ghost" type="button" data-chat-action="help">Atalhos e acessibilidade</button></div>';
  }
  async function renderDetails(){
   const panel=byId('inboxDetails');if(!panel)return;
   panel.classList.toggle('hidden',!infoOpen);
   if(!infoOpen)return;
   const c=current();if(!c)return;
   if(!team)team=await api('/api/team').catch(()=>[]);
   panel.innerHTML=detailsTemplate(c);
   byId('inboxStatus').value=c.status;
   byId('inboxAssignee').value=c.assigned_user_id||'';
  }
  function showDialog(markup){
   const dialog=byId('inboxDialog');if(!dialog)return;
   dialog.innerHTML='<div class="wa-dialog-surface"><button type="button" data-dialog-close aria-label="Fechar janela" class="wa-dialog-close">×</button>'+
    markup+'</div>';dialog.classList.remove('hidden');
   dialog.querySelector('button,input,select')?.focus();
  }
  function closeDialog(){cancelSync=true;const dialog=byId('inboxDialog');if(dialog){dialog.classList.add('hidden');dialog.innerHTML='';}}
  function showHelp(){
   showDialog('<h2>Atalhos e acessibilidade</h2><p>Os gestos são opcionais; todas as ações também funcionam com o teclado e os botões.</p>'+
    '<div class="wa-help-grid">'+[
      ['Duplo clique','Responder à mensagem como nota interna'],
      ['Clique esquerdo','Abrir ferramentas da mensagem'],
      ['Botão direito','Menu contextual'],
      ['Arraste à direita','Responder à mensagem'],
      ['Arraste à esquerda','Mostrar ferramentas'],
      ['Pressionar e segurar','Abrir ferramentas no celular'],
      ['Alt + R','Responder à mensagem selecionada'],
      ['Enter','Salvar nota interna; Shift + Enter pula linha'],
      ['Esc','Fechar ferramentas, resposta ou painel'],
      ['↑ / ↓','Navegar pelos contatos ao focar a lista'],
      ['Tab','Percorrer todos os botões'],
      ['Ctrl + Alt + F','Pesquisar conversas']
     ].map(([label,desc])=>'<div><strong>'+label+'</strong><span>'+desc+'</span></div>').join('')+
    '</div><h3>Conforto visual</h3>'+
    '<div class="wa-a11y-buttons">'+
     '<button type="button" data-a11y="size">'+(prefs.fontScale==='large'?'Reduzir texto':'Aumentar texto')+'</button>'+
     '<button type="button" data-a11y="contrast">'+(prefs.contrast==='high'?'Contraste padrão':'Alto contraste')+'</button>'+
     '<button type="button" data-a11y="density">'+(prefs.compact?'Espaçamento confortável':'Lista compacta')+'</button>'+
    '</div><p class="wa-dialog-caution">O envio para WhatsApp, reações remotas, áudios e anexos dependem da integração e não estão ativados nesta versão.</p>');
  }
  function showForward(id){
   const others=conversations.filter(c=>c.id!==active);
   if(!others.length){toast('Não há outra conversa para encaminhar como nota interna.');return;}
   showDialog('<h2>Encaminhar como nota interna</h2><p>Esta ação não envia mensagem para WhatsApp. O texto ficará visível apenas para a equipe no destino.</p>'+
    '<label>Conversa de destino<select id="inboxForwardTarget">'+others.map(c=>
      '<option value="'+t(c.id)+'">'+t(c.customer_name||c.customer_phone,90)+'</option>').join('')+'</select></label>'+
    '<button type="button" class="btn primary wide" data-forward-id="'+t(id)+'">Criar nota interna no destino</button>');
  }
  async function refreshList({quiet=false}={}){
   if(disposed)return;
   const q=new URLSearchParams({filter,search});
   const result=await api('/api/inbox/v2?'+q);
   if(disposed)return;
   conversations=result.conversations||[];
   renderList();
   if(!quiet&&active&&!conversations.some(c=>c.id===active)){
    active=null;thread=null;
    if(byId('inboxMain'))byId('inboxMain').innerHTML='<div class="wa-inbox-welcome"><h2>Conversa fora do filtro</h2><p>Altere os filtros para encontrá-la novamente.</p></div>';
    wrap()?.classList.remove('wa-show-thread');
   }
   lastFetch=Date.now();
  }
  async function poll(){
   if(disposed||document.hidden||!wrap()||lock||!active||Date.now()-lastFetch<9500)return;
   const previous=thread?.messages?.at(-1)?.id;
   try{
    await refreshList({quiet:true});
    if(!active||!wrap())return;
    const next=await api('/api/conversations/'+active+'/history?limit=80');
    const latest=next.messages.at(-1)?.id;
    if(latest!==previous){
     const c=current();if(c?.draft)next.preferences.draft=c.draft;
     thread=next;renderMessageList({keepScroll:true});renderSelected();
     announce('Novas mensagens na conversa');
    }
   }catch{/* network recovery happens on the next tick */}
  }

  async function chooseSync(){
   if(syncing)return;
   const linked=await api('/api/waakg/channels');
   const available=Array.isArray(linked)?linked.filter(c=>c.status==='connected'):[];
   if(!available.length){
    toast('Nenhum WhatsApp conectado. Conecte um número por QR Code para sincronizar conversas.',true);
    return;
   }
   showDialog('<h2>Sincronizar conversas do WhatsApp</h2>'+
    '<p>Importa mensagens de texto disponíveis nos WhatsApps conectados desta empresa. '+ 
    'O gateway limita a cobertura aos 50 contatos mais recentes e até 100 mensagens por contato neste processo. '+ 
    'Mídias e grupos não são importados. Não envia mensagens.</p>'+
    '<label>Número conectado<select id="inboxSyncChannel">'+
     available.map(c=>'<option value="'+t(c.id)+'">'+t(c.label||c.phone,90)+'</option>').join('')+
    '</select></label>'+
    '<button type="button" class="btn primary wide" data-inbox-start-sync>Sincronizar histórico disponível</button>'+
    '<div class="wa-sync-feedback" id="inboxSyncFeedback" role="status" aria-live="polite"></div>');
  }
  async function runSync(){
   if(syncing)return;
   const channel=byId('inboxSyncChannel')?.value;
   if(!cleanId(channel))return;
   syncing=true;cancelSync=false;
   const start=byId('inboxDialog')?.querySelector('[data-inbox-start-sync]');
   if(start)start.disabled=true;
   const feedback=byId('inboxSyncFeedback');
   let batches=0,scanned=0,added=0,more=false,partial=false;
   try{
    let offset=0;
    do{
     if(cancelSync||disposed)break;
     if(feedback)feedback.textContent='Sincronizando até 5 conversas... '+scanned+' processadas.';
     const data=await api('/api/inbox/sync','POST',{channelId:channel,offset});
     if(!data.ok)throw new Error('O gateway não confirmou a sincronização.');
     scanned+=data.chatsImported||0;added+=data.messagesImported||0;
     more=data.hasMore;partial=partial||data.partialCoverage;
     offset=data.nextOffset??0;batches++;
     if(feedback)feedback.textContent=scanned+' conversa(s), '+added+' mensagem(ns) novas.';
    }while(more&&batches<10);
    await refreshList();
    if(conversations.length&&!active)await open(conversations[0].id);
    const result=scanned+' conversa(s) verificadas, '+added+' mensagem(ns) de texto importadas.'+
     (partial?' Cobertura parcial, conforme os limites do gateway.':'');
    if(feedback)feedback.textContent=result;
    toast(result);
    announce(result);
   }catch(err){
    if(feedback)feedback.textContent='Falha na sincronização: '+err.message;
    toast(err.message,true);
   }finally{syncing=false;if(start)start.disabled=false;}
  }
  function onClick(ev){
   if(disposed)return;
   if(suppressClick){suppressClick=false;ev.preventDefault();return;}
   if(ev.target.closest('#inboxSettings')){showHelp();return;}
   if(ev.target.closest('[data-inbox-sync]')){chooseSync().catch(err=>toast(err.message,true));return;}
   if(ev.target.closest('[data-inbox-start-sync]')){runSync();return;}
   const action=ev.target.closest('[data-chat-action]');
   if(action){ev.preventDefault();performChatAction(action.dataset.chatAction).catch(error=>toast(error.message,true));return;}
   const messageActionBtn=ev.target.closest('[data-message-action]');
   if(messageActionBtn&&menuId){ev.preventDefault();messageAction(messageActionBtn.dataset.messageAction,menuId).catch(error=>toast(error.message,true));return;}
   const more=ev.target.closest('[data-more]');
   if(more){ev.preventDefault();const r=more.getBoundingClientRect();openMenu(more.dataset.more,{x:r.left,y:r.bottom+4});return;}
   const quote=ev.target.closest('[data-go-quote]');
   if(quote){ev.preventDefault();const target=byId('inboxMessageList')?.querySelector('[data-message="'+quote.dataset.goQuote+'"]');
    if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('wa-highlight');setTimeout(()=>target.classList.remove('wa-highlight'),1500);}
    else toast('A mensagem citada está em uma página anterior do histórico.');return;
   }
   const listBtn=ev.target.closest('[data-thread]');
   if(listBtn){ev.preventDefault();open(listBtn.dataset.thread).catch(error=>toast(error.message,true));return;}
   const filterBtn=ev.target.closest('[data-inbox-filter]');
   if(filterBtn){filter=filterBtn.dataset.inboxFilter;wrap().querySelectorAll('[data-inbox-filter]').forEach(button=>{
     button.classList.toggle('active',button===filterBtn);button.setAttribute('aria-pressed',String(button===filterBtn));});
    refreshList().catch(error=>toast(error.message,true));return;}
   const go=ev.target.closest('[data-inbox-go]');
   if(go){cleanup();changeView(go.dataset.inboxGo);return;}
   const close=ev.target.closest('[data-dialog-close]');
   if(close){closeDialog();return;}
   const forward=ev.target.closest('[data-forward-id]');
   if(forward){
    const target=byId('inboxForwardTarget')?.value;
    api('/api/conversations/'+active+'/forward-internal','POST',
     {messageId:forward.dataset.forwardId,targetConversationId:target})
     .then(()=>{closeDialog();toast('Nota encaminhada internamente. Não enviada ao WhatsApp.');})
     .catch(error=>toast(error.message,true));return;
   }
   const a11y=ev.target.closest('[data-a11y]');
   if(a11y){
    if(a11y.dataset.a11y==='size')prefs.fontScale=prefs.fontScale==='large'?'normal':'large';
    if(a11y.dataset.a11y==='contrast')prefs.contrast=prefs.contrast==='high'?'normal':'high';
    if(a11y.dataset.a11y==='density')prefs.compact=!prefs.compact;
    savedPrefs();wrap().classList.toggle('wa-large-type',prefs.fontScale==='large');
    wrap().classList.toggle('wa-high-contrast',prefs.contrast==='high');
    wrap().classList.toggle('wa-compact',prefs.compact);showHelp();return;
   }
   const bubble=ev.target.closest('[data-message]');
   if(bubble){
    if(window.getSelection()?.toString())return;
    const rect=bubble.getBoundingClientRect();
    openMenu(bubble.dataset.message,{x:rect.right-8,y:rect.top+18});return;
   }
   if(menuId&&!ev.target.closest('#inboxContextMenu'))closeMenu();
   if(!ev.target.closest('.wa-dialog-surface')&&ev.target.closest('#inboxDialog'))closeDialog();
  }
  function onInput(ev){
   if(ev.target.id==='inboxSearch'){
    search=ev.target.value;clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>refreshList({quiet:true}).catch(error=>toast(error.message,true)),240);
   }
   if(ev.target.id==='inboxMessageSearch'){
    filterMessages=ev.target.value;renderMessageList({keepScroll:true});
   }
   if(ev.target.id==='inboxDraft'){
    const c=current();if(c)c.draft=ev.target.value.slice(0,3000);
    clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(()=>{}),750);
   }
  }
  function onChange(ev){
   if(ev.target.id==='inboxStatus')updateChatStatus(ev.target.value).catch(error=>toast(error.message,true));
   if(ev.target.id==='inboxAssignee')
    setPref({assigned_user_id:ev.target.value||null}).catch(error=>toast(error.message,true));
  }
  function onKeyboard(ev){
   if(disposed)return;
   const dialog=byId('inboxDialog');
   if(ev.key==='Tab'&&dialog&&!dialog.classList.contains('hidden')){
    const items=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
    if(items.length){
     const first=items[0],last=items[items.length-1];
     if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}
     else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}
    }
    return;
   }
   const tag=ev.target.tagName;
   if(ev.key==='Escape'){
    if(!byId('inboxDialog')?.classList.contains('hidden'))closeDialog();
    else if(menuId)closeMenu();
    else if(reply){reply=null;renderComposer();}
    else if(infoOpen){infoOpen=false;renderDetails();}
    else wrap()?.classList.remove('wa-show-thread');
    return;
   }
   if(ev.target.id==='inboxDraft'){
    if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){
     ev.preventDefault();submitNote();
    }
    return;
   }
   if((ev.ctrlKey||ev.metaKey)&&ev.altKey&&ev.key.toLowerCase()==='f'){
    ev.preventDefault();byId('inboxSearch')?.focus();return;
   }
   if(ev.altKey&&ev.key.toLowerCase()==='r'){
    const focus=document.activeElement?.closest('[data-message]');
    const target=focus?.dataset.message||thread?.messages.at(-1)?.id;
    if(target){ev.preventDefault();replyTo(target);}return;
   }
   if(ev.altKey&&ev.key==='8'){
    const target=document.activeElement?.closest('[data-message]')?.dataset.message;
    if(target){ev.preventDefault();messageAction('star',target).catch(error=>toast(error.message,true));}return;
   }
   if((ev.key==='ArrowDown'||ev.key==='ArrowUp')&&ev.target.closest('.wa-inbox-items')){
    const rows=[...view.querySelectorAll('.wa-list-row')];
    const index=rows.indexOf(ev.target.closest('.wa-list-row'));
    if(index>=0&&rows.length){
     ev.preventDefault();
     rows[Math.max(0,Math.min(rows.length-1,index+(ev.key==='ArrowDown'?1:-1)))].focus();
    }
   }
   if(ev.key==='Enter'&&ev.target.matches('.wa-message-bubble')){
    ev.preventDefault();const rect=ev.target.getBoundingClientRect();
    openMenu(ev.target.dataset.message,{x:rect.left+40,y:rect.top+20});
   }
  }
  function onPointerDown(ev){
   const bubble=ev.target.closest('[data-message]');
   if(!bubble||ev.target.closest('button')||ev.button!==0)return;
   pointer={id:bubble.dataset.message,x:ev.clientX,y:ev.clientY,at:Date.now(),type:ev.pointerType};
   clearTimeout(longTimer);
   if(ev.pointerType==='touch')longTimer=setTimeout(()=>{
    if(pointer&&pointer.id===bubble.dataset.message){
     suppressClick=true;
     const rect=bubble.getBoundingClientRect();openMenu(pointer.id,{x:rect.left+20,y:rect.top+20});
     setTimeout(()=>{suppressClick=false;},250);
     pointer=null;
    }
   },520);
  }
  function onPointerUp(ev){
   clearTimeout(longTimer);
   if(!pointer)return;
   const point=pointer;pointer=null;
   const dx=ev.clientX-point.x,dy=ev.clientY-point.y;
   if(window.getSelection()?.toString())return;
   if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5&&Date.now()-point.at<1300){
    suppressClick=true;
    setTimeout(()=>{suppressClick=false;},250);
    if(dx>0)replyTo(point.id);
    else openMenu(point.id,{x:ev.clientX,y:ev.clientY});
    ev.preventDefault();
   }
  }
  async function render(){
   disposed=false;cleanupPending();
   view.innerHTML=layout();
   const host=wrap();
   host.addEventListener('click',onClick);
   host.addEventListener('input',onInput);
   host.addEventListener('change',onChange);
   host.addEventListener('keydown',onKeyboard);
   host.addEventListener('contextmenu',ev=>{
    const bubble=ev.target.closest('[data-message]');
    if(!bubble)return;
    ev.preventDefault();openMenu(bubble.dataset.message,{x:ev.clientX,y:ev.clientY});
   });
   host.addEventListener('dblclick',ev=>{
    if(ev.target.closest('[data-message]')&&!window.getSelection()?.toString()){
     ev.preventDefault();replyTo(ev.target.closest('[data-message]').dataset.message);
    }
   });
   host.addEventListener('pointerdown',onPointerDown);
   host.addEventListener('pointerup',onPointerUp);
   host.addEventListener('pointercancel',()=>{clearTimeout(longTimer);pointer=null;});
   host.addEventListener('click',ev=>{
    const btn=ev.target.closest('[data-chat-action="save-labels"]');
    if(btn){
     const labels=(byId('inboxLabels')?.value||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,6);
     setPref({labels}).catch(error=>toast(error.message,true));
    }
   });
   await refreshList();
   if(conversations.length)await open(conversations[0].id);
   if(!disposed)refreshTimer=setInterval(poll,12000);
  }
  function cleanupPending(){
   clearTimers();active=null;thread=null;conversations=[];selected.clear();
   reply=null;search='';filter='all';infoOpen=false;menuId=null;team=null;lock=false;
  }
  return {render,open,cleanup,state};
 }
 window.SocioInbox={create};
})();
