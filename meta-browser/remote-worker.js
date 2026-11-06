// One process and API_ANYTHING_HOME per connection. Never change process.env between users.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
let context; let page; let expiresAt = 0;
const plans = new Map();
function activePage() {
  if ((!page || page.isClosed()) && context) page = context.pages().filter(p => !p.isClosed()).at(-1);
  if (!page || page.isClosed()) throw new Error('BROWSER_NOT_OPEN');
  return page;
}
const allowed = value => {
  try {
    const url = new URL(value);
    return ['https:', 'wss:'].includes(url.protocol) && ['facebook.com', 'facebook.net', 'fbcdn.net', 'fbsbx.com', 'instagram.com', 'cdninstagram.com', 'meta.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
};
async function closeRemote() {
  if (context) await context.close().catch(() => {});
  context = null; page = null;
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
      browser_page: page && !page.isClosed() && allowed(page.url()) ? new URL(page.url()).origin + new URL(page.url()).pathname : null,
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
      await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort());
      await context.routeWebSocket('**/*', socket => { if (allowed(socket.url())) socket.connectToServer(); else socket.close(); });
      context.on('page', popup => { page = popup; popup.on('dialog', dialog => dialog.dismiss().catch(() => {})); });
      page = context.pages()[0] || await context.newPage();
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      if (!allowed(page.url())) { await closeRemote(); throw new Error('BROWSER_NAVIGATION_FAILED'); }
    }
    expiresAt = Date.now() + 20 * 60000;
    return { open: true, width: 1280, height: 800, expires_in: 1200 };
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
      const known = ['LOGIN_NOT_FINISHED', 'BROWSER_NOT_OPEN', 'CLOSE_BROWSER_FIRST', 'PLAN_EXPIRED', 'TOO_MANY_PLANS', 'BROWSER_NAVIGATION_FAILED'];
      process.send?.({ id: message.id, ok: false, code: known.includes(error.message) ? error.message : 'BROWSER_OPERATION_FAILED' });
    }
  });
});
const timer = setInterval(() => { if (context && Date.now() > expiresAt) sequence = sequence.then(closeRemote); }, 30000);
process.on('disconnect', async () => { clearInterval(timer); await closeRemote(); await aa.shutdown(); process.exit(0); });
