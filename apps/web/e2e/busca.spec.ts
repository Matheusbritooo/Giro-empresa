import { expect, type Page, test } from "@playwright/test";

import { entrar, entrarNoSalao, preferirPlanta } from "./apoio";

test.beforeEach(async ({ page }) => preferirPlanta(page));

const janela = (page: Page) => page.getByRole("dialog", { name: "Buscar" });

test("a busca acha mesa, prato, ingrediente e tela de qualquer lugar", async ({ page }) => {
  await entrarNoSalao(page, "marcos@cantina.demo");

  // Pelo botão do menu: a mesa pelo número leva direto para o pedido dela.
  await page.getByRole("button", { name: "Buscar" }).click();
  const campo = janela(page).getByRole("combobox", { name: "O que você procura?" });
  await campo.fill("7");
  const resultados = janela(page).getByRole("listbox", { name: "Resultados" });
  await expect(resultados.getByRole("option").first()).toContainText("Mesa 7");
  await campo.press("Enter");
  await expect(page.getByRole("heading", { name: "Mesa 7", exact: true })).toBeVisible();
  await expect(janela(page)).toBeHidden();

  // Pelo atalho "/": sem acento acha o ingrediente e vai para o estoque.
  await page.keyboard.press("/");
  await campo.fill("mucarela");
  await expect(resultados.getByRole("option").first()).toContainText("Muçarela");
  await expect(resultados.getByRole("option").first()).toContainText("Ingrediente");
  await resultados.getByRole("option").first().click();
  await expect(page).toHaveURL(/\/estoque$/);

  // Pelo assunto da tela: "contador" leva ao relatório do mês.
  await page.keyboard.press("Control+k");
  await campo.fill("contador");
  await campo.press("ArrowDown");
  await campo.press("Enter");
  await expect(page).toHaveURL(/\/resultados\/relatorio$/);

  // Nada encontrado diz o que tentar.
  await page.getByRole("button", { name: "Buscar" }).click();
  await campo.fill("xyzw");
  await expect(janela(page)).toContainText("Nada com “xyzw”");
  await janela(page).getByRole("button", { name: "Fechar" }).click();
  await expect(janela(page)).toBeHidden();
});

test("o garçom só acha as telas que ele abre", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.getByRole("button", { name: "Buscar" }).click();
  const campo = janela(page).getByRole("combobox", { name: "O que você procura?" });
  await campo.fill("ajustes");
  await expect(janela(page)).toContainText("Nada com “ajustes”");
  await campo.fill("cozinha");
  await campo.press("Enter");
  await expect(page).toHaveURL(/\/cozinha$/);
});
