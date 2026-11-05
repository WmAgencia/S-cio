(()=>{'use strict';
const form=document.querySelector('#uploadForm'),input=document.querySelector('#asset'),status=document.querySelector('#status');
if(!form||!input||!status)return;
const id=location.pathname.match(/^\/ads-upload\/([0-9a-f-]{36})$/i)?.[1];
const query=new URLSearchParams(location.search),expires=query.get('expires'),signature=query.get('signature');
form.addEventListener('submit',async event=>{
 event.preventDefault();const file=input.files?.[0],button=form.querySelector('button');
 if(!id||!expires||!signature||!file){status.textContent='Selecione um arquivo válido.';return;}
 if(!/\.(mp4|mov)$/i.test(file.name)||file.size>90*1024*1024||file.size<512){
  status.textContent='Envie um MP4 ou MOV de até 90 MB.';return;
 }
 button.disabled=true;status.textContent='Enviando vídeo com segurança…';
 try{
  const response=await fetch('/ads-upload/'+id+'?'+new URLSearchParams({expires,signature}),{
   method:'POST',headers:{'Content-Type':file.name.toLowerCase().endsWith('.mov')?'video/quicktime':'video/mp4'},
   body:file,credentials:'omit',cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Falha no envio.');
  status.textContent='Enviado! Vídeo pronto na biblioteca privada. Volte ao chat para continuar.';
  input.disabled=true;button.hidden=true;
 }catch(e){status.textContent=e.message||'Falha ao enviar o vídeo.';}
 finally{button.disabled=false;}
});
})();
