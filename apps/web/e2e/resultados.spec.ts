import { expect, test } from "@playwright/test";

import { entrar, preferirPlanta } from "./apoio";

// O seed cria 4 semanas de noites de demonstração: é delas que saem os números.
test.beforeEach(async ({ page }) => preferirPlanta(page));

test("dono vê o dinheiro que ficou na mesa, pergunta ao Copiloto e simula o E se", async ({
  page,
}) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Resultados" })
    .click();
  await expect(page.getByRole("heading", { name: "Resultados" })).toBeVisible();

  await page.getByRole("button", { name: "4 semanas" }).click();
  await expect(page).toHaveURL(/periodo=mes/);
  await expect(page.getByTestId("perdido-total")).toContainText("R$");
  await expect(page.getByText("A conta", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesas que mais custaram" })).toBeVisible();

  // Sem chave da IA, o Copiloto responde com as regras, só com os números do salão.
  await page.getByRole("button", { name: "Qual mesa mais me dá prejuízo?" }).click();
  const respostas = page.getByTestId("respostas-copiloto");
  await expect(respostas).toContainText("foi a que mais custou");
  await expect(respostas).toContainText("Resposta automática");

  // E se tivesse um garçom a mais? A espera cai.
  const eSe = page.getByTestId("resultado-e-se");
  await expect(eSe).toContainText("R$");
  await page.getByRole("button", { name: "Um garçom a mais (com a mudança)" }).click();
  await expect(eSe).toContainText("Espera pelo garçom vai de");
});

test("dono revê a pior noite no salão com o mapa de calor", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/resultados?periodo=semana");
  await page.getByRole("link", { name: /Rever a pior noite/ }).click();
  await expect(page).toHaveURL(/\/resultados\/replay\?dia=/);

  const replay = page.getByTestId("replay");
  const hora = page.getByTestId("hora-replay");
  const inicio = await hora.textContent();
  await page.getByRole("button", { name: "Rápido" }).click();
  await page.getByRole("button", { name: "Assistir", exact: true }).click();
  await expect(hora).not.toHaveText(inicio ?? "");
  await page.getByRole("button", { name: "Pausar" }).click();

  await page.getByLabel("Mapa de calor").check();
  await expect(replay).toHaveAttribute("data-calor", "sim");

  // Um momento da noite leva o relógio até lá e mostra a noite daquela mesa.
  const momento = page
    .getByRole("region", { name: "Momentos da noite" })
    .getByRole("button")
    .first();
  await momento.click();
  await expect(page.getByTestId("linha-da-mesa")).toContainText("pessoas");
});

test("dono muda o ticket médio e o resultado usa o valor novo", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/ajustes");
  await page.getByLabel("Quanto cada pessoa gasta, em média (R$)").fill("90");
  await page.getByRole("button", { name: "Salvar ajustes" }).click();
  await expect(page.getByText("Ajustes salvos.")).toBeVisible();

  await page.goto("/resultados?periodo=semana");
  await expect(page.getByText("Estimativa com R$ 90 por pessoa.")).toBeVisible();
});

test("garçom não abre os resultados", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await expect(page.getByTestId("mesa-1")).toBeVisible();
  await page.goto("/resultados");
  await expect(
    page.getByText("Os resultados do salão ficam com o dono e o gerente."),
  ).toBeVisible();
});
