// Browser mutations (POST/PUT/PATCH/DELETE) must come from this deployment.
//
// The Sócio is reachable through more than one host: the Railway service
// itself and the proxy that fronts the custom domain. A proxy rewrites the Host
// header, so the Origin a browser sends legitimately differs from the Host the
// Node process sees. Comparing the two alone rejects every login and every
// write coming from the custom domain.
//
// The rule stays strict: an Origin is accepted only when it is the Host header,
// the host the outer proxy reports, or a first-party host configured for this
// installation. Any other Origin is treated as CSRF.

const BUILT_IN_HOSTS=[
 'socio.consecom.com.br',
 's-cio.vercel.app',
 'socio-app-production-762c.up.railway.app'
];

export function firstPartyHosts(env=process.env){
 const hosts=new Set(BUILT_IN_HOSTS);
 const add=value=>{
  let host='';
  try{host=new URL(String(value||'').trim()).host;}catch{host='';}
  if(host)hosts.add(host.toLowerCase());
 };
 add(env.SOCIO_PUBLIC_URL);
 add(env.RAILWAY_PUBLIC_DOMAIN?('https://'+env.RAILWAY_PUBLIC_DOMAIN):'');
 for(const item of String(env.SOCIO_ALLOWED_ORIGINS||'').split(','))add(item);
 return hosts;
}

export const allowedOrigin=(origin,{host,xForwardedHost,hosts}={})=>{
 if(!origin)return true;
 let parsed;
 try{parsed=new URL(origin);}catch{return false;}
 if(parsed.protocol!=='https:'&&parsed.protocol!=='http:')return false;
 const target=parsed.host.toLowerCase();
 const seen=[host,...String(xForwardedHost||'').split(',')]
  .map(value=>String(value||'').trim().toLowerCase()).filter(Boolean);
 if(!seen.includes(target)&&!hosts?.has(target))return false;
 // Everything first-party is HTTPS. A plain-HTTP Origin is only tolerated on a
 // loopback development host, so a downgraded request is never trusted.
 if(parsed.protocol==='http:'&&!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(target))return false;
 return true;
};

export function createOriginGuard(env=process.env){
 const hosts=firstPartyHosts(env);
 return function sameOrigin(req){
  const denied=()=>Object.assign(new Error('Origem não permitida.'),{status:403});
  const origin=req.headers?.origin;
  if(origin&&!allowedOrigin(origin,{
   host:req.headers?.host,
   xForwardedHost:req.headers?.['x-forwarded-host'],
   hosts
  }))throw denied();
  // Sec-Fetch-Site is set by the browser itself and cannot be forged from a
  // page; a cross-site value means another site started this request.
  if(req.headers?.['sec-fetch-site']==='cross-site')throw denied();
 };
}
