// Preserve PostgreSQL microseconds and use the ID to disambiguate equal times.
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const validTime=raw=>{
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(raw)||!Number.isFinite(Date.parse(raw)))return false;
 const [year,month,day]=raw.slice(0,10).split('-').map(Number);
 return month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate();
};
export function encodeHistoryCursor(message){
 return Buffer.from(JSON.stringify([message.cursor_created_at||message.created_at,message.id])).toString('base64url');
}
export function decodeHistoryCursor(raw){
 if(!raw)return {time:null,id:null};
 try{
  // Retain support for links opened by the previous client.
  if(raw.length<=35&&validTime(raw))return {time:new Date(raw).toISOString(),id:null};
  if(raw.length>240||!/^[A-Za-z0-9_-]+$/.test(raw))throw Error();
  const pair=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||pair[0].length>40||
     !validTime(pair[0])||!uuid.test(pair[1]))throw Error();
  return {time:pair[0],id:pair[1]};
 }catch{throw Object.assign(new Error('Cursor inválido.'),{status:422});}
}
