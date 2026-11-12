import { expect, test } from "@playwright/test";

import { entrar } from "./apoio";

const navegacao = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Seções" });

test("dono abre no resumo do dia e vai direto ao que pede atenção", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/hoje$/);
  await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible();

  // O salão agora (ao vivo) e a noite até aqui.
  await expect(page.getByRole("term").filter({ hasText: "Ocupadas" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Vendeu" })).toBeVisible();
  await expect(page.getByRole("term").filter({ hasText: "Ficou na mesa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que esperar de hoje" })).toBeVisible();

  // Um ingrediente veio mais caro na última compra (na demonstração, pelo menos a muçarela):
  // só o dono vê, e o link leva direto para a aba Perdas.
  const pendencias = page.getByTestId("pendencias");
  const preco = pendencias.locator('[data-tipo="preco"]').first();
  await expect(preco).toContainText(/ subiu \d+%/);
  await preco.getByRole("link", { name: /^Ver as perdas/ }).click();
  await expect(page).toHaveURL(/\/estoque\?aba=perdas$/);
  await expect(page.getByRole("tab", { name: "Perdas" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("term").filter({ hasText: "Custo pela ficha" })).toBeVisible();
});

test("gerente vê o resumo sem custo; o garçom não tem a tela", async ({ page }) => {
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/); // quem trabalha no salão abre no salão
  await navegacao(page).getByRole("link", { name: "Hoje" }).click();
  await expect(page.getByRole("term").filter({ hasText: "Mesas atendidas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que pede atenção" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "O que esperar de hoje" })).toBeVisible();
  // Perdas em reais e preço que subiu são custo: ficam com o dono.
  await expect(page.locator('[data-tipo="preco"], [data-tipo="perdas"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Sair" }).click();
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await expect(navegacao(page).getByRole("link", { name: "Hoje" })).toHaveCount(0);
  await page.goto("/hoje");
  await expect(page.getByText("O resumo do dia fica com o dono e o gerente.")).toBeVisible();
});

test("a tela mostra o esqueleto na primeira vez e reabre na hora depois", async ({ page }) => {
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);

  // Servidor lento: na primeira visita aparece o lugar reservado, não uma tela vazia.
  let atraso = 1500;
  await page.route("**/api/estoque*", async (rota) => {
    await new Promise((pronto) => setTimeout(pronto, atraso));
    await rota.continue();
  });
  await navegacao(page).getByRole("link", { name: "Estoque" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Abrindo o estoque" })).toBeVisible();
  const mucarela = page.getByRole("rowheader", { name: /Muçarela/ }).first();
  await expect(mucarela).toBeVisible();

  // Sai e volta: mesmo com o servidor demorando 8 s, a tela abre com o que já tinha.
  await navegacao(page).getByRole("link", { name: "Cozinha" }).click();
  await expect(page.getByRole("heading", { name: "Cozinha", exact: true })).toBeVisible();
  atraso = 8000;
  await navegacao(page).getByRole("link", { name: "Estoque" }).click();
  await expect(mucarela).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole("status").filter({ hasText: "Abrindo o estoque" })).toHaveCount(0);
});
