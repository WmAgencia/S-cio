// Dotted-mesh orb renderer shared by the orb page and the dashboard entry.
(function(){
 'use strict';

 function create(canvas,options){
  const opts=options||{};
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx||!canvas)return null;
  const light=opts.light===true;
  const ampOf=typeof opts.amp==='function'?opts.amp:()=>0;
  const radius=opts.radius||.365;
  const pointScale=opts.point||.005;
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const RINGS=Math.max(18,Math.round(74*(opts.density||1))),HUES=36,BANDS=3;
  const STOPS=[[0,[255,104,196]],[.10,[186,110,255]],[.28,[70,130,255]],
   [.50,[62,214,255]],[.72,[86,152,255]],[.90,[206,116,246]],[1,[255,104,196]]];

  const dirs=[],hueIdx=[];
  for(let i=0;i<RINGS;i++){
   const lat=Math.asin(1-2*(i+.5)/RINGS);
   const cl=Math.cos(lat),sl=Math.sin(lat);
   const count=Math.max(3,Math.round(2*RINGS*cl));
   const offset=i*.7;
   for(let j=0;j<count;j++){
    const lon=(j/count)*Math.PI*2+offset;
    dirs.push(cl*Math.cos(lon),sl,cl*Math.sin(lon));
    hueIdx.push(Math.round(((Math.atan2(sl,cl*Math.cos(lon))+Math.PI)/(Math.PI*2))*(HUES-1)));
   }
  }
  const dir=new Float32Array(dirs),hue=new Uint8Array(hueIdx),total=hue.length;

  const hueColor=t=>{
   for(let s=1;s<STOPS.length;s++){
    if(t<=STOPS[s][0]){
     const a=STOPS[s-1],k=(t-a[0])/((STOPS[s][0]-a[0])||1);
     return [0,1,2].map(c=>Math.round(a[1][c]+(STOPS[s][1][c]-a[1][c])*k));
    }
   }
   return STOPS[STOPS.length-1][1];
  };
  // Front points are the saturated colour; back bands recede toward the stage
  // colour (dark ink on the dark orb page, white on the light dashboard).
  const bands=light?[1,.84,.70]:[1,.78,.56];
  const palette=[];
  for(let b=0;b<BANDS;b++)for(let h=0;h<HUES;h++){
   const rgb=hueColor(h/(HUES-1)).map(v=>light?Math.round(v+(255-v)*(1-bands[b])):Math.round(v*bands[b]));
   palette.push('rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+',.94)');
  }
  const buckets=Array.from({length:HUES*BANDS},()=>[]);

  let w=0,h=0,dpr=1,raf=0,start=0;
  function measure(){
   const rect=canvas.getBoundingClientRect();
   const nextW=Math.max(1,Math.round(rect.width)),nextH=Math.max(1,Math.round(rect.height));
   dpr=Math.min(2,globalThis.devicePixelRatio||1);
   if(nextW===w&&nextH===h)return;
   w=nextW;h=nextH;
   canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  }
  function draw(now){
   if(!canvas.isConnected){raf=0;return;}
   if(!start)start=now;
   const t=reduced?0:(now-start)/1000;
   measure();
   // Negative amplitude pulls the mesh inward while the owner speaks; the
   // assistant's own voice keeps the outward swell.
   const amp=Math.max(-1,Math.min(1,ampOf())),power=Math.abs(amp);
   const cx=w/2,cy=h/2,side=Math.min(w,h),R=side*radius;
   ctx.setTransform(dpr,0,0,dpr,0,0);
   ctx.clearRect(0,0,w,h);
   const bloom=ctx.createRadialGradient(cx-R*.28,cy-R*.34,R*.04,cx,cy,R*1.55);
   if(light){
    bloom.addColorStop(0,'rgba(120,170,255,'+(.16+power*.12).toFixed(3)+')');
    bloom.addColorStop(.46,'rgba(140,120,255,'+(.09+power*.07).toFixed(3)+')');
    bloom.addColorStop(1,'rgba(180,140,255,0)');
   }else{
    bloom.addColorStop(0,'rgba(120,190,255,'+(.20+power*.16).toFixed(3)+')');
    bloom.addColorStop(.45,'rgba(88,110,255,'+(.10+power*.10).toFixed(3)+')');
    bloom.addColorStop(1,'rgba(60,40,120,0)');
   }
   ctx.fillStyle=bloom;ctx.fillRect(0,0,w,h);
   const yaw=t*.16,pitch=Math.sin(t*.21)*.16;
   const cyw=Math.cos(yaw),syw=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
   const breath=1+.02*Math.sin(t*1.05)+amp*.11;
   const base=Math.max(.85,side*pointScale)*(1+amp*.16);
   for(let b=0;b<buckets.length;b++)buckets[b].length=0;
   for(let i=0;i<total;i++){
    const x0=dir[i*3],y0=dir[i*3+1],z0=dir[i*3+2];
    const swell=.155*Math.sin(1.55*x0+t*.42)*Math.sin(1.4*y0-t*.36)*Math.sin(1.75*z0+t*.31)
     +.055*Math.sin(3.4*x0-t*.52)*Math.sin(3.1*y0+t*.47)*Math.sin(3.3*z0-t*.4)
     +amp*.14*Math.sin(2.9*x0+t*2.1)*Math.sin(2.4*y0-t*1.6)*Math.sin(2.7*z0+t*1.2);
    const r=breath*(1+swell);
    const rx=x0*cyw+z0*syw,rz=-x0*syw+z0*cyw;
    const ry=y0*cp-rz*sp,rz2=y0*sp+rz*cp;
    const x=rx*r,y=ry*r,z=rz2*r;
    const p=5/(5-z);
    const px=cx+x*R*p,py=cy+y*R*p;
    if(px<-2||py<-2||px>w+2||py>h+2)continue;
    const size=Math.max(.7,base*p*(1+Math.max(0,z)*.22));
    const band=z>.45?0:z>-.2?1:2;
    buckets[hue[i]+band*HUES].push(px-size/2,py-size/2,size);
   }
   ctx.globalCompositeOperation=light?'source-over':'lighter';
   for(let i=0;i<buckets.length;i++){
    const list=buckets[i];
    if(!list.length)continue;
    ctx.fillStyle=palette[i];
    for(let k=0;k<list.length;k+=3)ctx.fillRect(list[k],list[k+1],list[k+2],list[k+2]);
   }
   ctx.globalCompositeOperation='source-over';
   if(!reduced)raf=requestAnimationFrame(draw);
  }

  measure();
  const observer=typeof globalThis.ResizeObserver==='function'?new globalThis.ResizeObserver(measure):null;
  observer?.observe(canvas);
  raf=requestAnimationFrame(draw);
  return {stop(){
   cancelAnimationFrame(raf);raf=0;observer?.disconnect();
   ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
  }};
 }

 globalThis.SocioOrbMesh={create};
})();
