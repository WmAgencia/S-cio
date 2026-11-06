import test from 'node:test';
import assert from 'node:assert/strict';
import {allowRemoteResource,isMetaURL} from '../meta-browser/network-policy.js';
test('real reCAPTCHA resources may load without authorizing arbitrary Google or outside sites',()=>{
 for(const url of ['https://www.google.com/recaptcha/enterprise.js?render=key','https://www.gstatic.com/recaptcha/releases/version/recaptcha__pt_br.js','https://recaptcha.google.com/recaptcha/api2/anchor','https://www.recaptcha.net/recaptcha/enterprise/reload'])assert.equal(allowRemoteResource(url),true,url);
 for(const url of ['https://www.google.com/search?q=secret','https://www.gstatic.com/arbitrary.js','https://www.google.com.evil.test/recaptcha/enterprise.js','http://www.google.com/recaptcha/enterprise.js','https://www.google.com:8443/recaptcha/enterprise.js','http://127.0.0.1:8080/','https://user:password@www.google.com/recaptcha/enterprise.js'])assert.equal(allowRemoteResource(url),false,url);
 assert.equal(isMetaURL('https://www.google.com/recaptcha/enterprise.js'),false);
 assert.equal(isMetaURL('https://adsmanager.facebook.com/'),true);
 assert.equal(isMetaURL('wss://edge-chat.facebook.com/ws'),true);
 assert.equal(isMetaURL('https://facebook.com.evil.test/'),false);
});
