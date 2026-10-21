// Service worker do GIRO: recebe os alertas e mostra no celular, mesmo com o painel fechado.

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
