export const PRODUCTION_ORIGIN='https://socio-app-production-762c.up.railway.app';
export function parseConnectionLink(value,{allowLocalTest=false}={}){
 const link=new URL(value);
 if(link.protocol!=='socio-meta:'||link.hostname!=='connect'||link.username||link.password||link.hash||link.pathname&&link.pathname!=='/')throw Error('Link do conector inválido.');
 const server=new URL(link.searchParams.get('server')||'');
 const local=allowLocalTest&&server.protocol==='http:'&&['127.0.0.1','localhost'].includes(server.hostname);
 if((server.origin!==PRODUCTION_ORIGIN&&!local)||server.username||server.password||server.pathname!=='/'||server.search||server.hash)throw Error('Servidor de conexão não autorizado.');
 const code=link.searchParams.get('code');if(!/^[a-f0-9]{64}$/.test(code||''))throw Error('Código inválido.');
 return {server:server.origin,code};
}
export async function connectorRequest(server,path,data,token,fetchImpl=fetch){
 if(!/^\/api\/meta-connector\/(pair|heartbeat|poll|result)$/.test(path))throw Error('Rota de conector inválida.');
 const response=await fetchImpl(server+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Object.assign(Error(response.status===401||response.status===403?'Conexão recusada ou revogada. Conecte novamente pelo Sócio.':'Sócio temporariamente indisponível.'),{status:response.status});
 const text=await response.text();if(text.length>500000)throw Error('Resposta muito grande.');return JSON.parse(text);
}
