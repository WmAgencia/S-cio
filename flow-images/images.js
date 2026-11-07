const MAX_BYTES=20*1024*1024;
const unavailable=()=>Object.assign(Error('Imagem indisponível para download; confira o resultado no Flow.'),{code:'image_unavailable'});
function checkedUrl(value) {
  let u;try{u=new URL(value);}catch{throw unavailable();}
  const h=u.hostname;
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||
    !(h==='storage.googleapis.com'||h==='googleusercontent.com'||h.endsWith('.googleusercontent.com'))) throw unavailable();
  return u;
}
function mime(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  throw unavailable();
}
export async function materializeImage(image) {
  let bytes;
  if(typeof image?.b64_json==='string') {
    if(image.b64_json.length>Math.ceil(MAX_BYTES/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.b64_json))throw unavailable();
    bytes=Buffer.from(image.b64_json,'base64');
  } else if(typeof image?.url==='string') {
    let target=checkedUrl(image.url);
    const timeout=AbortSignal.timeout(30000);
    for(let redirects=0;redirects<=3;redirects++) {
      const r=await fetch(target,{redirect:'manual',signal:timeout});
      if([301,302,303,307,308].includes(r.status)) {
        const location=r.headers.get('location');await r.body?.cancel();
        if(!location||redirects===3)throw unavailable();
        target=checkedUrl(new URL(location,target));continue;
      }
      if(!r.ok||Number(r.headers.get('content-length'))>MAX_BYTES) {await r.body?.cancel();throw unavailable();}
      if(!r.body)throw unavailable();
      const chunks=[];let size=0;
      for await(const chunk of r.body){size+=chunk.length;if(size>MAX_BYTES)throw unavailable();chunks.push(chunk);}
      bytes=Buffer.concat(chunks);break;
    }
  }
  if(!bytes||bytes.length>MAX_BYTES||bytes.length<12)throw unavailable();
  return {b64_json:bytes.toString('base64'),mime_type:mime(bytes)};
}
