import {chromium} from 'playwright-core';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';
import {browserChoice} from 'api-anything';
import {allowFlowResource,allowFlowNavigation,validateFlowInput} from './browser-policy.mjs';
const require=createRequire(import.meta.url);
const internal=pathToFileURL(join(dirname(require.resolve('api-anything')),'session.js')).href;
const sessions=await import(internal);
const SITE='flow.google.com';
let browser,context,page,expires=0;
const fail=code=>Object.assign(Error(code),{code});
const target='https://flow.google.com/';
function executable(){const path=process.env.BROWSER_EXECUTABLE_PATH||browserChoice()?.bin||chromium.executablePath();return existsSync(path)?path:null;}
function stored(){return sessions.loadSession(SITE);}
function current(){if(!page||page.isClosed())throw fail('BROWSER_NOT_OPEN');return page;}
export async function closeFlowBrowser(){await browser?.close().catch(()=>{});browser=null;context=null;page=null;}
function status(){const s=stored();return {configured:Boolean(executable()),session_present:Boolean(s.values?.flowOwnerStorageState),
 remote_browser_open:Boolean(context),browser_page:page&&!page.isClosed()&&allowFlowNavigation(page.url())?new URL(page.url()).origin+new URL(page.url()).pathname:null};}
export async function flowBrowserCommand(kind,data={}){
 if(kind==='status')return status();
 if(kind==='close'){await closeFlowBrowser();return {closed:true};}
 if(kind==='open'){
  if(!context){
   const executablePath=executable();if(!executablePath)throw fail('CHROMIUM_UNAVAILABLE');
   let storageState;try{storageState=JSON.parse(stored().values?.flowOwnerStorageState||'null')||undefined;}catch{}
   try{
    browser=await chromium.launch({executablePath,headless:true,
     chromiumSandbox:process.platform==='linux'&&process.env.SOCIO_META_BROWSER_SANDBOX!=='false'});
    context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',storageState});
    await context.route('**/*',route=>{
     const req=route.request();return (req.isNavigationRequest()?allowFlowNavigation(req.url()):allowFlowResource(req.url()))?route.continue():route.abort();
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    context.on('page',p=>{page=p;p.on('dialog',d=>d.dismiss().catch(()=>{}));});
    page=await context.newPage();
    await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});
    if(!allowFlowNavigation(page.url()))throw fail('BROWSER_NAVIGATION_FAILED');
   }catch(error){await closeFlowBrowser();throw fail(error.code==='BROWSER_NAVIGATION_FAILED'?error.code:'BROWSER_UNAVAILABLE');}
  }
  expires=Date.now()+20*60000;return {...status(),width:1280,height:800};
 }
 if(kind==='screen')return {jpeg:(await current().screenshot({type:'jpeg',quality:65,timeout:10000})).toString('base64')};
 if(kind==='input'){
  const d=validateFlowInput(data),p=current();
  if(d.kind==='click')await p.mouse.click(d.x,d.y);
  if(d.kind==='text')await p.keyboard.insertText(d.text);
  if(d.kind==='key')await p.keyboard.press(d.key);
  if(d.kind==='scroll')await p.mouse.wheel(0,d.delta);
  expires=Date.now()+20*60000;return {ok:true};
 }
 if(kind==='finish'){
  const p=current();
  const account=await p.locator('button[aria-label*="Conta do Google"],button[aria-label*="Google Account"]').count();
  const inFlow=new URL(p.url()).hostname==='flow.google.com';
  if(!inFlow||!account)throw fail('LOGIN_NOT_FINISHED');
  const raw=await context.storageState();
  const cookies=raw.cookies.filter(c=>{const h=c.domain.replace(/^\./,'');return h==='google.com'||h.endsWith('.google.com')||h==='labs.google';});
  const origins=raw.origins.filter(o=>['https://flow.google.com','https://labs.google'].includes(o.origin));
  const old=stored();
  sessions.saveSession(SITE,{...old,cookies,source:'window',
   values:{...old.values,flowOwnerStorageState:JSON.stringify({cookies,origins})},
   kinds:{...old.kinds,flowOwnerStorageState:'credential'},valueHosts:{...old.valueHosts,flowOwnerStorageState:'flow.google.com'}});
  await closeFlowBrowser();return {session_saved:true,live_validated:false};
 }
 throw fail('UNKNOWN_COMMAND');
}
const timer=setInterval(()=>{if(context&&Date.now()>expires)void closeFlowBrowser();},30000);timer.unref();
