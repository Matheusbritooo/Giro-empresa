// Service worker do GIRO.
//
// 1. Avisos no celular: recebe os alertas e mostra, mesmo com o painel fechado.
// 2. Painel sem internet: o Wi-Fi do salão caiu e o garçom abre o GIRO do zero. As telas e os
//    arquivos do painel vêm do aparelho, e só três dados ficam guardados para dar para lançar
//    pedido: a sessão, o salão e o cardápio (mais o pedido de cada mesa aberta). Com internet,
//    sempre vale o que vem do servidor; o guardado só aparece quando a rede falha, e a resposta
//    leva a marca "x-giro-guardado" para o painel mostrar "Sem conexão". Ao sair da conta, os
//    dados guardados são apagados (o painel apaga o cache "giro-dados").

const TELAS = "giro-telas"; // HTML das telas (sem dado nenhum: o painel busca tudo depois)
const ARQUIVOS = "giro-arquivos"; // JavaScript, CSS, ícones e fontes do painel
const DADOS = "giro-dados"; // sessão, salão, cardápio e pedido da mesa
const CACHES = [TELAS, ARQUIVOS, DADOS];
const MAXIMO_ARQUIVOS = 400;

// As telas de quem trabalha no salão: ficam prontas assim que o service worker instala.
const TELAS_DO_SALAO = ["/salao", "/pedido", "/cozinha", "/hoje", "/entrar"];
const DADOS_GUARDADOS = [
  /^\/api\/auth\/sessao$/,
  /^\/api\/salao$/,
  /^\/api\/cardapio$/,
  /^\/api\/mesas\/\d+\/pedido$/,
];
const ARQUIVO = /^\/(_next\/static\/|icone|modelos\/|favicon)/;

const SEM_INTERNET = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GIRO sem internet</title>
<body style="font-family:system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<h1>Sem internet</h1><p>Este aparelho ainda não tinha aberto essa tela do GIRO com internet.
Quando a rede voltar, abra o GIRO uma vez e ele passa a abrir também sem internet.</p>`;

self.addEventListener("install", (evento) => {
  self.skipWaiting();
  evento.waitUntil(aquecer().catch(() => undefined));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => !CACHES.includes(n)).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Guarda as telas do salão e os arquivos que elas carregam. */
async function aquecer() {
  const telas = await caches.open(TELAS);
  const arquivos = await caches.open(ARQUIVOS);
  for (const caminho of TELAS_DO_SALAO) {
    const resposta = await fetch(caminho, { credentials: "same-origin" });
    if (!resposta.ok) continue;
    const html = await resposta.clone().text();
    await telas.put(caminho, resposta);
    const usados = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
    await Promise.all(
      [...usados].map((url) =>
        arquivos.match(url).then((tem) => tem || arquivos.add(url).catch(() => undefined)),
      ),
    );
  }
}

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const url = new URL(pedido.url);

  if (DADOS_GUARDADOS.some((padrao) => padrao.test(url.pathname))) {
    evento.respondWith(dado(pedido));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (ARQUIVO.test(url.pathname)) {
    evento.respondWith(arquivo(pedido));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/m/")) return;
  if (pedido.mode === "navigate") {
    evento.respondWith(tela(pedido));
    return;
  }
  // Troca de tela dentro do painel (o Next busca só o conteúdo da tela nova).
  if (pedido.headers.get("RSC") === "1") evento.respondWith(conteudo(pedido));
});

/** Arquivo com nome que muda a cada versão: do aparelho, se já tem; senão da rede. */
async function arquivo(pedido) {
  const cache = await caches.open(ARQUIVOS);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;
  const resposta = await fetch(pedido);
  if (resposta.ok) {
    await cache.put(pedido, resposta.clone());
    aparar(cache);
  }
  return resposta;
}

async function aparar(cache) {
  const chaves = await cache.keys();
  const sobra = chaves.length - MAXIMO_ARQUIVOS;
  for (const chave of chaves.slice(0, Math.max(sobra, 0))) await cache.delete(chave);
}

/** A tela: da rede (e guarda); sem rede, a última guardada dessa tela, ou o salão. */
async function tela(pedido) {
  const cache = await caches.open(TELAS);
  const caminho = new URL(pedido.url).pathname;
  try {
    const resposta = await fetch(pedido);
    if (resposta.ok && !resposta.redirected) await cache.put(caminho, resposta.clone());
    return resposta;
  } catch {
    const guardada = (await cache.match(caminho)) || (await cache.match("/salao"));
    return (
      guardada ||
      new Response(SEM_INTERNET, { headers: { "content-type": "text/html; charset=utf-8" } })
    );
  }
}

async function conteudo(pedido) {
  const cache = await caches.open(TELAS);
  try {
    const resposta = await fetch(pedido);
    if (resposta.ok) await cache.put(pedido, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardado = await cache.match(pedido);
    if (guardado) return guardado;
    throw erro; // o Next recarrega a tela inteira, e aí vale a tela guardada
  }
}

/** Dado: sempre do servidor; o guardado só quando a rede falha, com a marca "x-giro-guardado". */
async function dado(pedido) {
  const cache = await caches.open(DADOS);
  try {
    const resposta = await fetch(pedido);
    if (resposta.status === 200) await cache.put(pedido, resposta.clone());
    if (resposta.status === 401) await caches.delete(DADOS); // saiu da conta
    return resposta;
  } catch (erro) {
    const guardado = await cache.match(pedido);
    if (!guardado) throw erro;
    const cabecalhos = new Headers(guardado.headers);
    cabecalhos.set("x-giro-guardado", "1");
    return new Response(guardado.body, { status: 200, headers: cabecalhos });
  }
}

self.addEventListener("push", (evento) => {
  const dados = evento.data ? evento.data.json() : {};
  evento.waitUntil(
    self.registration.showNotification(dados.titulo || "GIRO", {
      body: dados.corpo || "",
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      tag: dados.titulo, // o mesmo alerta não empilha notificações repetidas
      renotify: true,
      vibrate: [120, 80, 120],
      data: { url: dados.url || "/salao" },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = new URL(evento.notification.data.url, self.location.origin).href;
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((j) => j.url.startsWith(self.location.origin));
      if (aberta) {
        aberta.navigate(url);
        return aberta.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
