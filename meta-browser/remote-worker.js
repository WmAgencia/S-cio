// One process and API_ANYTHING_HOME per connection. Never change process.env between users.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {allowRemoteResource,isMetaURL} from './network-policy.js';
import {parseObservedMetaBalance,topupAmount,verifyMetaPixCode} from '../meta-billing-state.mjs';
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('api-anything'));
const internal = name => import(pathToFileURL(join(dist, `${name}.js`)).href);
const aa = await import('api-anything');
const host = await import('api-anything/host');
const sessions = await internal('session');
const { browserChoice } = await internal('browser');
const SITE = 'adsmanager.facebook.com';
const TARGET = 'https://adsmanager.facebook.com/';
mkdirSync(process.env.API_ANYTHING_HOME, { recursive: true });
if (!aa.loadSite(SITE)) aa.saveSite({ name: SITE, baseUrl: TARGET, loginCookies: ['c_user', 'xs'], operations: [] });
let context; let page; let expiresAt = 0; let billingIntent=null; let billingInteractiveUntil=0;
const plans = new Map();
function activePage() {
  if ((!page || page.isClosed()) && context) page = context.pages().filter(p => !p.isClosed()).at(-1);
  if (!page || page.isClosed()) throw new Error('BROWSER_NOT_OPEN');
  return page;
}
async function closeRemote() {
  if (context) await context.close().catch(() => {});
  context = null; page = null; billingIntent=null; billingInteractiveUntil=0;
}
async function saveBrowserSession() {
  if (!context) throw new Error('BROWSER_NOT_OPEN');
  const cookies = (await context.cookies()).filter(c => c.domain === 'facebook.com' || c.domain.endsWith('.facebook.com'));
  if (!cookies.some(c => c.name === 'c_user' && c.value) || !cookies.some(c => c.name === 'xs' && c.value))
    throw new Error('LOGIN_NOT_FINISHED');
  sessions.saveSession(SITE, { ...sessions.loadSession(SITE), cookies, source: 'window' });
  await closeRemote();
  return { session_saved: true, live_validated: false };
}
async function command(method, data = {}) {
  if (method === 'status') {
    const session = sessions.loadSession(SITE);
    return { engine: 'api-anything', requires_meta_app: false, session_present: session.cookies.some(c => c.name === 'c_user' && c.value) && session.cookies.some(c => c.name === 'xs' && c.value),
      browser_page: page && !page.isClosed() && isMetaURL(page.url()) ? new URL(page.url()).origin + new URL(page.url()).pathname : null,
      remote_browser_open: Boolean(context), operations: host.hostSite(SITE)?.operations || [], live_validated: false };
  }
  if (method === 'open') {
    if (!context) {
      const executablePath = process.env.BROWSER_EXECUTABLE_PATH || browserChoice()?.bin || chromium.executablePath();
      context = await chromium.launchPersistentContext(join(process.env.API_ANYTHING_HOME, 'profile'), {
        executablePath, headless: true, viewport: { width: 1280, height: 800 },
        acceptDownloads: false, serviceWorkers: 'block',
        chromiumSandbox: process.platform === 'linux' && process.env.SOCIO_META_BROWSER_SANDBOX !== 'false',
      });
      await context.route('**/*', route => allowRemoteResource(route.request().url()) ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', socket => { if (isMetaURL(socket.url())) socket.connectToServer(); else socket.close(); });
      context.on('page', popup => { page = popup; popup.on('dialog', dialog => dialog.dismiss().catch(() => {})); });
      page = context.pages()[0] || await context.newPage();
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      if (!isMetaURL(page.url())) { await closeRemote(); throw new Error('BROWSER_NAVIGATION_FAILED'); }
    }
    expiresAt = Date.now() + 20 * 60000;
    return { open: true, width: 1280, height: 800, expires_in: 1200 };
  }
  if(method==='billing_read'||method==='billing_prepare'){
    if(!/^act_[0-9]{4,30}$/.test(data.accountId||'')||!data.accountName||data.currency!=='BRL')
      throw new Error('BILLING_ACCOUNT_INVALID');
    if(method==='billing_prepare')topupAmount(data.amountMinor);
    if(data.background===true&&context&&billingInteractiveUntil>Date.now())return {state:'busy',accountId:data.accountId};
    if(data.background!==true)billingInteractiveUntil=Date.now()+10*60000;
    if(method==='billing_read'&&billingIntent&&billingIntent.expires>Date.now())return {state:'busy',accountId:data.accountId};
    billingIntent=null;
    await command('open');
    const target=new URL('https://adsmanager.facebook.com/billing_hub/payment_settings/');
    target.searchParams.set('asset_id',data.accountId.slice(4));
    target.searchParams.set('payment_account_id_from_jsmodule',data.accountId.slice(4));
    target.searchParams.set('placement','ads_manager');
    try{
      await activePage().goto(target.href,{waitUntil:'domcontentloaded',timeout:45000});
      await page.getByRole('heading',{name:'Fundos disponíveis',exact:true}).waitFor({timeout:15000});
      if(await page.getByRole('heading',{name:data.accountName,exact:true,level:1}).count()!==1)
        throw new Error('BILLING_ACCOUNT_MISMATCH');
    }catch(error){
      if(error.message==='BILLING_ACCOUNT_MISMATCH')throw error;
      return {state:'needs_login',accountId:data.accountId,
        message:'Conclua o login e as verificações da Meta no navegador de faturamento.'};
    }
    const observation=parseObservedMetaBalance({url:page.url(),body:await page.locator('body').innerText(),
      accountId:data.accountId,accountName:data.accountName,currency:data.currency});
    if(method==='billing_read')return {state:'observed',observation};
    billingIntent={accountId:data.accountId,accountName:data.accountName,amountMinor:data.amountMinor,expires:Date.now()+10*60000};
    await page.getByRole('button',{name:'Adicionar saldo',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.waitFor({timeout:15000});
    try{
      await dialog.getByRole('button',{name:'Outra',exact:true}).click();
      await dialog.getByLabel('Valor',{exact:true}).fill((data.amountMinor/100).toFixed(2).replace('.',','));
      await dialog.getByRole('button',{name:/^PIX/}).click();
    }catch{
      return {state:'complete_in_meta',observation,amountMinor:data.amountMinor,
        message:'Confira o valor e selecione Pix na tela oficial. O formato da Meta pode ter mudado.'};
    }
    // NEVER click Avançar/Pagar or claim that a Pix was generated.
    // The person reviews taxes/beneficiary and advances in Meta's own UI.
    return {state:'review_in_meta',observation,amountMinor:data.amountMinor,
      message:'Confira valor total, impostos e Pix na tela oficial da Meta antes de avançar.'};
  }
  if(method==='billing_pix_read'){
    const intent=billingIntent;
    if(!intent||intent.expires<Date.now()||intent.accountId!==data.accountId)
      return {state:'not_ready',message:'Prepare a recarga novamente. A leitura assistida expirou.'};
    activePage();
    const current=new URL(page.url());
    if(!['adsmanager.facebook.com','business.facebook.com'].includes(current.hostname)||
      current.searchParams.get('asset_id')!==intent.accountId.slice(4)||
      await page.getByRole('heading',{name:intent.accountName,exact:true,level:1}).count()!==1)
      throw new Error('BILLING_ACCOUNT_MISMATCH');
    const inputs=await page.locator('textarea,input:not([type="password"])').evaluateAll(
      nodes=>nodes.map(node=>String(node.value||'')).filter(value=>value.startsWith('000201')).slice(0,5));
    const visible=(await page.locator('body').innerText()).split(/\r?\n/).map(s=>s.trim())
      .filter(value=>value.startsWith('000201')).slice(0,5);
    const codes=[...new Set([...inputs,...visible])];
    const valid=[];
    for(const candidate of codes){try{valid.push(verifyMetaPixCode(candidate,intent.amountMinor));}catch{}}
    if(valid.length!==1)return {state:'not_ready',message:'O código Pix ainda não está visível ou o total difere do solicitado. Confira a tela da Meta.'};
    return {state:'pix_available',...valid[0],accountId:intent.accountId};
  }
  if (method === 'screen') {
    activePage();
    // Login popups may choose another viewport; input coordinates always use 1280 x 800.
    if (page.viewportSize()?.width !== 1280 || page.viewportSize()?.height !== 800) await page.setViewportSize({ width: 1280, height: 800 });
    return { jpeg: (await page.screenshot({ type: 'jpeg', quality: 65, timeout: 10000 })).toString('base64') };
  }
  if (method === 'input') {
    activePage();
    if (data.kind === 'click') await page.mouse.click(data.x, data.y);
    else if (data.kind === 'text') await page.keyboard.insertText(data.text);
    else if (data.kind === 'key') await page.keyboard.press(data.key);
    else if (data.kind === 'scroll') await page.mouse.wheel(0, data.delta);
    else throw new Error('INPUT_INVALID');
    expiresAt = Date.now() + 20 * 60000;
    return { ok: true };
  }
  if (method === 'finish') return saveBrowserSession();
  if (method === 'close') { await closeRemote(); return { closed: true }; }
  if (method === 'plan') {
    if (context) throw new Error('CLOSE_BROWSER_FIRST');
    const plan = host.planCall(SITE, data.operation, data.args || {}, { maxTier: 1 });
    if (!plan.ok) return plan.result;
    const id = randomBytes(24).toString('hex');
    for (const [key, value] of plans) if (value.expires <= Date.now()) plans.delete(key);
    if (plans.size >= 50) throw new Error('TOO_MANY_PLANS');
    plans.set(id, { plan, expires: Date.now() + 300000 });
    return { ok: true, plan_id: id, operation: plan.op, read_only: plan.readOnly, request: plan.request, fingerprint: plan.fingerprint, expires_in: 300 };
  }
  if (method === 'execute') {
    const found = plans.get(data.planId); plans.delete(data.planId);
    if (!found || found.expires < Date.now()) throw new Error('PLAN_EXPIRED');
    return host.callPlanned(found.plan, { maxTier: 1, allowWrites: Boolean(data.allowWrites), timeoutMs: 45000 });
  }
  if (method === 'shutdown') { await closeRemote(); await aa.shutdown(); return { closed: true }; }
  throw new Error('UNKNOWN_COMMAND');
}
let sequence = Promise.resolve();
process.on('message', message => {
  sequence = sequence.then(async () => {
    try { process.send?.({ id: message.id, ok: true, result: await command(message.method, message.data) }); }
    catch (error) {
      const known = ['LOGIN_NOT_FINISHED', 'BROWSER_NOT_OPEN', 'CLOSE_BROWSER_FIRST', 'PLAN_EXPIRED', 'TOO_MANY_PLANS', 'BROWSER_NAVIGATION_FAILED','BILLING_ACCOUNT_INVALID','BILLING_ACCOUNT_MISMATCH'];
      process.send?.({ id: message.id, ok: false, code: known.includes(error.message) ? error.message : 'BROWSER_OPERATION_FAILED' });
    }
  });
});
const timer = setInterval(() => { if (context && Date.now() > expiresAt) sequence = sequence.then(closeRemote); }, 30000);
process.on('disconnect', async () => { clearInterval(timer); await closeRemote(); await aa.shutdown(); process.exit(0); });
