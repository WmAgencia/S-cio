// Unit economics for traffic decisions.
// Derived only from the ticket and margin the owner states. When either is
// missing, no economic limit is produced and callers must not invent one.
export const ECONOMICS_VERSION='socio-account-economics-v1';

const integer=value=>{
 const n=Number(value);
 return Number.isInteger(n)&&n>0?n:null;
};
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})
 .format(Number(cents||0)/100);

export function computeAccountEconomics({ticketCents,marginPercent,targetCpaCents=null}={}){
 const ticket=integer(ticketCents);
 const margin=Number(marginPercent);
 const base={version:ECONOMICS_VERSION,valid:false,ticketCents:ticket,
  marginPercent:Number.isFinite(margin)?margin:null};
 if(ticket===null||ticket<100)
  return {...base,reason:'ticket_ausente',
   detail:'Informe o valor médio de uma venda (mínimo R$ 1,00) para calcular o custo máximo por venda.'};
 if(!Number.isFinite(margin)||margin<=0||margin>100)
  return {...base,reason:'margem_invalida',
   detail:'Informe a margem em porcentagem, maior que 0 e no máximo 100.'};
 const share=margin/100;
 // Spending more than the gross profit of a sale loses money on every sale.
 const maxCpaCents=Math.round(ticket*share);
 const breakEvenRoas=Math.round((1/share)*100)/100;
 const explicit=integer(targetCpaCents);
 const target=explicit!==null&&explicit<=maxCpaCents?explicit:Math.round(maxCpaCents*0.8);
 // A result this far above target is treated as failing, the practitioner norm.
 const killCpaCents=Math.round(target*1.3);
 return {...base,valid:true,
  ticketCents:ticket,marginPercent:margin,
  grossProfitPerSaleCents:maxCpaCents,
  maxCpaCents,breakEvenRoas,
  targetCpaCents:target,killCpaCents,
  targetSource:explicit!==null&&explicit===target?'informado':'padrao_80_da_margem',
  profitPerSaleAtTargetCents:maxCpaCents-target};
}

export function classifyCpa({cpaCents,economics}={}){
 if(!economics?.valid)return {verdict:'unknown',reason:'sem_economia'};
 if(cpaCents===null||cpaCents===undefined||cpaCents==='')
  return {verdict:'unknown',reason:'sem_vendas_confirmadas'};
 const cpa=Number(cpaCents);
 if(!Number.isFinite(cpa)||cpa<0)return {verdict:'unknown',reason:'sem_vendas_confirmadas'};
 if(cpa<=economics.targetCpaCents)
  return {verdict:'on_target',limitCents:economics.targetCpaCents,
   detail:'Custo por venda dentro do alvo de '+money(economics.targetCpaCents)+'.'};
 if(cpa<=economics.killCpaCents)
  return {verdict:'over_target',limitCents:economics.targetCpaCents,
   detail:'Custo por venda acima do alvo de '+money(economics.targetCpaCents)+
    ' e abaixo do limite de corte de '+money(economics.killCpaCents)+'.'};
 return {verdict:'unprofitable',limitCents:economics.killCpaCents,
  detail:'Custo por venda acima de '+money(economics.killCpaCents)+
   ', maior que a margem da venda. Cada venda nesse custo dá prejuízo.'};
}

export function formatAccountEconomics(economics){
 if(!economics?.valid)return economics?.detail||
  'Sem valor de venda e margem não há limite de custo por venda. Cliques não comprovam vendas.';
 return 'Com venda média de '+money(economics.ticketCents)+' e margem de '+
  economics.marginPercent+'%, o lucro bruto por venda é '+money(economics.grossProfitPerSaleCents)+
  '. O ROAS de equilíbrio é '+economics.breakEvenRoas.toFixed(2)+'x. Custo máximo por venda '+
  money(economics.maxCpaCents)+'; alvo '+money(economics.targetCpaCents)+'; corte a partir de '+
  money(economics.killCpaCents)+'.';
}
