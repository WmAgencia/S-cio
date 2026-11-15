#!/usr/bin/env node
// Cria (ou atualiza) uma empresa de demonstração isolada para ver o painel cheio:
// conversas, mensagens, vendas confirmadas em seis meses, vendas pendentes e
// recomendações aguardando decisão. Nada é enviado a clientes: só linhas no banco.
//
// Uso: node --env-file=<arquivo> scripts/socio-demo-seed.mjs [--remove]
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {hashPassword} from '../lib.mjs';

const SLUG='demo-vitrine';
const EMAIL='demo@socio.local';
const PASSWORD='DemoVitrine2026!';
const DEMO_PHONE='5511999990000';

const schema=process.env.SOCIO_DB_SCHEMA||'public';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,
 connectionTimeoutMillis:15000,idleTimeoutMillis:10000,
 options:schema==='socio_app'?'-c search_path=socio_app,pg_catalog':undefined});

const uuid=()=>randomUUID();
const day=offset=>new Date(Date.now()+offset*86400000);

const run=async()=>{
 const remove=process.argv.includes('--remove');
 const existing=await pool.query('SELECT id FROM tenants WHERE slug=$1',[SLUG]);
 if(remove){
  if(existing.rows[0])await pool.query('DELETE FROM tenants WHERE id=$1',[existing.rows[0].id]);
  console.log(existing.rows[0]?'Demo removida.':'Nada para remover.');
  return;
 }
 let tenantId=existing.rows[0]?.id;
 if(tenantId){
  await pool.query("UPDATE tenants SET name='Empresa Demo (vitrine)',status='active',features=$2 WHERE id=$1",
   [tenantId,JSON.stringify({whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true})]);
  console.log('Empresa demo já existia; dados serão atualizados.');
 }else{
  tenantId=uuid();
  await pool.query("INSERT INTO tenants(id,name,slug,plan,status,features) VALUES($1,$2,$3,'essencial','active',$4)",
   [tenantId,'Empresa Demo (vitrine)',SLUG,JSON.stringify({whatsapp:true,catalog:true,quotes:true,meta_ads:true,ai:true,team:true})]);
  console.log('Empresa demo criada.');
 }

 const passwordHash=await hashPassword(PASSWORD);
 const user=await pool.query('SELECT id FROM users WHERE email=$1',[EMAIL]);
 if(user.rows[0]){
  await pool.query('UPDATE users SET tenant_id=$2,password_hash=$3,name=$4,role=\'owner\',active=true WHERE id=$1',
   [user.rows[0].id,tenantId,passwordHash,'Dono da Demo']);
 }else{
  await pool.query('INSERT INTO users(id,tenant_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,\'owner\')',
   [uuid(),tenantId,EMAIL,'Dono da Demo',passwordHash]);
 }

 // Canal de WhatsApp conectado.
 let channel=await pool.query('SELECT id FROM channels WHERE tenant_id=$1 AND phone=$2',[tenantId,DEMO_PHONE]);
 let channelId=channel.rows[0]?.id;
 if(channelId){
  await pool.query("UPDATE channels SET label='WhatsApp principal',status='connected',provider='manual' WHERE id=$1",[channelId]);
 }else{
  channelId=uuid();
  await pool.query("INSERT INTO channels(id,tenant_id,label,phone,provider,status) VALUES($1,$2,'WhatsApp principal',$3,'manual','connected')",
   [channelId,tenantId,DEMO_PHONE]);
 }

 // Conversas e mensagens.
 const people=[
  ['Mariana Alves','5511988110001','open','Queria saber o valor da instalação para duas máquinas.'],
  ['João Pedro','5511988110002','open','Segue o comprovante, pode agendar para quinta.'],
  ['Carla Menezes','5511988110003','human','Consegue instalar no sábado de manhã?'],
  ['Rafael Souza','5511988110004','resolved','Fechado, obrigado pelo atendimento!'],
  ['Beatriz Lima','5511988110005','open','Vocês atendem em Guarulhos?'],
  ['Diego Martins','5511988110006','resolved','Vou pensar e te chamo depois.'],
  ['Fernanda Rocha','5511988110007','open','Qual o prazo de entrega do modelo compacto?'],
  ['Lucas Pereira','5511988110008','open','Pode me mandar a foto do produto branco?']
 ];
 const threads=[
  ['Oi, boa tarde! Queria saber o valor da instalação para duas máquinas.','Boa tarde, Mariana! A instalação de duas máquinas fica R$ 1.250,00, com garantia de 90 dias. Posso reservar um horário?','Perfeito, pode reservar para sexta.','Reservado para sexta às 14h. Vou te enviar a confirmação por aqui.'],
  ['Segue o comprovante, pode agendar para quinta.','Comprovante recebido, João! Agendei quinta às 9h. Obrigado pela confiança.','Show, obrigado!',''],
  ['Consegue instalar no sábado de manhã?','Consigo sim, Carla. Sábado às 8h está livre. Confirmo?','Pode confirmar.','Confirmado para sábado às 8h.'],
  ['Fechado, obrigado pelo atendimento!','Foi um prazer, Rafael! Qualquer coisa é só chamar.','',''],
  ['Vocês atendem em Guarulhos?','Atendemos sim, Beatriz! O deslocamento até Guarulhos está incluso. Quer agendar uma visita?','Quero sim, pode ser na terça.','Agendado para terça às 10h.'],
  ['Vou pensar e te chamo depois.','Sem problemas, Diego! Fico à disposição.','',''],
  ['Qual o prazo de entrega do modelo compacto?','O compacto sai em até 3 dias úteis, Fernanda. Quer que eu reserve uma unidade?','Pode reservar.','Reservado! Assim que sair eu te aviso por aqui.'],
  ['Pode me mandar a foto do produto branco?','Claro, Lucas! Segue a foto do modelo branco. Ele está em pronta entrega.','Gostei, vou fechar.','Perfeito! Vou registrar o pedido.']
 ];
 for(let i=0;i<people.length;i++){
  const [name,phone,status,last]=people[i];
  let conv=await pool.query('SELECT id FROM conversations WHERE tenant_id=$1 AND channel_id=$2 AND customer_phone=$3',
   [tenantId,channelId,phone]);
  let conversationId=conv.rows[0]?.id;
  const lastAt=day(-(i*0.7));
  if(conversationId){
   await pool.query('UPDATE conversations SET customer_name=$2,status=$3,last_message_at=$4 WHERE id=$1',
    [conversationId,name,status,lastAt]);
  }else{
   conversationId=uuid();
   await pool.query('INSERT INTO conversations(id,tenant_id,channel_id,customer_name,customer_phone,status,last_message_at,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[conversationId,tenantId,channelId,name,phone,status,lastAt,day(-(i+2))]);
  }
  await pool.query('DELETE FROM messages WHERE tenant_id=$1 AND conversation_id=$2',[tenantId,conversationId]);
  const script=threads[i];
  for(let m=0;m<script.length;m++){
   if(!script[m])continue;
   await pool.query('INSERT INTO messages(id,tenant_id,conversation_id,direction,body,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [uuid(),tenantId,conversationId,m%2===0?'inbound':'outbound',script[m],new Date(lastAt.getTime()-(script.length-m)*900000)]);
  }
  people[i].push(conversationId);
 }

 // Vendas confirmadas distribuídas em seis meses, com pico no mês atual.
 await pool.query("DELETE FROM socio_sales WHERE tenant_id=$1 AND source='manual'",[tenantId]);
 const months=[5,4,3,2,1,0];
 const perMonth=[3,4,5,4,6,9];
 const campaignNames=['Instalação residencial','Manutenção preventiva','Pacote duas máquinas'];
 let saleIndex=0;
 for(const offset of months){
  const count=perMonth[months.indexOf(offset)];
  for(let k=0;k<count;k++){
   const when=day(-(offset*30)-k*2);
   const cents=38000+((saleIndex*3700)%64000);
   await pool.query('INSERT INTO socio_sales(id,tenant_id,conversation_id,evidence_kind,evidence_excerpt,'+
    'amount_cents,status,source,origin_source,origin_campaign_name,confirmed_at,created_at) '+
    'VALUES($1,$2,$3,\'manual\',$4,$5,\'confirmed\',\'manual\',\'organic\',$6,$7,$7)',
    [uuid(),tenantId,people[saleIndex%people.length][4],'Venda registrada no painel demo',cents,
     campaignNames[saleIndex%campaignNames.length],when]);
   saleIndex++;
  }
 }
 // Duas vendas aguardando confirmação do dono.
 for(let k=0;k<2;k++){
  await pool.query('INSERT INTO socio_sales(id,tenant_id,conversation_id,evidence_kind,evidence_excerpt,'+
   'amount_cents,status,source,origin_source,created_at) VALUES($1,$2,$3,\'image\',$4,$5,\'pending\',\'heuristic\',\'organic\',$6)',
   [uuid(),tenantId,people[k][4],'Comprovante enviado no WhatsApp',k===0?125000:84200,day(-k)]);
 }

 // Recomendações aguardando decisão (aparecem empilhadas no painel).
 await pool.query("DELETE FROM socio_traffic_decisions WHERE tenant_id=$1 AND account_id='act_1099999999'",[tenantId]);
 const decisions=[
  ['scale','campaign','1200000001','Bolos caseiros','Aumentar orçamento',
   'A campanha está com custo por conversa 32% abaixo da meta por três dias seguidos.',
   'Custo por conversa de R$ 4,10 contra meta de R$ 6,00. Sugiro subir o orçamento diário de R$ 6,00 para R$ 10,00.',
   600,1000],
  ['pause','adset','1200000002','Público amplo · 18-65','Pausar anúncio',
   'O conjunto acumula 180 cliques e nenhuma conversa iniciada em cinco dias.',
   'Gasto de R$ 240,00 sem conversa atribuída no período. Sugiro pausar e reinvestir na campanha que converte.',
   24000,null],
  ['broaden_audience','campaign','1200000003','Instalação · São Paulo','Ampliar público',
   'A frequência chegou a 4,2 e o custo por clique subiu 18% na última semana.',
   'Ampliar o público deve reduzir a frequência e o custo por clique mantendo o volume de conversas.',
   null,null]
 ];
 for(const [action,entity,entityId,name,label,reason,explanation,currentBudget,targetBudget] of decisions){
  await pool.query('INSERT INTO socio_traffic_decisions(id,tenant_id,account_id,action,entity,entity_id,entity_name,'+
   'campaign_id,reason,explanation,current_budget_cents,target_budget_cents,within_autonomy,status,question,created_at,updated_at) '+
   "VALUES($1,$2,'act_1099999999',$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'awaiting_approval',$12,$13,$13)",
   [uuid(),tenantId,action,entity,entityId,name,entityId,reason,explanation,currentBudget,targetBudget,
    label+'?',day(-decisions.findIndex(d=>d[2]===entityId))]);
 }

 const summary=await pool.query(
  "SELECT (SELECT count(*) FROM conversations WHERE tenant_id=$1) AS conversations,"+
  " (SELECT count(*) FROM messages WHERE tenant_id=$1) AS messages,"+
  " (SELECT count(*) FROM socio_sales WHERE tenant_id=$1 AND status='confirmed') AS sales,"+
  " (SELECT count(*) FROM socio_sales WHERE tenant_id=$1 AND status='pending') AS pending,"+
  " (SELECT count(*) FROM socio_traffic_decisions WHERE tenant_id=$1 AND status='awaiting_approval') AS decisions",[tenantId]);
 console.log('Empresa demo pronta.');
 console.log('  empresa:',tenantId);
 console.log('  login:',EMAIL,'/',PASSWORD);
 console.log('  dados:',summary.rows[0]);
};

run().then(()=>pool.end()).catch(async(error)=>{
 console.error('Falha no seed:',String(error?.message||error));
 await pool.end();
 process.exitCode=1;
});
