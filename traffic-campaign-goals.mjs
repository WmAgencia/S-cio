import {requirePermission} from './team-permissions.mjs';
import {resolveSelectedOfficialAccount} from './meta-official.mjs';
import {readAdsTool} from './meta-ads-tools.mjs';

const invalid=message=>Object.assign(new Error(message),{status:422});
const objectives=new Set(['qualified','sales']);
const validMoney=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000000&&Math.abs(value*100-Math.round(value*100))<0.0001;
export function validateCampaignGoal({objective,dailyBudget,targetCost}){
 if(!objectives.has(objective)||!validMoney(dailyBudget)||!validMoney(targetCost))
  throw invalid('Escolha uma meta e informe valores positivos com até duas casas decimais.');
 return {objective,dailyBudget,targetCost};
}
export async function campaignGoals(pool,actor,input=null,{resolve=resolveSelectedOfficialAccount,read=readAdsTool}={}){
 requirePermission(actor,input?'marketing.manage':'marketing.read');
 const account=await resolve(pool,actor);
 const tenant=actor.active_tenant_id;
 const campaigns=await read(pool,actor,'campaigns',{});
 if(input){
  const goal=validateCampaignGoal(input);
  if(!campaigns.items.some(c=>String(c.id)===input.campaignId))
   throw invalid('Selecione uma campanha da conta autorizada.');
  await pool.query(`INSERT INTO traffic_campaign_goals(tenant_id,account_id,campaign_id,objective,daily_budget,target_cost)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,account_id,campaign_id) DO UPDATE SET
   objective=EXCLUDED.objective,daily_budget=EXCLUDED.daily_budget,target_cost=EXCLUDED.target_cost,updated_at=now()`,
   [tenant,account.id,input.campaignId,goal.objective,goal.dailyBudget,goal.targetCost]);
 }
 const result=await pool.query('SELECT campaign_id,objective,daily_budget,target_cost FROM traffic_campaign_goals WHERE tenant_id=$1 AND account_id=$2',[tenant,account.id]);
 return {currency:account.currency,goals:result.rows,campaigns:campaigns.items.map(c=>({id:String(c.id),name:c.name}))};
}
