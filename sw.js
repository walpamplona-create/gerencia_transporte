const CACHE_NAME = 'te-v18-1';
const URLS = ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network-first: o app está em desenvolvimento ativo (novas versões saem
  // com frequência), então sempre tenta buscar a versão mais nova da rede
  // primeiro. Só usa o que está em cache se a rede falhar (modo offline) —
  // assim o motorista nunca fica preso numa versão antiga só porque o
  // celular tinha algo em cache, mesmo que eu esqueça de trocar o nome do
  // CACHE_NAME num deploy.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.status === 200) {
        var clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});
