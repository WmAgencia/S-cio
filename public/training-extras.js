// Guided Sócio training: progressive enhancement layered over the existing approved Markdown flow.
(function(){
 const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const shortDate=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
 async function fileBase64(file){
  if(!file)return {};
  if(file.size>8_000_000)throw new Error('Arquivo excede 8 MB.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Falha ao ler arquivo.'));reader.readAsDataURL(file);});
  const base64=String(data).split(',')[1]||'';
  if(file.type==='application/pdf')return {pdfBase64:base64};
  if(['image/jpeg','image/png','image/webp'].includes(file.type))return {imageBase64:base64};
  throw new Error('Envie JPG, PNG, WebP ou PDF.');
 }
 function sections({interview,proofs,closing,trial,canManage}){
  const v=interview.view,phase=v?.phase,days=trial.endsAt?Math.max(0,Math.ceil((new Date(trial.endsAt)-Date.now())/86400000)):null;
  const proofRows=(proofs||[]).map(p=>'<li class="train-proof-item"><div><strong>'+e(p.title)+'</strong> <small>'+e(p.kind)+(p.approved?' · Aprovado':' · Aguardando aprovação')+'</small>'+
   '<p>'+e(p.description||'Sem descrição')+'</p>'+
   (p.url?'<a href="'+e(p.url)+'" target="_blank" rel="noopener noreferrer">Ver link</a>':'')+
   (p.hasMedia?'<a href="'+e(p.mediaUrl)+'" target="_blank" rel="noopener noreferrer">Abrir arquivo privado</a>':'')+'</div>'+
   (canManage?'<div class="train-proof-actions"><button type="button" class="btn soft" data-proof-action="'+(p.approved?'revoke':'approve')+'" data-proof-id="'+e(p.id)+'">'+(p.approved?'Revogar':'Aprovar')+'</button>'+
   '<button type="button" class="btn soft" data-proof-action="delete" data-proof-id="'+e(p.id)+'" aria-label="Excluir '+e(p.title)+'">Excluir</button></div>':'')+'</li>').join('');
  const opts=[['pix','PIX'],['card','Cartão'],['invoice','Boleto'],['transfer','Transferência']];
  return '<div class="train-suite"><section class="card card-pad train-suite-card"><div class="socio-clean-head"><div><span class="eyebrow">IMPLANTAÇÃO GUIADA</span><h2>Ensine o Sócio sobre sua empresa</h2></div>'+
    (trial.status==='trial'&&days!==null?'<span class="badge yellow">'+days+' dia(s) de teste</span>':'')+'</div>'+
    '<p class="train-suite-subtitle">Responda uma pergunta por vez. Ao finalizar, gere um Markdown para revisão. Nada é ativado automaticamente.</p>'+
    (!v?'<div class="train-suite-start"><p>O Sócio perguntará sobre serviços, preços, atendimento, objeções e encaminhamentos.</p>'+
     (canManage?'<button type="button" class="btn primary" id="trainInterviewStart">Começar entrevista</button>':'')+'</div>':
     '<div class="train-suite-progress"><div class="train-suite-track"><i style="width:'+Number(v.progress||0)+'%"></i></div><small>'+Number(v.progress||0)+'% concluído</small></div>'+
     (phase==='answering'?'<div class="train-suite-question"><div class="train-suite-avatar" aria-hidden="true">✳</div><p>'+e(v.question)+'</p></div>'+
       (canManage?'<form id="trainInterviewAnswer" class="train-suite-form"><label for="trainInterviewText">Sua resposta</label><textarea id="trainInterviewText" name="answer" maxlength="1000" rows="3" placeholder="Responda por escrito; você pode detalhar o quanto for necessário."></textarea>'+
       '<p class="form-note" id="trainVoiceStatus" role="status">Você pode gravar, revisar a transcrição e só então enviar.</p><div class="train-suite-controls"><button type="button" class="btn soft" id="trainVoiceRecord">🎙 Gravar resposta</button><button type="button" class="btn soft" data-interview-reset>Recomeçar</button><button class="btn primary" type="submit">Próxima pergunta →</button></div></form>':''):
       '<div class="train-suite-review"><strong>Entrevista concluída.</strong><p>Você pode gerar uma versão preliminar e editar o Markdown antes de aprová-lo.</p>'+
       (canManage?'<div class="train-suite-controls"><button type="button" class="btn soft" data-interview-reset>Refazer entrevista</button><button type="button" class="btn primary" id="trainInterviewDraft">Gerar rascunho</button></div>':'')+'</div>'))+
   '</section><div class="train-suite-grid"><section class="card card-pad train-suite-card"><div class="socio-clean-head"><div><span class="eyebrow">REFERÊNCIAS COMERCIAIS</span><h2>Portfólio e provas sociais</h2></div><span class="badge">'+proofs.filter(x=>x.approved).length+' aprovados</span></div>'+
    '<p class="train-suite-subtitle">Materiais só entram no conhecimento aprovado depois da sua revisão. Os arquivos ficam privados.</p>'+
    (canManage?'<form id="trainProofForm" class="train-suite-form"><label>Tipo<select name="kind"><option value="portfolio">Portfólio</option><option value="case">Case</option><option value="testimonial">Depoimento autorizado</option></select></label>'+
    '<label>Título<input name="title" required minlength="3" maxlength="120" placeholder="Ex.: Reforma de loja"></label>'+
    '<label>Descrição<textarea name="description" maxlength="500" rows="2" placeholder="O que este material comprova?"></textarea></label>'+
    '<label>Link HTTPS (opcional se houver arquivo)<input name="url" type="url" maxlength="800" placeholder="https://..."></label>'+
    '<label>Imagem ou PDF (opcional)<input name="proofFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'+
    '<button type="submit" class="btn primary">Adicionar para revisão</button></form>':'')+
    '<ul class="train-proof-list">'+(proofRows||'<li>Nenhum material cadastrado.</li>')+'</ul></section>'+
    '<section class="card card-pad train-suite-card"><span class="eyebrow">NEGOCIAÇÃO SUPERVISIONADA</span><h2>Como o Sócio deve vender?</h2>'+
    '<p class="train-suite-subtitle">Configuração não libera cobranças nem mensagens. Preços e condições continuam sujeitos à autorização.</p>'+
    (canManage?'<form id="trainClosingForm" class="train-suite-form">'+
    '<label>Autonomia<select name="mode"><option value="handoff"'+(closing.mode==='handoff'?' selected':'')+'>Qualificar e transferir para humano</option><option value="proposal"'+(closing.mode==='proposal'?' selected':'')+'>Conduzir até proposta aprovada</option></select></label>'+
    '<fieldset><legend>Formas de pagamento aceitas</legend>'+opts.map(([id,label])=>'<label class="train-check"><input type="checkbox" name="methods" value="'+id+'"'+((closing.methods||[]).includes(id)?' checked':'')+'>'+label+'</label>').join('')+'</fieldset>'+
    '<label>Entrada (%)<input name="depositPercent" type="number" min="0" max="100" step="1" value="'+Number(closing.depositPercent||0)+'"></label>'+
    '<label>Chave PIX protegida<input name="pixKey" type="text" autocomplete="off" placeholder="'+(closing.pixConfigured?'Chave cadastrada — deixe vazio para manter':'Somente se o pagamento por PIX estiver habilitado')+'"></label>'+
    '<label>Nome do favorecido<input name="pixName" maxlength="120" value="'+e(closing.pixName||'')+'"></label>'+
    '<p class="form-note">O servidor guarda o PIX criptografado quando SOCIO_PAYMENT_CONFIG_KEY está configurado. A chave não aparece neste painel.</p>'+
    '<button type="submit" class="btn primary">Salvar regras de fechamento</button></form>':
    '<p>Modo de atendimento: '+(closing.mode==='proposal'?'Proposta supervisionada':'Transferência humana')+'</p>')+
    '</section></div></div>';
 }
 async function mount({api,toast,refresh,canManage=true}){
  const host=document.createElement('div');host.id='socioTrainingSuite';
  const target=document.querySelector('.socio-training-clean');
  if(!target)return;
  target.prepend(host);
  const load=async()=>{
   const [interview,proofs,closing,trial]=await Promise.all([
     api('/api/training/interview'),api('/api/training/proofs'),api('/api/training/closing'),api('/api/trial')]);
   if(!host.isConnected)return;
   host.innerHTML=sections({interview,proofs,closing,trial,canManage});
   bind();
  };
  const doAction=async(fn)=>{try{await fn();await load();}catch(error){toast(error.message||'Não foi possível concluir.',true);}};
  function bind(){
   host.querySelector('#trainInterviewStart')?.addEventListener('click',()=>doAction(async()=>{await api('/api/training/interview/start','POST',{});toast('Entrevista iniciada.');}));
   host.querySelectorAll('[data-interview-reset]').forEach(b=>b.addEventListener('click',()=>{
    if(!confirm('Recomeçar a entrevista e substituir as respostas não publicadas?'))return;
    doAction(()=>api('/api/training/interview/start','POST',{}));
   }));
   host.querySelector('#trainInterviewAnswer')?.addEventListener('submit',ev=>{ev.preventDefault();
    const form=ev.currentTarget,answer=String(new FormData(form).get('answer')||'');
    if(!answer.trim())return toast('Digite uma resposta. Se não souber, escreva não informado.',true);
    doAction(()=>api('/api/training/interview/answer','POST',{answer}));
   });
   let voiceRecorder=null,voiceStream=null,recordStopTimer=null;
   host.querySelector('#trainVoiceRecord')?.addEventListener('click',async ev=>{
    const button=ev.currentTarget,status=host.querySelector('#trainVoiceStatus');
    if(voiceRecorder&&voiceRecorder.state==='recording'){
     voiceRecorder.stop();
     button.disabled=true;
     if(status)status.textContent='Transcrevendo sua gravação...';
     return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
     toast('Este navegador não permite gravação. Você pode escrever sua resposta.',true);return;
    }
    try{
     const options=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
     if(!options)throw new Error('Formato de gravação não suportado neste navegador.');
     voiceStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
     const chunks=[];
     voiceRecorder=new MediaRecorder(voiceStream,{mimeType:options});
     voiceRecorder.ondataavailable=evt=>{if(evt.data?.size)chunks.push(evt.data);};
     voiceRecorder.onerror=()=>{toast('Gravação interrompida.',true);voiceStream?.getTracks().forEach(t=>t.stop());};
     voiceRecorder.onstop=async()=>{
      clearTimeout(recordStopTimer);
      voiceStream?.getTracks().forEach(t=>t.stop());
      const blob=new Blob(chunks,{type:voiceRecorder.mimeType||options});
      button.disabled=false;button.textContent='🎙 Gravar novamente';
      try{
       if(blob.size>3_500_000)throw new Error('Áudio excede 3,5 MB. Grave uma resposta menor.');
       const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
        reader.onerror=()=>reject(new Error('Não foi possível ler o áudio.'));reader.readAsDataURL(blob);
       });
       const result=await api('/api/training/transcribe','POST',{audioBase64:data,mime:blob.type});
       const field=host.querySelector('#trainInterviewText');if(field){field.value=result.text;field.focus();}
       if(status)status.textContent='Transcrição pronta. Revise o texto antes de avançar.';
      }catch(error){toast(error.message||'Falha na transcrição.',true);if(status)status.textContent='Você pode escrever a resposta manualmente.';}
     };
     voiceRecorder.start(200);
     button.textContent='Parar gravação';
     if(status)status.textContent='Gravando. Ao parar, o áudio será enviado para transcrição pelo Groq.';
     recordStopTimer=setTimeout(()=>{if(voiceRecorder?.state==='recording')voiceRecorder.stop();},60000);
    }catch(error){voiceStream?.getTracks().forEach(t=>t.stop());toast(error.message||'Microfone indisponível.',true);}
   });
   host.querySelector('#trainInterviewDraft')?.addEventListener('click',()=>doAction(async()=>{
    await api('/api/training/interview/draft','POST',{});
    toast('Markdown criado como rascunho. Revise e aprove na área abaixo.');
    if(typeof refresh==='function')await refresh();
   }));
   host.querySelector('#trainProofForm')?.addEventListener('submit',ev=>{ev.preventDefault();
    const form=ev.currentTarget,f=new FormData(form);
    doAction(async()=>{
     const files=await fileBase64(f.get('proofFile')?.size?f.get('proofFile'):null);
     await api('/api/training/proofs','POST',{kind:f.get('kind'),title:f.get('title'),description:f.get('description'),url:f.get('url'),...files});
     toast('Material cadastrado. Revise e aprove antes de utilizar.');
    });
   });
   host.querySelectorAll('[data-proof-action]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.proofAction,id=button.dataset.proofId;
    if(action==='delete'&&!confirm('Excluir este material?'))return;
    doAction(()=>action==='delete'?api('/api/training/proofs/'+id,'DELETE'):api('/api/training/proofs/'+id+'/'+action,'POST',{}));
   }));
   host.querySelector('#trainClosingForm')?.addEventListener('submit',ev=>{ev.preventDefault();
    const form=ev.currentTarget,d=new FormData(form);
    const body={mode:d.get('mode'),depositPercent:Number(d.get('depositPercent')),methods:d.getAll('methods'),pixName:d.get('pixName')};
    if(String(d.get('pixKey')||'').trim())body.pixKey=String(d.get('pixKey')).trim();
    doAction(async()=>{await api('/api/training/closing','PUT',body);toast('Política comercial salva com segurança.');});
   });
  }
  try{await load();}catch(error){if(host.isConnected)host.innerHTML='<p role="alert" class="form-error">Não foi possível abrir treinamento guiado: '+e(error.message)+'</p>';}
 }
 window.SocioTraining={mount};
})();
