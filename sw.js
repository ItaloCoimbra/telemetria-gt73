const VERSAO = "gt73-v5";
const ARQUIVOS = [
  "./",
  "./index.html",
  "./app.js",
  "./painel.js",
  "./viagem.js",
  "./decodificador.js",
  "./nuvem.js",
  "./calibracao.js",
  "./estilo.css",
  "./manifest.webmanifest",
  "./ui/formato.js",
  "./ui/armazenamento.js",
  "./ui/graficos.js",
  "./ui/telas.js",
  "./icones/icone.svg",
  "./icones/icone-180.png",
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-maskable-192.png",
  "./icones/icone-maskable-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    fetch(evento.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(evento.request, copia));
        return resposta;
      })
      .catch(() => caches.match(evento.request))
  );
});
