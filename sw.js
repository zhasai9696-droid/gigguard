const CACHE='gigguard-shell-v1';
const shell=['./','./index.html','./style.css','./app.mjs','./domain.mjs','./store.mjs','./ocr.mjs','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./ocr/tesseract.min.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(shell))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gigguard-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(self.registration.scope)) return;
  e.respondWith(fetch(e.request).catch(async()=>{
    const cache=await caches.open(CACHE);
    return await cache.match(e.request,{ignoreSearch:true})||(e.request.mode==='navigate'&&await cache.match('./index.html'))||Response.error();
  }));
});

