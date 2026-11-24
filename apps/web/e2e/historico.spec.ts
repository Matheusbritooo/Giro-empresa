import { expect, type Page, test } from "@playwright/test";

import { entrar, preferirPlanta } from "./apoio";

test.beforeEach(async ({ page }) => preferirPlanta(page));

const historico = (page: Page) => page.getByTestId("historico");

test("dono vê quem fez o quê, com o nome e a hora, e filtra por assunto", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/hoje$/);

  // O dono marca que o tiramisù acabou e volta com ele: as duas coisas ficam no histórico.
  await page.goto("/cardapio");
  const tiramisu = page.getByRole("listitem").filter({ hasText: "Tiramisù" }).getByRole("checkbox");
  await tiramisu.uncheck();
  await expect(page.getByText("Tiramisù marcado como acabou.")).toBeVisible();
  await tiramisu.check();
  await expect(page.getByText("Tiramisù voltou para o cardápio de hoje.")).toBeVisible();

  await page.goto("/ajustes");
  await page.getByRole("link", { name: "Quem fez o quê" }).click();
  await expect(page).toHaveURL(/\/historico$/);
  const hoje = historico(page).getByRole("region", { name: "Hoje" });
  await expect(hoje.getByRole("listitem").first()).toContainText('Marcou Tiramisù como "tem hoje"');
  await expect(hoje.getByRole("listitem").first()).toContainText("Marcos Andrade");
  await expect(hoje).toContainText('Marcou Tiramisù como "acabou"');

  // As 4 semanas de demonstração: compras, perdas e contagens da equipe.
  await page.getByLabel("Assunto").selectOption("estoque");
  await expect(page).toHaveURL(/assunto=estoque/);
  await expect(historico(page)).toContainText("Contou 18 ingredientes");
  await expect(historico(page)).toContainText("Lançou a compra de");
  await expect(historico(page)).not.toContainText("Tiramisù");

  // Por pessoa: só o que o gerente fez.
  await page.getByLabel("Quem").selectOption({ label: "Gerente da Cantina" });
  await expect(historico(page)).not.toContainText("Garçom da Cantina");
  await page.getByRole("button", { name: "30 dias" }).click();
  await expect(page).toHaveURL(/periodo=mes/);
  await expect(historico(page)).toContainText("Cadastrou 18 ingredientes no estoque");
});

test("o histórico é só do dono", async ({ page }) => {
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/historico");
  await expect(page.getByText("O histórico de quem fez o quê fica com o dono.")).toBeVisible();
});

test("restaurante novo vê os primeiros passos na tela Hoje", async ({ page }, info) => {
  // A equipe GIRO ativa um cliente novo.
  const email = `dono-${info.project.name}-${Date.now()}@novo.demo`;
  await entrar(page, "admin@giro.demo");
  await expect(page).toHaveURL(/\/restaurantes$/);
  await page.getByLabel("Nome do restaurante").fill(`Bar do Teste ${info.project.name}`);
  await page.getByLabel("Nome do dono").fill("Dona do Bar");
  await page.getByLabel("E-mail do dono").fill(email);
  await page.getByLabel("Senha inicial do dono").fill("giro1234");
  await page.getByRole("button", { name: "Ativar restaurante" }).click();
  await expect(page.getByText(`Bar do Teste ${info.project.name}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();

  // A dona entra pela primeira vez: a lista do que falta, com o próximo passo em destaque.
  await entrar(page, email);
  await expect(page).toHaveURL(/\/hoje$/);
  const passos = page.getByTestId("primeiros-passos");
  await expect(passos).toContainText("0 de 8 prontos");
  await expect(passos.locator('[data-passo="mesas"]')).toHaveAttribute("data-feito", "nao");
  await passos.getByRole("link", { name: "Fazer agora: Cadastre as mesas do salão" }).click();
  await expect(page).toHaveURL(/\/mesas$/);
  await page.getByLabel("Número").first().fill("1");
  await page.getByRole("button", { name: "Cadastrar mesa" }).click();
  await expect(page.getByText("Mesa 1 cadastrada.")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Hoje" })
    .click();
  await expect(passos).toContainText("1 de 8 prontos");
  await expect(passos.locator('[data-passo="mesas"]')).toHaveAttribute("data-feito", "sim");

  // Já sabe o caminho: esconde a lista neste aparelho.
  await passos.getByRole("button", { name: "Esconder neste aparelho" }).click();
  await expect(passos).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Agora no salão" })).toBeVisible();
  await expect(passos).toBeHidden();
});
