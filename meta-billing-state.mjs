// Deterministic checks for observations from an isolated Meta billing browser.
// No arbitrary page text or manually entered number is accepted as account money.
const fail=msg=>Object.assign(new Error(msg),{status:422});
export function topupAmount(value){
 if(!Number.isSafeInteger(value)||value<100||value>10000000)
  throw fail('Informe um valor de R$ 1,00 a R$ 100.000,00. A Meta valida os limites finais.');
 return value;
}
export function parseObservedMetaBalance({url,body,accountId,accountName,currency='BRL',observedAt=new Date().toISOString()}){
 let u;try{u=new URL(url);}catch{throw fail('Página de faturamento inválida.');}
 if(u.protocol!=='https:'||!['adsmanager.facebook.com','business.facebook.com'].includes(u.hostname)||
  !u.pathname.includes('/billing_hub/')||!/^act_[0-9]{4,30}$/.test(accountId||'')||
  u.searchParams.get('asset_id')!==accountId.slice(4))
  throw fail('A página de faturamento não corresponde à conta selecionada.');
 if(currency!=='BRL')throw fail('A leitura assistida está disponível apenas para contas BRL.');
 if(typeof accountName!=='string'||!accountName.trim()||accountName.length>200)throw fail('Conta não identificada.');
 const lines=String(body||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(!lines.includes(accountName.trim()))throw fail('O nome da conta de anúncios não foi confirmado na Meta.');
 const header=lines.indexOf('Fundos disponíveis');
 if(header<0)throw fail('Saldo não identificado. Conclua o login e as verificações da Meta.');
 const end=lines.indexOf('Como você pagará',header+1);
 if(end<0||end-header>15)throw fail('Formato do faturamento não reconhecido.');
 const values=lines.slice(header+1,end).filter(line=>/^R\$\s*(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),[0-9]{2}$/.test(line));
 if(values.length!==1)throw fail('Não foi possível identificar um saldo único na Meta.');
 const parts=values[0].replace(/^R\$\s*/,'').replace(/\./g,'').split(',');
 const amount=Number(parts[0])*100+Number(parts[1]);
 if(!Number.isSafeInteger(amount)||amount<0||amount>1e12)throw fail('Saldo fora do formato permitido.');
 const time=Date.parse(observedAt);
 if(!Number.isFinite(time)||time>Date.now()+60000||Date.now()-time>120000)throw fail('A observação de saldo expirou.');
 return {accountId,currency,availableFundsMinor:amount,source:'meta_billing_browser',observedAt:new Date(time).toISOString(),
  validUntil:new Date(time+15*60000).toISOString()};
}
export function assessMetaFunds(observation,{dailySpendMinor=null,minimumMinor=3000,now=Date.now()}={}){
 const amount=observation?.availableFundsMinor;
 const fresh=Number.isSafeInteger(amount)&&amount>=0&&observation.currency==='BRL'&&
  Number.isFinite(Date.parse(observation.observedAt))&&Date.parse(observation.observedAt)<=now+60000&&
  Date.parse(observation.validUntil)>now&&Date.parse(observation.validUntil)-Date.parse(observation.observedAt)<=15*60000;
 if(!fresh)return {state:'unknown',daysLeft:null,reason:'Saldo ausente ou desatualizado. Atualize o faturamento.'};
 const daily=Number.isFinite(dailySpendMinor)&&dailySpendMinor>0?dailySpendMinor:null;
 const days=daily===null?null:amount/daily;
 const state=amount===0||days!==null&&days<=1?'critical':
  amount<=minimumMinor||days!==null&&days<=3?'low':'ok';
 return {state,daysLeft:days===null?null:Math.floor(days*10)/10,
  availableFundsMinor:amount,currency:'BRL',observedAt:observation.observedAt,validUntil:observation.validUntil,
  reason:state==='critical'?'A verba está acabando. Verifique a recarga.':
   state==='low'?'O saldo está baixo. Planeje a próxima recarga.':null};
}
