import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = "http://localhost:8100";
export const TOKEN_CAMERA = "cam_demo_cantina_do_marcos"; // criado pelo seed

/** Faz o papel da câmera: manda uma foto analisada a cada 10s entre dois instantes. */
export async function camera(
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

export async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("giro1234");
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Entra e vai para o salão: o dono abre no resumo do dia ("Hoje"), os outros já no salão. */
export async function entrarNoSalao(page: Page, email: string) {
  await entrar(page, email);
  await expect(page).toHaveURL(/\/(hoje|salao)$/);
  if (!page.url().endsWith("/salao")) {
    await page
      .getByRole("navigation", { name: "Seções" })
      .getByRole("link", { name: "Salão" })
      .click();
  }
  await expect(page).toHaveURL(/\/salao$/);
}

/** Abre o salão sempre na planta, que é o que estes testes conferem. */
export async function preferirPlanta(page: Page) {
  await page.addInitScript(() => localStorage.setItem("giro:vista", "planta"));
}
