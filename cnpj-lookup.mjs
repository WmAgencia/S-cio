/* Company lookup only: publicly available CNPJ registration fields from BrasilAPI.
   Reject invalid identifiers before network calls; never retrieve the QSA/CPF data. */
export const normalizeCnpj=value=>String(value??'').toUpperCase().replace(/[^0-9A-Z]/g,'');
export function validCnpj(value){
 const c=normalizeCnpj(value);
 if(!/^\d{14}$/.test(c)||/^(.)\1{13}$/.test(c))return false;
 const digit=(len)=>{
  const weights=len===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
  const sum=weights.reduce((n,w,i)=>n+w*Number(c[i]),0);
  const mod=sum%11;
  return mod<2?0:11-mod;
 };
 return digit(12)===Number(c[12])&&digit(13)===Number(c[13]);
}
const str=(s,n=130)=>String(s??'').trim().slice(0,n);
export function mapCompanyRecord(d,cnpj){
 if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Resposta cadastral inválida.');
 return {
  cnpj,legalName:str(d.razao_social,200),tradeName:str(d.nome_fantasia,200),
  company:str(d.nome_fantasia||d.razao_social,120),
  email:str(d.email,150),phone:str(d.ddd_telefone_1||d.ddd_telefone_2,30),
  status:str(d.descricao_situacao_cadastral,70),
  primaryActivity:str(d.cnae_fiscal_descricao,150),
  address:{
   street:str(d.logradouro,130),number:str(d.numero,20),additional:str(d.complemento,100),
   neighborhood:str(d.bairro,80),city:str(d.municipio,80),
   state:str(d.uf,2),postalCode:str(d.cep,12)
  },source:'BrasilAPI / dados públicos de cadastro',
 };
}
export async function lookupCompany(cnpj,{fetchImpl=fetch}={}){
 const normalized=normalizeCnpj(cnpj);
 if(!validCnpj(normalized))throw Object.assign(new Error('CNPJ inválido; confira os 14 dígitos.'),{status:422});
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetchImpl('https://brasilapi.com.br/api/cnpj/v1/'+normalized,{
   headers:{Accept:'application/json'},signal:controller.signal});
  if(response.status===404)throw Object.assign(new Error('CNPJ não encontrado na consulta pública.'),{status:404});
  if(response.status===429)throw Object.assign(new Error('A consulta por CNPJ está limitada. Tente novamente mais tarde.'),{status:503});
  if(!response.ok)throw Object.assign(new Error('Consulta pública indisponível no momento.'),{status:503});
  const data=await response.json();
  const result=mapCompanyRecord(data,normalized);
  if(!result.legalName)throw Object.assign(new Error('Registro público retornou dados incompletos.'),{status:503});
  return result;
 }catch(error){
  if(error.name==='AbortError')throw Object.assign(new Error('Consulta do CNPJ excedeu o tempo limite.'),{status:503});
  if(error.status)throw error;
  throw Object.assign(new Error('Não foi possível consultar este CNPJ. Preencha manualmente.'),{status:503});
 }finally{clearTimeout(timeout);}
}
