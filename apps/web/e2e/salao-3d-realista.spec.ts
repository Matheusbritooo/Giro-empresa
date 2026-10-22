import { expect, type Page, test } from "@playwright/test";

import { camera, entrar } from "./apoio";

// Aviso que o próprio @react-three/fiber dá no three 0.186 (THREE.Clock virou THREE.Timer).
const AVISOS_CONHECIDOS = [/THREE\.Clock/];
const SELO = "Pessoas ilustrativas: a câmera só conta, não filma ninguém.";

/** Erros e avisos do console daqui em diante, fora o aviso conhecido do three. */
function vigiarConsole(page: Page): string[] {
  const problemas: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (AVISOS_CONHECIDOS.some((r) => r.test(m.text()))) return;
    problemas.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));
  return problemas;
}

/** Endereços pedidos fora do painel e da API: o 3D não baixa nada de CDN. */
function vigiarDownloads(page: Page): string[] {
  const deFora: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (/^(data|blob):/.test(url)) return;
    const { hostname } = new URL(url);
    if (hostname !== "localhost" && hostname !== "127.0.0.1") deFora.push(url);
  });
  return deFora;
}

test.skip(({ isMobile }) => isMobile, "no celular o salão abre na planta");

test("salão 3D no nível alto abre com efeitos, selo e garçom no balcão", async ({ page }) => {
  test.setTimeout(150_000); // nível alto no processador (SwiftShader) é lento

  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  const problemas = vigiarConsole(page);
  const deFora = vigiarDownloads(page);
  await page.goto("/salao?qualidade=alto");

  const salao = page.getByTestId("salao-3d");
  await expect(salao).toHaveAttribute("data-qualidade", "alto");
  await expect(salao.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("selo-ilustrativo")).toHaveText(SELO);
  // Sem mesa para atender, o garçom espera no balcão.
  await expect(salao).toHaveAttribute("data-garcom", "balcao", { timeout: 60_000 });

  expect(problemas).toEqual([]);
  expect(deFora).toEqual([]);
});

test("'Ver no salão' leva a câmera até a mesa e o garçom vai atender", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  const problemas = vigiarConsole(page);
  const deFora = vigiarDownloads(page);
  // O nível médio tem os mesmos clientes, garçom e efeitos do alto, sem a oclusão (mais leve na CI).
  await page.goto("/salao?qualidade=medio");

  const salao = page.getByTestId("salao-3d");
  await expect(salao).toHaveAttribute("data-qualidade", "medio");
  await expect(salao.locator("canvas")).toBeVisible();
  await expect(salao).toHaveAttribute("data-garcom", "balcao", { timeout: 60_000 });

  // Duas pessoas sentaram na mesa 10 há 6 minutos e ninguém foi até lá.
  await camera(request, 10, -6, 0, 2);
  const alerta = page.getByTestId("alerta-sem_atendimento-10");
  await expect(alerta).toContainText("Mesa 10 está sem atendimento");
  await expect(page.getByTestId("mesa-10")).toHaveAttribute("data-estado", "atrasada");

  // "Ver no salão" leva a câmera até a mesa: a mesa fica no meio do 3D e a placa logo acima.
  await alerta.getByRole("button", { name: "Ver no salão a mesa 10" }).click();
  await expect(salao).toHaveAttribute("data-camera-em", "mesa-10", { timeout: 30_000 });
  const area = await page.getByTestId("salao-3d-area").boundingBox();
  const placa = await page.getByTestId("mesa-10").boundingBox();
  expect(area && placa).toBeTruthy();
  if (area && placa) {
    const dx = placa.x + placa.width / 2 - (area.x + area.width / 2);
    const dy = placa.y + placa.height / 2 - (area.y + area.height / 2);
    expect(Math.abs(dx)).toBeLessThan(area.width * 0.2);
    expect(dy).toBeLessThan(0);
    expect(dy).toBeGreaterThan(-area.height * 0.45);
  }

  // Alguém avisa que vai atender: o garçom sai do balcão e vai até a mesa 10.
  await alerta.getByRole("button", { name: "Vou atender" }).click();
  await expect(salao).toHaveAttribute("data-garcom", "mesa-10");

  // No modo câmera o selo continua à vista.
  await page.getByRole("button", { name: "Ver como a câmera" }).click();
  await expect(page.getByText("A câmera enxerga formas, não rostos.")).toBeVisible();
  await expect(page.getByTestId("selo-ilustrativo")).toBeVisible();
  await page.getByRole("button", { name: "Voltar à vista inicial" }).click();
  await expect(salao).toHaveAttribute("data-camera-em", "inicio");

  expect(problemas).toEqual([]);
  expect(deFora).toEqual([]);
});

test("se o desenho de um cliente não baixar, o salão 3D continua aberto", async ({
  page,
  request,
}) => {
  // O primeiro cliente pedido volta 404; os outros chegam normalmente.
  let falhou: string | null = null;
  await page.route("**/modelos/pessoas/cliente-*.glb", async (rota) => {
    if (falhou === null || falhou === rota.request().url()) {
      falhou = rota.request().url();
      await rota.fulfill({ status: 404, body: "" });
    } else {
      await rota.continue();
    }
  });

  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/salao?qualidade=baixo");
  const salao = page.getByTestId("salao-3d");
  await expect(salao).toHaveAttribute("data-qualidade", "baixo");
  await expect(salao.locator("canvas")).toBeVisible();

  // Quatro pessoas na mesa 2: o painel pede o desenho de cada uma.
  await camera(request, 2, -0.5, 0, 4);
  await expect(page.getByTestId("mesa-2")).toHaveAttribute("data-estado", "aguardando");
  await expect.poll(() => falhou, { timeout: 30_000 }).not.toBeNull();

  // Quem não baixou vira boneco simples; o resto do salão segue no 3D.
  await page.waitForTimeout(2_000);
  await expect(salao).toHaveCount(1);
  await expect(salao.locator("canvas")).toBeVisible();
  await expect(page.locator('[data-vista="3d"]')).toHaveCount(14);
  await expect(page.getByTestId("selo-ilustrativo")).toHaveText(SELO);
});
