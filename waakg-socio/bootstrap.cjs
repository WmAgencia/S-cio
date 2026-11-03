// Run on every gateway startup. Never log credentials or the API key.
const {PrismaClient}=require('@prisma/client');
const bcrypt=require('bcryptjs');
const p=new PrismaClient();
async function main(){
  const email=process.env.SOCIO_GATEWAY_ADMIN_EMAIL;
  const secret=process.env.SOCIO_GATEWAY_ADMIN_PASSWORD;
  const apiKey=process.env.WA_AKG_API_KEY;
  if(!email||!secret||secret.length<32||!apiKey||apiKey.length<32)
    throw new Error('Gateway credentials missing or weak');
  const old=await p.user.findUnique({where:{email}});
  if(old){
    await p.user.update({where:{email},data:{role:'SUPERADMIN',apiKey}});
  }else{
    const password=await bcrypt.hash(secret,12);
    await p.user.create({data:{email,name:'Sócio Integration Service',password,role:'SUPERADMIN',apiKey}});
  }
  await p.botConfig.updateMany({data:{enabled:false,autoRead:false,alwaysOnline:false}});
  await p.systemConfig.upsert({where:{id:'default'},create:{id:'default',enableRegistration:false},update:{enableRegistration:false}});
  console.log('Sócio gateway initialized (native autoreply disabled)');
}
main().catch(e=>{console.error('Gateway bootstrap failed:',e.code||e.message);process.exitCode=1}).finally(()=>p.$disconnect());
