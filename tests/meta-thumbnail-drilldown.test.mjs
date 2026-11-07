import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/socio-workspace-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/socio-executive.css',import.meta.url),'utf8');
const tools=readFileSync(new URL('../meta-ads-tools.mjs',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');

test('the campaign drilldown remains the only general ad listing',()=>{
 assert.match(ui,/selectedAdset\?'Anúncios do conjunto'/);
 assert.match(ui,/campaignAdsets\.length\?adsetRows/);
 assert.match(ui,/visibleAds\.length\?adCards\(visibleAds,manage\)/);
 assert.doesNotMatch(ui,/section\('Anúncios e criativos'/);
 assert.match(ui,/data-px-adset-back/);
});
test('list cards load verified and account-scoped video thumbnails as they enter view',()=>{
 assert.match(ui,/posterOnly=1/);
 assert.match(ui,/IntersectionObserver/);
 assert.match(ui,/const posterCache=new Map\(\)/);
 assert.match(ui,/const applyPoster=/);
 assert.match(ui,/holder\.classList\.add\('px-has-poster'\)/);
 assert.match(server,/posterOnly:?.*120:36/);
 assert.match(tools,/if\(options\.posterOnly\)return/);
 assert.match(tools,/const thumbs=await graph\(c,'\/'\+videoId/);
 assert.match(tools,/posterUrl=safeMedia\(video\.picture\)\|\|posterUrl/);
});
test('featured ad poster fills the media frame without showing extra placeholder text',()=>{
 assert.match(css,/\.px-featured-item\.px-featured-video>\.px-feature-media \.px-feature-poster/);
 assert.match(css,/object-fit:cover!important/);
 assert.match(css,/\.px-feature-media\.px-media-lowres::after\{display:none!important\}/);
 assert.match(ui,/applyPoster\(holder,poster,'Miniatura do anúncio '/);
 assert.doesNotMatch(ui,/holder\.insertAdjacentHTML\('afterbegin',posterView\(poster/);
});
