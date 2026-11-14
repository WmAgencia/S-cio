// Result counting from Meta `actions`. One taxonomy for the funnel ladder and
// the traffic manager, so both judge the same event by the same name.
export const RESULT_TYPES=Object.freeze({
 purchase:Object.freeze(['purchase','omni_purchase','offsite_conversion.fb_pixel_purchase']),
 conversation:Object.freeze(['onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection']),
 lead:Object.freeze(['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead'])
});

export const RESULT_LABELS=Object.freeze({
 purchase:'Venda',conversation:'Conversa iniciada',lead:'Lead'
});

const countFor=(list,types)=>{
 for(const type of types){
  const found=list.find(item=>item&&item.action_type===type);
  if(found){
   const value=Number(found.value);
   if(Number.isFinite(value)&&value>=0)return value;
  }
 }
 return 0;
};

// A row can report more than one kind. It is counted once, by the strongest
// result it produced: purchase over conversation over lead.
export function resultCounts(row={}){
 const list=Array.isArray(row?.actions)?row.actions:[];
 const purchase=countFor(list,RESULT_TYPES.purchase);
 const conversation=countFor(list,RESULT_TYPES.conversation);
 const lead=countFor(list,RESULT_TYPES.lead);
 const kind=purchase>0?'purchase':conversation>0?'conversation':lead>0?'lead':null;
 return {purchase,conversation,lead,kind,
  events:kind==='purchase'?purchase:kind==='conversation'?conversation:kind==='lead'?lead:0};
}

export function pickResultKind({purchase=0,conversation=0,lead=0}={}){
 if(purchase>0)return 'purchase';
 if(conversation>0)return 'conversation';
 if(lead>0)return 'lead';
 return null;
}

export function costPerResultCents(spendCents,events){
 const missing=spendCents===null||spendCents===undefined||spendCents==='';
 const spend=missing?NaN:Number(spendCents),n=Number(events);
 if(!Number.isFinite(spend)||spend<0||!Number.isFinite(n)||n<=0)return null;
 return Math.round(spend/n);
}
