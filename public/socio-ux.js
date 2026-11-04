/* Sócio — single QR connection modal shared by dashboard and WhatsApp inbox.
   Real data from tenant-scoped WA-AKG routes; never fake/retain a QR code. */
(function(){
'use strict';
let active=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qrOk=value=>typeof value==='string'&&value.length<350000&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
function close(){
 if(!active)return;
 const x=active;active=null;
 clearTimeout(x.timer);x.overlay.remove();
 document.removeEventListener('keydown',x.keyHandler);
 x.previous?.focus?.();
}
async function openQr({api,toast,onConnected,canManage=true}={}){
 if(!canManage){toast('Somente o proprietário ou administrador pode conectar números.',true);return;}
 close();
 const previous=document.activeElement;
 const el=document.createElement('div');
 el.id='socioQrModal';el.className='socio-popup-backdrop';
 el.innerHTML='<section class="socio-popup-surface socio-qr-popup" role="dialog" aria-modal="true" aria-labelledby="socioQrHeading">'+
  '<div class="socio-popup-header"><div><small>CANAL DA EMPRESA</small><h2 id="socioQrHeading">Conectar WhatsApp</h2>'+
  '<p>Conecte seu número escaneando o QR Code no celular.</p></div>'+
  '<button type="button" class="socio-popup-close" data-qr-close aria-label="Fechar janela">×</button></div>'+
  '<div class="socio-qr-connected" id="socioQrConnected"></div>'+
  '<form class="socio-qr-form" id="socioQrForm"><label>Nome do WhatsApp<input name="label" required maxlength="90" placeholder="Ex.: Atendimento principal" autocomplete="off"></label>'+
  '<button type="submit" class="btn primary" id="socioQrCreate">Gerar QR Code</button></form>'+
  '<div class="socio-qr-live hidden" id="socioQrLive" aria-live="polite"><div class="socio-qr-steps">'+
  '<span>1. Abra o WhatsApp no celular</span><span>2. Vá em Dispositivos conectados</span>'+
  '<span>3. Escolha Conectar dispositivo e escaneie o QR</span></div>'+
  '<div class="socio-qr-image-wrap"><img id="socioQrImage" alt="QR Code temporário para conectar o WhatsApp" class="hidden"></div>'+
  '<p id="socioQrStatus" role="status">Preparando conexão...</p>'+
  '</div></section>';
 document.body.appendChild(el);
 const x={overlay:el,previous,timer:null,keyHandler:null};active=x;
 const q=selector=>el.querySelector(selector);
 const feedback=(s,error=false)=>{q('#socioQrStatus').textContent=s;q('#socioQrStatus').classList.toggle('error',error);};
 const stop=()=>{clearTimeout(x.timer);x.timer=null;};
 const poll=async(channelId)=>{
  if(active!==x)return;
  try{
   const status=await api('/api/waakg/channels/'+encodeURIComponent(channelId)+'/status');
   if(active!==x)return;
   if(status.connected){
    stop();q('#socioQrImage').classList.add('hidden');feedback('WhatsApp conectado e verificado!');
    toast('WhatsApp conectado com sucesso.');
    if(typeof onConnected==='function')await onConnected();
    close();return;
   }
   const qr=await api('/api/waakg/channels/'+encodeURIComponent(channelId)+'/qr');
   if(active!==x)return;
   const image=q('#socioQrImage');
   if(qr?.ready&&qrOk(qr.image)){
    image.src=qr.image;image.classList.remove('hidden');
    feedback('Escaneie o QR Code. Ele poderá ser atualizado automaticamente.');
   }else{image.classList.add('hidden');feedback('Aguardando o QR Code do gateway...');}
  }catch(err){
   if(active===x)feedback('Conexão indisponível: '+String(err.message||'Tente novamente.'),true);
  }
  if(active===x)x.timer=setTimeout(()=>poll(channelId),3000);
 };
 const linked=await api('/api/waakg/channels').catch(()=>[]);
 if(active!==x)return;
 const pending=Array.isArray(linked)?linked.filter(c=>c.status!=='connected'):[];
 const connected=Array.isArray(linked)?linked.filter(c=>c.status==='connected'):[];
 q('#socioQrConnected').innerHTML=connected.length?'<h3>WhatsApps conectados</h3>'+connected.map(c=>
   '<div class="socio-qr-current"><span class="socio-green-dot"></span><strong>'+esc(c.label||'WhatsApp')+
   '</strong><small>'+esc(c.phone||'')+'</small></div>').join(''):'';
 if(pending.length){
  const section=document.createElement('div');section.className='socio-qr-pending';
  section.innerHTML='<label>Conexões aguardando QR<select id="socioPending">'+
   pending.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.label||'WhatsApp pendente')+'</option>').join('')+
   '</select></label><button type="button" class="btn soft" data-qr-resume>Mostrar QR pendente</button>';
  q('#socioQrForm').before(section);
  section.querySelector('[data-qr-resume]').addEventListener('click',()=>{
   stop();q('#socioQrLive').classList.remove('hidden');void poll(q('#socioPending').value);
  });
 }
 q('#socioQrForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget;
  const label=form.elements.label.value.trim();if(!label)return;
  const btn=q('#socioQrCreate');btn.disabled=true;
  try{
   const channel=await api('/api/waakg/channels/connect','POST',{label});
   if(active!==x)return;
   stop();q('#socioQrLive').classList.remove('hidden');feedback('Preparando QR Code...');
   await poll(channel.id);
  }catch(err){if(active===x){toast(String(err.message||'Não foi possível criar a sessão.'),true);btn.disabled=false;}}
 });
 el.addEventListener('click',ev=>{if(ev.target===el||ev.target.closest('[data-qr-close]'))close();});
 x.keyHandler=ev=>{if(ev.key==='Escape')close();
  else if(ev.key==='Tab'){
   const focusable=[...el.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(v=>v.offsetParent!==null);
   if(focusable.length){const first=focusable[0],last=focusable.at(-1);
    if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus();}
    else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus();}
   }
  }
 };
 document.addEventListener('keydown',x.keyHandler);
 q('[data-qr-close]').focus();
}
// Accessible escape/Tab behavior for the product and master company dialogs.
document.addEventListener('keydown',ev=>{
 const popup=document.querySelector('#productModal:not(.hidden),#companyModal:not(.hidden)');
 if(!popup)return;
 if(ev.key==='Escape'){
  ev.preventDefault();
  (popup.id==='productModal'?
   popup.querySelector('#closeProductModal'):
   popup.querySelector('#companyClose'))?.click();
  return;
 }
 if(ev.key!=='Tab')return;
 const controls=[...popup.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
  .filter(x=>x.getClientRects().length>0);
 if(!controls.length)return;
 if(ev.shiftKey&&document.activeElement===controls[0]){ev.preventDefault();controls.at(-1).focus();}
 else if(!ev.shiftKey&&document.activeElement===controls.at(-1)){ev.preventDefault();controls[0].focus();}
});
window.SocioUX={openQr,close};
})();
