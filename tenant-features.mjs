// Server-owned modules per client company. Existing tenants default to full access.
// Disabling a module never deletes or transfers its historical data.
export const FEATURE_KEYS=Object.freeze(['whatsapp','catalog','meta_ads','ai','team']);
export const FEATURE_LABELS=Object.freeze({
 whatsapp:'Atendimento WhatsApp',catalog:'Produtos e serviços',
 meta_ads:'Meta Ads',ai:'Inteligência Artificial',team:'Equipe'
});
export const DEFAULT_FEATURES=Object.freeze(Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])));
const invalid=()=>Object.assign(new Error('Seleção de funcionalidades inválida.'),{status:422});
export function parseTenantFeatures(value){
 if(value===null||value===undefined)return {...DEFAULT_FEATURES};
 const obj=typeof value==='string'?JSON.parse(value):value;
 if(!obj||Array.isArray(obj)||typeof obj!=='object')throw invalid();
 return Object.fromEntries(FEATURE_KEYS.map(key=>[key,obj[key]!==false]));
}
export function validateTenantFeatures(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!FEATURE_KEYS.includes(k))||
  FEATURE_KEYS.some(k=>typeof value[k]!=='boolean'))throw invalid();
 return Object.fromEntries(FEATURE_KEYS.map(k=>[k,value[k]]));
}
export function featureForPermission(permission){
 if(permission.startsWith('catalog.'))return 'catalog';
 if(permission.startsWith('marketing.'))return 'meta_ads';
 if(permission.startsWith('training.'))return 'ai';
 if(permission.startsWith('team.'))return 'team';
 if(permission.startsWith('inbox.')||permission.startsWith('channels.'))return 'whatsapp';
 return null;
}
export function filterPermissions(permissions,features){
 const flags=parseTenantFeatures(features);
 return permissions.filter(p=>!featureForPermission(p)||flags[featureForPermission(p)]===true);
}
export function requiredFeatureForApi(path){
 if(/^\/api\/(products)(?:\/|$)/.test(path))return 'catalog';
 if(/^\/api\/(marketing|ads-media)(?:\/|$)/.test(path))return 'meta_ads';
 if(/^\/api\/(agent|training|imports|simulate|flow)(?:\/|$)/.test(path)||path.startsWith('/api/ops/groq/'))return 'ai';
 if(/^\/api\/(team)(?:\/|$)/.test(path))return 'team';
 if(/^\/api\/(inbox|waakg|channels|conversations|instagram)(?:\/|$)/.test(path))return 'whatsapp';
 return null;
}
export function assertApiFeature(features,path){
 const key=requiredFeatureForApi(path);
 if(key&&parseTenantFeatures(features)[key]!==true)
  throw Object.assign(new Error('Esta funcionalidade não está habilitada para sua empresa.'),{status:403});
}
