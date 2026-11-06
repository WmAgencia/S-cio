const META_DOMAINS=['facebook.com','facebook.net','fbcdn.net','fbsbx.com','instagram.com','cdninstagram.com','meta.com'];
const RECAPTCHA_HOSTS=new Set(['www.google.com','recaptcha.google.com','www.recaptcha.net','www.gstatic.com']);
function parse(value){
 try{const url=new URL(value);if(url.username||url.password||url.port&&url.port!=='443')return null;return url;}catch{return null;}
}
export function isMetaURL(value){
 const url=parse(value);
 return !!url&&['https:','wss:'].includes(url.protocol)&&META_DOMAINS.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain));
}
export function allowRemoteResource(value){
 if(isMetaURL(value))return true;
 const url=parse(value);
 // Load the provider's actual challenge; never replace keys, responses or verification.
 return !!url&&url.protocol==='https:'&&RECAPTCHA_HOSTS.has(url.hostname)&&url.pathname.startsWith('/recaptcha/');
}
