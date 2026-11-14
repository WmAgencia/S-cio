// Turns the owner's spoken product description into a reviewable draft.
// The model only extracts facts; catalog.mjs validators decide what is accepted,
// and nothing is saved until the person confirms the form.
import {brainResponse} from './ai-brain.mjs';
import {validateProduct,validateVariants} from './catalog.mjs';

const fault=message=>Object.assign(new Error(message),{status:422});

const draftInstructions=[
 'Você organiza a fala de um dono de loja em um cadastro de produto para revisão.',
 'Responda SOMENTE com JSON válido, sem comentários e sem bloco de código, neste formato:',
 '{"name":"nome do produto","description":"descrição objetiva","priceCents":0,"compareAtPriceCents":null,"sku":null,"stockQuantity":null,"variants":[{"name":"Cor · Rosa","priceCents":0,"stockQuantity":null}]}',
 'Regras:',
 '- Use apenas o que foi dito. Nunca invente preço, estoque, SKU ou característica.',
 '- priceCents é o preço em centavos inteiros (ex.: R$ 1.299,90 vira 129990). Sem preço citado, use 0.',
 '- stockQuantity é o estoque total em unidades inteiras; null quando não foi dito.',
 '- Cada cor, tamanho ou modelo citado vira uma variação com o mesmo preço do produto, salvo preço diferente dito na fala.',
 '- O nome da variação segue o formato "Cor · Rosa", "Tamanho · M" ou "Modelo · ...".',
 '- description reúne, de forma curta e fiel, as características citadas (modelo, memória, medidas etc.).',
 '- Não inclua campos fora do formato.'
].join('\n');

function centsFromModel(value,fallback){
 if(typeof value==='string'){
  const parsed=Number(value.replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.'));
  value=Number.isFinite(parsed)?parsed:null;
 }
 if(!Number.isFinite(value)||value<0)return fallback;
 if(!Number.isInteger(value))return Math.round(value*100);
 return value;
}

function stockFromModel(value){
 if(typeof value==='string')value=Number(value.replace(/[^\d-]/g,''));
 if(!Number.isSafeInteger(value)||value<0||value>1000000)return null;
 return value;
}

export function parseProductDraft(reply){
 const raw=String(reply??'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
 const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
 if(start<0||end<=start)throw fault('Não consegui interpretar a descrição falada. Tente novamente.');
 let data;
 try{data=JSON.parse(raw.slice(start,end+1));}catch{throw fault('Não consegui interpretar a descrição falada. Tente novamente.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw fault('Não consegui interpretar a descrição falada. Tente novamente.');
 if(typeof data.name!=='string'||!data.name.trim())
  throw fault('Não identifiquei o nome do produto na sua fala. Tente novamente dizendo o título primeiro.');
 const priceCents=centsFromModel(data.priceCents,0);
 let product;
 try{
  product=validateProduct({
   name:data.name,
   description:typeof data.description==='string'?data.description:'',
   priceCents,
   compareAtPriceCents:data.compareAtPriceCents==null?null:centsFromModel(data.compareAtPriceCents,null),
   sku:typeof data.sku==='string'?data.sku:null,
   stockQuantity:stockFromModel(data.stockQuantity),
   active:true
  });
 }catch{
  throw fault('Alguma informação do produto ficou inválida. Revise a fala e tente novamente.');
 }
 const variants=[];
 for(const item of (Array.isArray(data.variants)?data.variants:[]).slice(0,25)){
  try{
   variants.push(validateVariants([{
    name:typeof item?.name==='string'?item.name:'',
    sku:typeof item?.sku==='string'?item.sku:null,
    priceCents:centsFromModel(item?.priceCents,product.priceCents),
    stockQuantity:stockFromModel(item?.stockQuantity),
    active:true
   }])[0]);
  }catch{}
 }
 return {product,variants};
}

export async function draftProductFromSpeech(transcript,{respond=brainResponse,env=process.env}={}){
 const text=typeof transcript==='string'?transcript.trim():'';
 if(text.length<3)throw fault('Fale ou escreva os dados do produto.');
 if(text.length>4000)throw fault('A descrição falada está muito longa. Tente em partes.');
 const result=await respond({instructions:draftInstructions,input:text,maxOutputTokens:700,effort:'low',env});
 if(!result||result.ok!==true||typeof result.reply!=='string')
  throw Object.assign(new Error('Não consegui preparar o cadastro agora. Tente novamente em instantes.'),{status:503});
 return {...parseProductDraft(result.reply),provider:result.provider??null,transcript:text};
}
