// One 7-day trial per business identity. Claims are stored as HMAC digests so
// the database never holds a raw CPF, CNPJ, phone or e-mail for this purpose.
import {createHmac} from 'node:crypto';

export const TRIAL_DAYS=7;

const digits=value=>String(value??'').replace(/\D/g,'');

export function normalizeTaxId(value){return digits(value);}

export function validCpf(value){
 const c=digits(value);
 if(!/^\d{11}$/.test(c)||/^(.)\1{10}$/.test(c))return false;
 const digit=length=>{
  let sum=0;
  for(let i=0;i<length;i++)sum+=Number(c[i])*(length+1-i);
  const mod=(sum*10)%11;
  return mod===10?0:mod;
 };
 return digit(9)===Number(c[9])&&digit(10)===Number(c[10]);
}

export function taxIdType(value){
 const c=normalizeTaxId(value);
 return c.length===14?'cnpj':c.length===11?'cpf':null;
}

export function trialClaimSecret(env=process.env){
 const key=env.SOCIO_TRIAL_HASH_KEY||env.CHANNEL_ENCRYPTION_KEY||'';
 if(key.length<16)throw Object.assign(
  new Error('Cadastro de teste indisponível: configure SOCIO_TRIAL_HASH_KEY.'),{status:503});
 return key;
}

export function trialClaimDigest(kind,value,{env=process.env}={}){
 const secret=trialClaimSecret(env);
 return createHmac('sha256',secret).update(kind+'\0'+value).digest('hex');
}

export function trialClaims({taxId,phone,email}={},{env=process.env}={}){
 const claims=[];
 const tax=normalizeTaxId(taxId);
 if(tax)claims.push({kind:'tax_id',value:tax});
 const digitsPhone=digits(phone);
 if(digitsPhone)claims.push({kind:'phone',value:digitsPhone});
 const mail=String(email??'').trim().toLowerCase();
 if(mail)claims.push({kind:'email',value:mail});
 return claims.map(claim=>({...claim,digest:trialClaimDigest(claim.kind,claim.value,{env})}));
}

// Caller owns the transaction and must have inserted the tenant row first.
// A conflict leaves the claim rows written so far in place: they belong to the
// tenant being created, and the transaction decides whether it survives.
export async function claimTrial(client,tenantId,identity,{env=process.env}={}){
 const claims=trialClaims(identity,{env});
 if(!claims.length)return {granted:true,conflicts:[]};
 const conflicts=[];
 for(const claim of claims){
  const result=await client.query(
   'INSERT INTO socio_trial_claims(kind,value_hash,tenant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING kind',
   [claim.kind,claim.digest,tenantId]);
  if(!result.rowCount)conflicts.push(claim.kind);
 }
 return {granted:conflicts.length===0,conflicts};
}

export function trialEndFrom(now=new Date()){
 return new Date(new Date(now).getTime()+TRIAL_DAYS*86400000);
}

export function readTrial(tenant,now=new Date()){
 const start=new Date(tenant.created_at||now);
 const endsAt=tenant.trial_ends_at?new Date(tenant.trial_ends_at):trialEndFrom(start);
 const remaining=Math.max(0,Math.ceil((endsAt-new Date(now))/86400000));
 return {endsAt:endsAt.toISOString(),calendarExpired:new Date(now)>=endsAt,daysRemaining:remaining,
  granted:tenant.trial_ends_at?remaining>0:true};
}
