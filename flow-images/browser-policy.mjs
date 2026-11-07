const fail=()=>Object.assign(Error('Entrada do navegador inválida.'),{status:422});
function urlOf(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return null;return u;}catch{return null;}}
export function allowFlowNavigation(value){
 const u=urlOf(value);return !!u&&(['flow.google.com','accounts.google.com'].includes(u.hostname)||
  u.hostname==='labs.google'&&(u.pathname==='/fx'||u.pathname.startsWith('/fx/')||u.pathname.startsWith('/flow/'))||
  ['www.google.com','recaptcha.google.com','www.recaptcha.net'].includes(u.hostname)&&u.pathname.startsWith('/recaptcha/'));
}
export function allowFlowResource(value){
 const u=urlOf(value);return !!u&&(allowFlowNavigation(value)||
  ['googleapis.com','gstatic.com','googleusercontent.com','googlevideo.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)));
}
export function validateFlowInput(d){
 if(!d||typeof d!=='object')throw fail();
 const number=x=>typeof x==='number'&&Number.isFinite(x);
 if(d.kind==='click'&&number(d.x)&&number(d.y)&&d.x>=0&&d.x<1280&&d.y>=0&&d.y<800)return {kind:'click',x:d.x,y:d.y};
 if(d.kind==='text'&&typeof d.text==='string'&&d.text.length<=4096)return {kind:'text',text:d.text};
 if(d.kind==='key'&&['Enter','Tab','Shift+Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Escape','Control+a'].includes(d.key))return {kind:'key',key:d.key};
 if(d.kind==='scroll'&&number(d.delta)&&Math.abs(d.delta)<=2000)return {kind:'scroll',delta:d.delta};
 throw fail();
}
