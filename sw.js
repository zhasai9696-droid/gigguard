const CACHE='gigguard-shell-v6';
const shell=['./','./index.html','./style.css?v=6','./app.mjs?v=6','./domain.mjs','./store.mjs?v=6','./schedule.mjs?v=6','./ledger.mjs?v=6','./conflicts.mjs?v=6','./ocr.mjs?v=6','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./ocr/tesseract.min.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(shell)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gigguard-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(self.registration.scope)) return;
  e.respondWith(fetch(e.request).catch(async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(e.request)||(e.request.mode==='navigate'&&await cache.match('./index.html'))||Response.error();
  }));
});
