// Turns the owner's business objective into the Meta campaign configuration.
// The owner speaks in outcomes ("vender no WhatsApp", "vender pelo site",
// "aparecer mais"); this module decides objective, optimization and structure
// and explains the choice in plain Portuguese.
const GOALS=Object.freeze({
 sales_whatsapp:{
  objective:'OUTCOME_ENGAGEMENT',optimizationGoal:'CONVERSATIONS',
  objectiveLabel:'Conversas no WhatsApp',
  objectiveWhy:'a Meta mostra o anúncio para quem tem mais chance de chamar você no WhatsApp',
  adLabel:'o botão "Enviar mensagem" abre direto a conversa no seu WhatsApp',
  funnelLabel:'esta é a campanha principal. Quando ela juntar gente que chamou no WhatsApp, criamos uma segunda campanha de remarketing para quem não fechou.'
 },
 sales_site:{
  objective:'OUTCOME_TRAFFIC',optimizationGoal:'LANDING_PAGE_VIEWS',
  objectiveLabel:'Vendas pelo site',
  objectiveWhy:'a Meta leva ao site quem demonstra intenção de comprar; quando o Pixel tiver histórico, passamos a otimizar direto por venda',
  adLabel:'o botão "Saiba mais" abre o link do site',
  funnelLabel:'esta é a campanha principal. Quando o Pixel juntar dados de quem visitou sem comprar, criamos uma segunda campanha de remarketing.'
 },
 traffic:{
  objective:'OUTCOME_TRAFFIC',optimizationGoal:'LINK_CLICKS',
  objectiveLabel:'Visitas no site',
  objectiveWhy:'o foco é trazer gente para a sua página pelo menor custo por clique',
  adLabel:'o botão "Saiba mais" abre o link do site',
  funnelLabel:'primeiro trazemos visitas. Quando o Pixel juntar dados, criamos a campanha de remarketing para quem já conheceu você.'
 },
 awareness:{
  objective:'OUTCOME_AWARENESS',optimizationGoal:'REACH',
  objectiveLabel:'Reconhecimento da marca',
  objectiveWhy:'a Meta entrega o anúncio para o maior número de pessoas da sua região pelo menor custo',
  adLabel:'o anúncio apresenta sua marca e leva para o seu link',
  funnelLabel:'depois do reconhecimento, a próxima campanha converte quem já conheceu você.'
 }
});
function goalOf(brief){
 const destination=brief.destination==='whatsapp'?'whatsapp':brief.destination==='website'?'website':null;
 let goal=brief.goal;
 if(!GOALS[goal])goal=destination==='whatsapp'?'sales_whatsapp':destination==='website'?'traffic':null;
 if(goal==='sales_whatsapp'&&destination==='website')goal='sales_site';
 if(goal==='sales_site'&&destination==='whatsapp')goal='sales_whatsapp';
 return goal&&GOALS[goal]?goal:null;
}
function audienceLabel(brief){
 const place=brief.countryCode?'todo o Brasil':brief.cityName||'a sua região';
 const genders=Array.isArray(brief.genders)&&brief.genders.length===1?
  (brief.genders[0]===1?'homens':'mulheres'):'todos os gêneros';
 return [place,genders,'18 a 65 anos','posicionamentos automáticos no Feed, Stories e Reels'].join(' · ');
}
export function campaignDesign(brief={}){
 const goal=goalOf(brief);
 if(!goal)return null;
 const g=GOALS[goal];
 return {
  goal,objective:g.objective,optimizationGoal:g.optimizationGoal,
  objectiveLabel:g.objectiveLabel,objectiveWhy:g.objectiveWhy,
  budgetMode:'adset',
  structureLabel:'uma campanha com um conjunto de anúncios e um anúncio. A verba fica no conjunto (ABO); CBO só compensa quando houver dois ou mais públicos para a Meta distribuir.',
  audienceLabel:audienceLabel(brief),
  budgetLabel:brief.dailyBudgetCents?
   'R$ '+(brief.dailyBudgetCents/100).toFixed(2).replace('.',',')+' por dia, com cobrança por impressão.':'orçamento diário a definir.',
  adLabel:g.adLabel,funnelLabel:g.funnelLabel
 };
}
export function planExplanation(brief={},design){
 if(!design)return null;
 const media=brief.videoId?'o vídeo que você enviou':brief.imageHash?'a foto que você enviou':brief.imageName||'o criativo que você vai enviar';
 const destination=brief.destination==='whatsapp'?'o WhatsApp':'o site';
 return 'Montei o plano completo da campanha de '+(brief.category||'seu produto')+':\n'+
  '• Objetivo: '+design.objectiveLabel+' — '+design.objectiveWhy+'.\n'+
  '• Estrutura: '+design.structureLabel+'\n'+
  '• Público: '+design.audienceLabel+'.\n'+
  '• Verba: '+design.budgetLabel+'\n'+
  '• O anúncio usa '+media+', '+design.adLabel+', e leva para '+destination+'.\n'+
  '• Funil: '+design.funnelLabel+'\n';
}
