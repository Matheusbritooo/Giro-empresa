import { expect, type Page, test } from "@playwright/test";

import { entrar, preferirPlanta } from "./apoio";

test.beforeEach(async ({ page }) => preferirPlanta(page));

// Cada projeto (celular e computador) usa mesas diferentes, já que o banco é o mesmo. E
// mesas que os outros testes não usam: pedido deixa a mesa ocupada.
const MESAS = { celular: { garcom: 4, gerente: 6 }, computador: { garcom: 8, gerente: 11 } };

/** "R$ 1.234" vira 1234 (para conferir o total mesmo se o teste rodar de novo na mesa). */
async function totalDaMesa(page: Page): Promise<number> {
  const texto = (await page.getByTestId("total-mesa").textContent()) ?? "";
  return Number(texto.replace(/\D/g, ""));
}

async function abrirPedido(page: Page, numero: number) {
  await page.getByTestId(`mesa-${numero}`).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /lançar pedido/i })
    .click();
  await expect(page.getByRole("heading", { name: `Mesa ${numero}`, exact: true })).toBeVisible();
}

test("garçom lança o pedido, a cozinha marca pronto e o salão mostra o total", async ({
  page,
}, info) => {
  const { garcom: mesa } = MESAS[info.project.name as keyof typeof MESAS];
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await abrirPedido(page, mesa);
  const antes = await totalDaMesa(page);

  // Os mais pedidos já estão no topo: 3 toques e uma observação para a cozinha.
  const lasanha = page.getByRole("button", { name: /^Lasanha à bolonhesa/ });
  await lasanha.click();
  await lasanha.click();
  await page.getByRole("button", { name: /^Refrigerante lata/ }).click();
  await page.getByRole("button", { name: "Obs." }).first().click();
  await page.getByLabel("Observação de Lasanha à bolonhesa para a cozinha").fill("uma sem queijo");
  await page.getByRole("button", { name: "Lançar pedido" }).click();
  await expect(page.getByText(`Pedido da mesa ${mesa} lançado.`)).toBeVisible();
  await expect(page.getByTestId("total-mesa")).toHaveText(
    `R$ ${(antes + 131).toLocaleString("pt-BR")}`,
  );
  await expect(page.getByTestId("estado-mesa")).toContainText("Ocupada");

  // A cozinha vê o pedido com a observação e marca o refrigerante como pronto.
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Cozinha" })
    .click();
  const lancamento = page.getByTestId(`lancamento-mesa-${mesa}`).last();
  await expect(lancamento).toContainText("uma sem queijo");
  await lancamento
    .getByRole("button", { name: `Refrigerante lata da mesa ${mesa} pronto` })
    .click();
  await expect(lancamento).not.toContainText("Refrigerante lata");

  // No salão, o detalhe da mesa mostra quanto ela já gastou e o que falta sair.
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Salão" })
    .click();
  await page.getByTestId(`mesa-${mesa}`).click();
  const detalhe = page.getByRole("dialog");
  await expect(detalhe).toContainText(`R$ ${(antes + 131).toLocaleString("pt-BR")}`);
  await expect(detalhe).toContainText("itens na cozinha"); // as 2 lasanhas

  // A mesa pede a conta: o salão mostra quando ela deve vagar. Tocou sem querer? Desfaz.
  await detalhe.getByRole("button", { name: "Pediu a conta" }).click();
  await expect(detalhe.getByTestId("conta-pedida")).toContainText("Deve vagar por volta das");
  await expect(page.getByTestId(`mesa-${mesa}`)).toContainText("Conta");
  await detalhe.getByRole("button", { name: "Desfazer" }).click();
  await expect(detalhe.getByRole("button", { name: "Pediu a conta" })).toBeVisible();
});

test("gerente cancela item com motivo e marca o que acabou", async ({ page }, info) => {
  const { gerente: mesa } = MESAS[info.project.name as keyof typeof MESAS];
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await abrirPedido(page, mesa);
  const antes = await totalDaMesa(page);
  await page.getByRole("button", { name: "Massas" }).click();
  await page.getByRole("button", { name: /^Espaguete ao sugo/ }).click();
  await page.getByRole("button", { name: "Lançar pedido" }).click();
  await expect(page.getByTestId("total-mesa")).toHaveText(
    `R$ ${(antes + 48).toLocaleString("pt-BR")}`,
  );

  await page.getByRole("button", { name: "Cancelar item" }).last().click();
  await page.getByLabel("Motivo").selectOption("Lançado errado");
  await page.getByRole("button", { name: "Cancelar item" }).last().click();
  await expect(page.getByText("Espaguete ao sugo cancelado.")).toBeVisible();
  await expect(page.locator('[data-situacao="cancelado"]').last()).toContainText("Lançado errado");
  await expect(page.getByTestId("total-mesa")).toHaveText(`R$ ${antes.toLocaleString("pt-BR")}`);

  // Tiramisù acabou: some do pedido de todos na hora (e volta no fim do teste).
  await page.goto("/cardapio");
  const tiramisu = page.getByRole("listitem").filter({ hasText: "Tiramisù" }).getByRole("checkbox");
  await expect(tiramisu).toBeChecked();
  await tiramisu.uncheck();
  await expect(page.getByText("Tiramisù marcado como acabou.")).toBeVisible();
  await page.goto("/salao");
  await abrirPedido(page, mesa);
  await page.getByRole("button", { name: "Sobremesas" }).click();
  await expect(page.getByRole("button", { name: "Tiramisù, acabou" })).toBeDisabled();

  await page.goto("/cardapio");
  await page.getByRole("listitem").filter({ hasText: "Tiramisù" }).getByRole("checkbox").check();
  await expect(page.getByText("Tiramisù voltou para o cardápio de hoje.")).toBeVisible();
});

test("dono vê o prato da semana e o que cada mesa mais pediu", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/resultados?periodo=semana");
  const cardapio = page.getByTestId("cardapio-periodo");
  await expect(cardapio.getByTestId("prato-do-periodo")).toHaveText("Lasanha à bolonhesa");
  await expect(cardapio.getByRole("table")).toContainText("Comida favorita");
  await cardapio.getByRole("button", { name: "Bebida", exact: true }).click();
  await expect(cardapio.getByRole("list", { name: /Bebidas mais pedidas/ })).toBeVisible();

  // Matriz de lucro (só o dono vê), o que sai junto e o tempo de cozinha.
  const matriz = cardapio.getByTestId("matriz-de-lucro");
  await expect(matriz.locator('[data-quadrante="estrela"]')).toContainText("Lasanha à bolonhesa");
  await expect(cardapio).toContainText("Quem pede também pede");
  await expect(cardapio).toContainText("na sexta e no sábado");
});

test("gerente vê o cardápio do período, mas a matriz de lucro é só do dono", async ({ page }) => {
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/resultados?periodo=semana");
  const cardapio = page.getByTestId("cardapio-periodo");
  await expect(cardapio).toContainText("A matriz de lucro dos pratos aparece só para o dono");
  await expect(cardapio.getByTestId("matriz-de-lucro")).toHaveCount(0);
});
