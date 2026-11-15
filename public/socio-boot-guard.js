/* Independent fail-safe: if the main bundle fails before boot(), never leave
   a permanent full-page spinner concealing the sign-in form. */
(()=>{
 'use strict';
 const status=document.getElementById('socioBootStatus');
 if(!status)return;
 setTimeout(()=>{
  if(status.hidden)return;
  const login=document.getElementById('authScreen');
  const app=document.getElementById('appShell');
  if(!login?.classList.contains('hidden')||!app?.classList.contains('hidden')){
   status.hidden=true;
   return;
  }
  status.textContent='Não foi possível concluir o carregamento. ';
  const action=document.createElement('button');
  action.type='button';
  action.textContent='Recarregar Sócio';
  action.addEventListener('click',()=>location.reload());
  status.appendChild(action);
 },20000);
})();
