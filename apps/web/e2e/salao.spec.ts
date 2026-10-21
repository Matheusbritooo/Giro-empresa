import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

const API = "http://localhost:8100";
const TOKEN_CAMERA = "cam_demo_cantina_do_marcos"; // criado pelo seed

/** Faz o papel da câmera: manda uma foto analisada a cada 10s entre dois instantes. */
async function camera(
  request: APIRequestContext,
  mesa: number,
  deMin: number,
  ateMin: number,
  sentados: number,
  emPe = 0,
) {
  const agora = Date.now();
  for (let t = deMin; t <= ateMin + 1e-9; t += 10 / 60) {
    const resposta = await request.post(`${API}/api/ingest/observacoes`, {
      headers: { authorization: `Bearer ${TOKEN_CAMERA}` },
      data: {
        em: new Date(agora + t * 60_000).toISOString(),
        mesas: [{ mesa, sentados, em_pe: emPe }],
      },
    });
    expect(resposta.ok()).toBeTruthy();
  }
}

async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("giro1234");
  await page.getByRole("button", { name: "Entrar" }).click();
}

// Cada projeto (celular e computador) usa mesas diferentes, já que o banco é o mesmo.
const MESAS = { celular: { esquecida: 3, suja: 5 }, computador: { esquecida: 9, suja: 12 } };

test("gerente vê cliente esquecido, avisa que vai atender e acompanha até liberar a mesa", async ({
  page,
  request,
}, info) => {
  const { esquecida, suja } = MESAS[info.project.name as keyof typeof MESAS];
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await expect(page.getByText("Ao vivo")).toBeVisible();
  await expect(page.getByTestId("mesa-14")).toBeVisible();

  // Duas pessoas sentaram há 6 minutos e ninguém foi até a mesa.
  await camera(request, esquecida, -6, 0, 2);
  const alerta = page.getByTestId(`alerta-sem_atendimento-${esquecida}`);
  await expect(alerta).toContainText(`Mesa ${esquecida} está sem atendimento`);
  await expect(page.getByTestId(`mesa-${esquecida}`)).toHaveAttribute("data-estado", "atrasada");

  await alerta.getByRole("button", { name: "Vou atender" }).click();
  await expect(alerta).toContainText("alguém já está indo");

  // O garçom chega na mesa: o alerta some sozinho.
  await camera(request, esquecida, 0.1, 0.1, 2, 1);
  await expect(alerta).toBeHidden();
  await expect(page.getByTestId(`mesa-${esquecida}`)).toHaveAttribute("data-estado", "ocupada");

  // Outra mesa: jantaram, foram embora há 2 minutos e ninguém limpou.
  await camera(request, suja, -50, -49.5, 3);
  await camera(request, suja, -49.4, -49.4, 3, 1);
  await camera(request, suja, -49.3, -2.1, 3);
  await camera(request, suja, -2, 0.1, 0);
  const vaga = page.getByTestId(`alerta-mesa_vaga-${suja}`);
  await expect(vaga).toContainText(`Mesa ${suja} vagou`);
  await expect(page.getByTestId(`mesa-${suja}`)).toHaveAttribute("data-estado", "limpar");

  // Pelo detalhe da mesa, a linha do tempo e o botão de liberar.
  await page.getByTestId(`mesa-${suja}`).click();
  const detalhe = page.getByRole("dialog");
  await expect(detalhe).toContainText("Atendida em");
  await expect(detalhe).toContainText("esperando limpeza");
  await detalhe.getByRole("button", { name: `Liberar mesa ${suja}` }).click();

  await expect(page.getByText(`Mesa ${suja} liberada.`)).toBeVisible();
  await expect(vaga).toBeHidden();
  await expect(page.getByTestId(`mesa-${suja}`)).toHaveAttribute("data-estado", "livre");
});

test("garçom só vê o salão; dono vê mesas, equipe e ajustes", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await expect(page.getByTestId("mesa-1")).toBeVisible();
  const navegacao = page.getByRole("navigation", { name: "Seções" });
  await expect(navegacao.getByRole("link")).toHaveText(["Salão"]);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);

  await entrar(page, "marcos@cantina.demo");
  await expect(page.getByTestId("mesa-1")).toBeVisible();
  await expect(navegacao.getByRole("link")).toHaveText([
    "Salão",
    "Mesas",
    "Câmeras",
    "Equipe",
    "Ajustes",
  ]);
});

test("senha errada mostra o motivo", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill("gerente@cantina.demo");
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorretos" })).toHaveText(
    "e-mail ou senha incorretos",
  );
});
