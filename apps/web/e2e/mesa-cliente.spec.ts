import { expect, test } from "@playwright/test";

import { camera, entrar, preferirPlanta } from "./apoio";

test.beforeEach(async ({ page }) => preferirPlanta(page));

// Mesas que nenhum teste depois deste manda foto da câmera (a câmera não aceita foto mais
// antiga que a última da mesa). Na rodada do computador, a 1 já recebeu foto do teste das
// câmeras; a 11 só recebe pedido e cancelamento depois, sem "Pediu a conta" (que aqui fica
// pedida pelo QR).
const MESA = { celular: 1, computador: 11 };

test("mesa esquecida depois do atendimento avisa e some quando o garçom passa", async ({
  page,
  request,
}, info) => {
  const mesa = MESA[info.project.name as keyof typeof MESA];
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);

  // Sentaram há 20 min, o garçom atendeu aos 18 e ninguém mais passou pela mesa.
  await camera(request, mesa, -20, -18, 2);
  await camera(request, mesa, -18, -17.7, 2, 1);
  await camera(request, mesa, -17.7, -1, 2);
  const alerta = page.getByTestId(`alerta-sem_visita-${mesa}`);
  await expect(alerta).toContainText(`Mesa ${mesa} está há tempo sem ninguém da equipe passar`);
  await alerta.getByRole("button", { name: "Vou lá" }).click();
  await expect(alerta).toContainText("alguém já está indo");

  // O garçom chega na mesa: o alerta some e a passada fica contada.
  await camera(request, mesa, -0.9, -0.6, 2, 1);
  await expect(alerta).toHaveCount(0);
  await page.getByTestId(`mesa-${mesa}`).click();
  await expect(page.getByRole("dialog").getByTestId("visitas-da-mesa")).toContainText(
    "A equipe passou 2 vezes",
  );
});

test("gerente imprime o QR e o cliente chama o garçom e pede a conta pelo celular", async ({
  page,
  browser,
  request,
}, info) => {
  const mesa = MESA[info.project.name as keyof typeof MESA];
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Mesas" })
    .click();
  const resposta = page.waitForResponse((r) => r.url().includes("/api/mesas/qr"));
  await page.getByRole("link", { name: "QR das mesas" }).click();
  const qr = (await (await resposta).json()) as { numero: number; chave: string }[];
  const chave = qr.find((m) => m.numero === mesa)?.chave ?? "";
  const cartao = page.getByTestId(`qr-mesa-${mesa}`);
  await expect(cartao.getByRole("img", { name: `QR da mesa ${mesa}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeEnabled();

  // O cliente aponta a câmera do celular: abre a página da mesa, sem login.
  const celular = await browser.newContext();
  const cliente = await celular.newPage();
  await cliente.goto(`/m/${chave}`);
  await expect(cliente.getByRole("heading", { name: `Mesa ${mesa}` })).toBeVisible();
  await expect(cliente.getByRole("heading", { name: "Cardápio de hoje" })).toBeVisible();
  await expect(cliente.getByText("Lasanha à bolonhesa").first()).toBeVisible();
  await expect(cliente.getByText("Esta página não pede seus dados")).toBeVisible();

  await cliente.getByRole("button", { name: "Chamar o garçom" }).click();
  await expect(cliente.getByText("Pronto! Alguém da equipe já vem até a mesa.")).toBeVisible();
  await expect(cliente.getByRole("button", { name: "Garçom a caminho" })).toBeDisabled();
  await cliente.getByRole("button", { name: "Pedir a conta" }).click();
  await expect(cliente.getByText("Pronto! A conta já vai até a mesa.")).toBeVisible();
  await cliente.getByRole("button", { name: /^5/ }).click();
  await expect(
    cliente.getByText("Obrigado! Sua nota ajuda o restaurante a melhorar."),
  ).toBeVisible();

  // No salão, a equipe vê os dois chamados.
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Salão" })
    .click();
  await expect(page.getByTestId(`alerta-chamou_garcom-${mesa}`)).toContainText(
    `Mesa ${mesa} chamou o garçom pelo celular`,
  );
  await expect(page.getByTestId(`alerta-pediu_conta-${mesa}`)).toContainText(
    `Mesa ${mesa} pediu a conta pelo celular`,
  );

  // O garçom chega na mesa (a câmera vê alguém em pé): os chamados somem dos dois lados.
  await camera(request, mesa, -0.3, -0.1, 2, 1);
  await expect(page.getByTestId(`alerta-chamou_garcom-${mesa}`)).toHaveCount(0);
  await expect(page.getByTestId(`alerta-pediu_conta-${mesa}`)).toHaveCount(0);
  await cliente.reload();
  await expect(cliente.getByRole("button", { name: "Chamar o garçom" })).toBeEnabled();
  await celular.close();
});
