const CACHE='Gamayati-v04';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json','./icon.svg'];

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(
    keys
      .filter(k=>(k.startsWith('Gamayati-')||k.startsWith('gamayati-'))&&k!==CACHE)
      .map(k=>caches.delete(k))
  );
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(!url.href.startsWith(self.registration.scope))return;

  const known=ASSETS.some(a=>new URL(a,self.location.href).href===url.href);

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request)
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  if(known){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request);
        if(response.ok){
          const cache=await caches.open(CACHE);
          await cache.put(event.request,response.clone());
        }
        return response;
      }catch{
        return (await caches.match(event.request))||new Response('',{status:504});
      }
    })());
    return;
  }

  event.respondWith(fetch(event.request));
});
