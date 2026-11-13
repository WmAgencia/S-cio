/* Sócio icon language: one stroke set for navigation, KPIs and actions. */
(function(){
 'use strict';
 const dashboard='<rect x="3" y="3" width="7.6" height="7.6" rx="2"/><rect x="13.4" y="3" width="7.6" height="4.8" rx="2"/><rect x="13.4" y="10.6" width="7.6" height="10.4" rx="2"/><rect x="3" y="13.4" width="7.6" height="7.6" rx="2"/>';
 const image='<rect x="3.2" y="4.4" width="17.6" height="15.2" rx="3"/><circle cx="8.6" cy="9.4" r="1.6"/><path d="m4.4 17.4 4.7-4.7 3.3 3.3 2.9-2.9 4.3 4.3"/>';
 const paths={
  overview:dashboard,
  masterOverview:dashboard,
  connections:'<path d="M10 13.5a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.7 1.7"/><path d="M14 10.5a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1.7-1.7"/>',
  inbox:'<path d="M4 4h16v12h-5l-3 3-3-3H4z"/><path d="M7 9h10M7 12h7"/>',
  instagram:'<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.4 6.6h.01"/>',
  reports:'<rect x="4" y="12" width="3.2" height="8" rx="1.2"/><rect x="10.4" y="7" width="3.2" height="13" rx="1.2"/><rect x="16.8" y="3.5" width="3.2" height="16.5" rx="1.2"/>',
  marketing:'<path d="M4 10.2v3.6a1.7 1.7 0 0 0 1.7 1.7h2.1l7.7 3.8V4.7l-7.7 3.8H5.7A1.7 1.7 0 0 0 4 10.2z"/><path d="m8.2 15.7 1 4.3h2.9l-1.1-3.5"/><path d="M18.4 9.2a4.4 4.4 0 0 1 0 5.6"/>',
  channels:'<circle cx="12" cy="12" r="2.4"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5.1a9.8 9.8 0 0 0 0 13.8M19 5.1a9.8 9.8 0 0 1 0 13.8"/>',
  products:'<path d="M20.5 7.6 12 3.2 3.5 7.6v8.8L12 20.8l8.5-4.4V7.6z"/><path d="M3.5 7.6 12 12l8.5-4.4M12 12v8.8"/>',
  training:'<rect x="6.5" y="6.5" width="11" height="11" rx="2.4"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9 3v3.5M15 3v3.5M9 17.5V21M15 17.5V21M3 9h3.5M3 15h3.5M17.5 9H21M17.5 15H21"/>',
  agent:'<path d="M12 3.2 14.2 8.8 19.8 11l-5.6 2.2L12 18.8 9.8 13.2 4.2 11l5.6-2.2L12 3.2z"/>',
  orb:'<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.3"/><path d="M12 3.6v3M12 17.4v3M3.6 12h3M17.4 12h3"/>',
  settings:'<path d="M4 7.2h8.2M16.6 7.2h3.4M4 12h3.4M11.8 12h8.2M4 16.8h8.2M16.6 16.8h3.4"/><circle cx="14.4" cy="7.2" r="2.2"/><circle cx="9.6" cy="12" r="2.2"/><circle cx="14.4" cy="16.8" r="2.2"/>',
  team:'<circle cx="9" cy="8.2" r="3.2"/><path d="M3.2 20a5.8 5.8 0 0 1 11.6 0"/><circle cx="17.2" cy="9.4" r="2.5"/><path d="M16 15.2a4.8 4.8 0 0 1 4.8 4.8"/>',
  admin:'<path d="M4 20.5V5.2A1.7 1.7 0 0 1 5.7 3.5h7.1a1.7 1.7 0 0 1 1.7 1.7v15.3M14.5 9.8h3.8a1.7 1.7 0 0 1 1.7 1.7v9M2.5 20.5h19"/><path d="M7.2 7.5h4.2M7.2 11h4.2M7.2 14.5h4.2M17 13.5h.01M17 17h.01"/>',
  masterPlans:'<path d="M12 3.4 3.6 7.7 12 12l8.4-4.3L12 3.4z"/><path d="m3.6 12.2 8.4 4.3 8.4-4.3M3.6 16.7l8.4 4.3 8.4-4.3"/>',
  logout:'<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 7l5 5-5 5M9 12h10"/>',
  whatsapp:'<path d="M20.4 11.7a8.4 8.4 0 0 1-12.5 7.4L3.6 20.4l1.3-4.2a8.4 8.4 0 1 1 15.5-4.5z"/><path d="M8.7 8.4h1.5l.8 2-1.2.9a5.3 5.3 0 0 0 2.9 2.9l.9-1.2 2 .8v1.5a1.3 1.3 0 0 1-1.4 1.3c-3.6-.4-6.4-3.2-6.8-6.8a1.3 1.3 0 0 1 1.3-1.4z"/>',
  messages:'<rect x="3" y="5.4" width="18" height="13.2" rx="2.6"/><path d="m3.8 7.2 8.2 5.6 8.2-5.6"/>',
  campaigns:'<path d="M5.6 21V3.8"/><path d="M5.6 4.6h12.9l-2.7 4.1 2.7 4.1H5.6"/>',
  ads:image,
  image:image,
  money:'<rect x="2.8" y="6.4" width="18.4" height="11.2" rx="2.6"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.6h.01M18 14.4h.01"/>',
  clicks:'<path d="M6.2 3.4 19 11.2l-5.4 1.4-2.2 5.2L6.2 3.4z"/><path d="m13.2 13 4.6 4.6"/>',
  trend:'<path d="M4 17.2 10 11l3.6 3.6L20 8"/><path d="M14.8 8H20v5.2"/>',
  target:'<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  check:'<circle cx="12" cy="12" r="8.4"/><path d="m8.2 12.3 2.7 2.7 4.9-5.2"/>',
  clock:'<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2"/>',
  pause:'<rect x="7" y="4.8" width="3.3" height="14.4" rx="1.4"/><rect x="13.7" y="4.8" width="3.3" height="14.4" rx="1.4"/>',
  sparkle:'<path d="M11 3.6 12.8 8.9 18.1 10.7 12.8 12.5 11 17.8 9.2 12.5 3.9 10.7 9.2 8.9 11 3.6z"/><path d="m17.8 15.2.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z"/>',
  search:'<circle cx="10.9" cy="10.9" r="6.2"/><path d="m15.5 15.5 4.6 4.6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  send:'<path d="M20.6 3.4 10.2 13.8"/><path d="M20.6 3.4 14 20.6l-3.8-6.8-6.8-3.8L20.6 3.4z"/>',
  calendar:'<rect x="3.4" y="5" width="17.2" height="15.4" rx="3"/><path d="M3.4 10.2h17.2M8 3.2v3.6M16 3.2v3.6"/>',
  bell:'<path d="M18 16.4H6c1.2-1.3 1.8-2.4 1.8-4.7v-1.8a4.2 4.2 0 0 1 8.4 0v1.8c0 2.3.6 3.4 1.8 4.7z"/><path d="M10.2 19.3a2 2 0 0 0 3.6 0"/>',
  alert:'<path d="M12 3.6 21.4 20H2.6L12 3.6z"/><path d="M12 9.4v4.8M12 17.2h.01"/>',
  eye:'<path d="M2.8 12S6 5.9 12 5.9 21.2 12 21.2 12 18 18.1 12 18.1 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="3"/>',
  edit:'<path d="M4.2 19.8 8.6 18.8 19 8.4a2.4 2.4 0 0 0-3.4-3.4L5.2 15.4l-1 4.4z"/><path d="m14.4 6.2 3.4 3.4"/>',
  trash:'<path d="M4.2 6.8h15.6M9.6 6.8V4.6h4.8v2.2M6.4 6.8l.9 13.2h9.4l.9-13.2"/><path d="M10 10.8v5.6M14 10.8v5.6"/>',
  upload:'<path d="M12 16.2V4.2M7.6 8.6 12 4.2l4.4 4.4"/><path d="M4 15.4v2.4a2.6 2.6 0 0 0 2.6 2.6h10.8a2.6 2.6 0 0 0 2.6-2.6v-2.4"/>',
  video:'<rect x="3" y="5.4" width="12.6" height="13.2" rx="3"/><path d="m15.6 10.2 5.4-3.2v10l-5.4-3.2"/>',
  mic:'<rect x="9.2" y="3" width="5.6" height="10.6" rx="2.8"/><path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0M12 17.6V21"/>',
  play:'<path d="M8.2 5.4 19 12 8.2 18.6V5.4z"/>',
  swap:'<path d="M4 8.2h13.2l-3-3M20 15.8H6.8l3 3"/>',
  chevron:'<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  arrow:'<path d="M6.5 17.5 17.5 6.5M9.5 6.5h8v8"/>'
 };
 const cache=new Map();
 function svg(name,className){
  const body=paths[name]||paths.overview;
  const key=(name||'overview')+'|'+(className||'');
  if(cache.has(key))return cache.get(key);
  const markup='<svg'+(className?' class="'+className+'"':'')+' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+body+'</svg>';
  cache.set(key,markup);
  return markup;
 }
 globalThis.SocioIcons={svg,has:name=>Object.prototype.hasOwnProperty.call(paths,name),names:()=>Object.keys(paths)};
})();
