// Rotate bounded triage batches past candidates rejected by the text classifier.
// Each pool keeps an independent cursor; a restart safely repeats the scan.
export function createIntakeScanner(){
 const cursors=new WeakMap();
 return async(pool,sql)=>{
  let cursor=cursors.get(pool);
  const read=()=>pool.query(sql,[cursor?.time||null,cursor?.id||null]);
  let result=await read();
  if(!result.rowCount&&cursor){cursor=null;cursors.delete(pool);result=await read();}
  const last=result.rows.at(-1);
  if(last?.scan_created_at)cursors.set(pool,{time:last.scan_created_at,id:last.id});
  return result;
 };
}
