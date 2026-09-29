const CACHE='gamayati-v10';
const ASSETS=['./','./index.html','./style.css','./app.js?v=9','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^gamayati-/i.test(k)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin)return;
  e.respondWith((async()=>{try{const resp=await fetch(e.request);if(resp.ok){const c=await caches.open(CACHE);await c.put(e.request,resp.clone())}return resp}catch{return (await caches.match(e.request))||caches.match('./index.html')}})());
});
