// Single source of truth for tenant-specific modules, not just sidebar hiding.
// Old tenants retain their previous capabilities; new tenants select modules.
export const TENANT_FEATURE_KEYS=Object.freeze(['whatsapp','catalog','sales','ai','metaAds']);
export const DEFAULT_TENANT_FEATURES=Object.freeze({
 whatsapp:true,catalog:true,sales:true,ai:true,metaAds:true
});
export const RECOMMENDED_NEW_FEATURES=Object.freeze({
 whatsapp:true,catalog:true,sales:false,ai:true,metaAds:false
});
const forbidden=message=>Object.assign(new Error(message),{status:422});
export function normalizeTenantFeatures(input,{fallback=DEFAULT_TENANT_FEATURES}={}){
 if(input===undefined||input===null)return {...fallback};
 if(typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!TENANT_FEATURE_KEYS.includes(k))||
    TENANT_FEATURE_KEYS.some(k=>typeof input[k]!=='boolean'))
  throw forbidden('Selecione as funcionalidades válidas da empresa.');
 const f=Object.fromEntries(TENANT_FEATURE_KEYS.map(k=>[k,input[k]]));
 if(f.sales&&(!f.catalog||!f.whatsapp))
  throw forbidden('Orçamentos precisam das funções Produtos e WhatsApp ativadas.');
 return f;
}
export function tenantFeatureEnabled(features,key){
 if(!TENANT_FEATURE_KEYS.includes(key))return false;
 return features==null?DEFAULT_TENANT_FEATURES[key]:features[key]===true;
}
export function effectiveTenantPermissions(permissions,features){
 const byPermission={
  'inbox.read':'whatsapp','inbox.write':'whatsapp','channels.manage':'whatsapp',
  'catalog.read':'catalog','catalog.manage':'catalog',
  'sales.read':'sales','sales.manage':'sales',
  'training.manage':'ai',
  'marketing.read':'metaAds','marketing.manage':'metaAds'
 };
 return permissions.filter(k=>!byPermission[k]||tenantFeatureEnabled(features,byPermission[k]));
}
export function featureForPath(pathname){
 if(/^\/api\/marketing(?:\/|$)/.test(pathname))return 'metaAds';
 if(/^\/api\/sales(?:\/|$)/.test(pathname)||/^\/api\/quote-requests(?:\/|$)/.test(pathname))return 'sales';
 if(/^\/api\/products(?:\/|$)/.test(pathname))return 'catalog';
 if(/^\/api\/(?:training|agent|simulate)(?:\/|$)/.test(pathname)||
    pathname==='/api/ops/groq/test')return 'ai';
 if(/^\/api\/(?:inbox|waakg|channels)(?:\/|$)/.test(pathname))return 'whatsapp';
 return null;
}
export function assertTenantFeature(features,key){
 if(tenantFeatureEnabled(features,key))return true;
 throw Object.assign(new Error('Esta funcionalidade não está ativada para sua empresa.'),{status:403});
}
