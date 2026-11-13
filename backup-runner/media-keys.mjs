// Object layout of the private media bucket. The snapshot copies every
// namespace the application writes, and refuses anything it does not know
// instead of silently skipping data the owner believes is protected.
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const productImage=new RegExp('^'+UUID+'/'+UUID+'/'+UUID+'\\.jpg$','i');
const adVideo=new RegExp('^ads-private/'+UUID+'/'+UUID+'/source\\.(?:mp4|mov)$','i');
export const MAX_OBJECT_BYTES=100*1024*1024;
export const MAX_FILES=10000;
export const MAX_TOTAL_BYTES=1024*1024*1024;
const failure=(code,message)=>Object.assign(new Error(message),{code});

export function classifyMediaKey(key){
 if(typeof key!=='string')return 'unknown';
 if(key.startsWith('health/'))return 'probe';
 if(productImage.test(key))return 'product-image';
 if(adVideo.test(key))return 'ad-video';
 return 'unknown';
}
// Accumulates one listing page; the caller carries files/bytes across pages.
export function collectMediaObjects(contents,{files=0,bytes=0}={}){
 const items=[];
 for(const item of contents||[]){
  const kind=classifyMediaKey(item?.Key);
  if(kind==='probe')continue;
  if(kind==='unknown')throw failure('UNEXPECTED_NAMESPACE','Unexpected object outside the private media namespaces');
  const size=Number(item.Size);
  if(!Number.isSafeInteger(size)||size<1||size>MAX_OBJECT_BYTES)
   throw failure('OBJECT_TOO_LARGE','Media object exceeds the safe size');
  files+=1;bytes+=size;
  if(files>MAX_FILES||bytes>MAX_TOTAL_BYTES)throw failure('SNAPSHOT_LIMIT','Snapshot exceeded the safe file/byte limits');
  items.push({key:item.Key,size,kind});
 }
 return {items,files,bytes};
}
