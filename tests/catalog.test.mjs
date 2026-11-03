import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {validateProduct,validateVariants,validateCampaign,catalogPrompt,matchCatalogProducts} from '../catalog.mjs';
import {normalizeImage,imageKey,mediaConfigured,putPrivateImage,getPrivateImage,deletePrivateImage} from '../media-storage.mjs';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333';
test('product fields validate legacy products, BRL cents, SKU, inventory and price',()=>{
 assert.deepEqual(validateProduct({name:'Pizza',priceCents:3990}),{name:'Pizza',description:'',sku:null,priceCents:3990,stockQuantity:null,compareAtPriceCents:null,active:true});
 assert.equal(validateProduct({name:'Pizza',description:'Calabresa',priceCents:3990,sku:'pizza_1',stockQuantity:0,active:false}).sku,'PIZZA_1');
 assert.throws(()=>validateProduct({name:'P',priceCents:-1}),/inválidos/);
 assert.throws(()=>validateProduct({name:'P',priceCents:2.7}),/inválidos/);
 assert.throws(()=>validateProduct({name:'P',priceCents:10,stockQuantity:-1}),/inválidos/);
 assert.throws(()=>validateProduct({name:'P',priceCents:10,sku:'bad sku'}),/inválidos/);
});
test('variants are bounded and duplicate SKUs are rejected',()=>{
 const variants=validateVariants([{name:'Pequena',sku:'PIZ-12',priceCents:2900,stockQuantity:2},{name:'Grande',priceCents:3990,stockQuantity:0}]);
 assert.equal(variants.length,2);
 assert.equal(variants[1].stockQuantity,0);
 assert.throws(()=>validateVariants([{name:'A',sku:'x-10',priceCents:10},{name:'B',sku:'X-10',priceCents:15}]),/duplicado/);
 assert.throws(()=>validateVariants(Array.from({length:26},()=>({name:'V',priceCents:20}))),/25/);
});
test('campaign associations are metadata, never verified OAuth connections',()=>{
 assert.deepEqual(validateCampaign({provider:'meta_ads',campaignId:'120-2026',label:'Campanha 1'}),{provider:'meta_ads',campaignId:'120-2026',label:'Campanha 1'});
 assert.throws(()=>validateCampaign({provider:'tiktok',campaignId:'123'}),/inválida/);
 assert.throws(()=>validateCampaign({provider:'google_ads',campaignId:'https://somewhere/path'}),/inválida/);
});
test('AI grounding includes each official variant, stock and deterministic image suggestions only on exact product name',()=>{
 const products=[{id:product,name:'Pizza de Calabresa',price_cents:3990,stock_quantity:0,active:true,description:'Molho de tomate',
  variants:[{name:'Grande',price_cents:5990,stock_quantity:10,active:true},{name:'Pequena',price_cents:2990,stock_quantity:0,active:true}],
  media:[{id:'44444444-4444-4444-8444-444444444444',alt:'Pizza pronta'}]}];
 const prompt=catalogPrompt(products);
 assert.match(prompt,/sem estoque/);
 assert.match(prompt,/59\.90/);
 assert.match(prompt,/29\.90/);
 assert.deepEqual(matchCatalogProducts('Vocês têm alguma promoção?',products),[]);
 const matches=matchCatalogProducts('Quero foto da pizza de calabresa',products);
 assert.equal(matches.length,1);
 assert.equal(matches[0].media[0].url,'/api/products/'+product+'/media/44444444-4444-4444-8444-444444444444/file');
});
test('private images are recompressed to JPEG, encrypted transport context and tenant-separated paths',async()=>{
 const env={NODE_ENV:'test',SOCIO_STORAGE_DRIVER:'memory'};
 assert(mediaConfigured(env));
 const source=await sharp({create:{width:90,height:90,channels:3,background:'#e8bbaa'}}).png().toBuffer();
 const converted=await normalizeImage(source.toString('base64'));
 assert.equal(converted.contentType,'image/jpeg');
 assert.equal(converted.bytes.subarray(0,3).toString('hex'),'ffd8ff');
 const key=imageKey(tenant,product);
 assert(key.startsWith(tenant+'/'+product+'/'));
 assert(!key.startsWith(other+'/'));
 await putPrivateImage(key,converted.bytes,env);
 const got=await getPrivateImage(key,env);
 assert(got.equals(converted.bytes));
 await deletePrivateImage(key,env);
 await assert.rejects(getPrivateImage(key,env),/não encontrada/);
 await assert.rejects(normalizeImage(Buffer.from('hello').toString('base64')),/inválida/);
});
