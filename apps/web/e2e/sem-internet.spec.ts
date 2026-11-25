import { expect, test } from "@playwright/test";

import { entrar, preferirPlanta } from "./apoio";

// Este teste liga o service worker (os outros desligam: ele responde antes do page.route).
test.use({ serviceWorkers: "allow" });
test.beforeEach(async ({ page }) => preferirPlanta(page));

// A mesa do garçom no teste de pedidos (já tem pedido, um a mais não atrapalha ninguém).
const MESA = { celular: 4, computador: 8 };

test("o garçom abre o GIRO do zero sem internet e lança o pedido", async ({
  page,
  context,
}, info) => {
  const mesa = MESA[info.project.name as keyof typeof MESA];
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  // Com internet, o aparelho guarda as telas do salão e o que precisa para lançar pedido.
  await page.waitForFunction(async () => {
    const registro = await navigator.serviceWorker.ready;
    return !!registro.active && !!navigator.serviceWorker.controller;
  });
  await page.reload(); // a primeira visita com o service worker no comando guarda os dados
  await expect(page.getByTestId(`mesa-${mesa}`)).toBeVisible();
  await page.getByTestId(`mesa-${mesa}`).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /lançar pedido/i })
    .click();
  await expect(page.getByRole("heading", { name: `Mesa ${mesa}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Refrigerante lata/ })).toBeVisible();
  const pedido = page.url();

  // O Wi-Fi cai e o celular fecha o navegador. Abre de novo, do zero, sem internet.
  await context.setOffline(true);
  await page.goto("/salao");
  const faixa = page.getByTestId("faixa-conexao");
  await expect(faixa).toContainText("Sem conexão");
  await expect(page.getByTestId(`mesa-${mesa}`)).toBeVisible();

  // O pedido da mesa abre com o cardápio guardado, e o lançamento vai para a fila.
  await page.goto(pedido);
  await expect(page.getByRole("heading", { name: `Mesa ${mesa}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Refrigerante lata/ }).click();
  await page.getByRole("button", { name: "Lançar pedido" }).click();
  await expect(
    page.getByText(
      `Sem conexão. Pedido da mesa ${mesa} guardado: sobe sozinho quando a rede voltar.`,
    ),
  ).toBeVisible();

  // A rede volta: o pedido sobe sozinho.
  await context.setOffline(false);
  await expect(page.getByTestId("esperando-rede")).toHaveCount(0, { timeout: 20_000 });
  await expect(faixa).toHaveText(`Pedido da mesa ${mesa} enviado.`);
});

test("quem sai da conta não deixa dado guardado no aparelho", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);
  await page.reload();
  await expect.poll(() => page.evaluate(() => caches.has("giro-dados"))).toBe(true);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect.poll(() => page.evaluate(() => caches.has("giro-dados"))).toBe(false);
});
