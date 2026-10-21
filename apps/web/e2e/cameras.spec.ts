import { expect, type Page, test } from "@playwright/test";

const API = "http://localhost:8100";
const VISAO = "http://localhost:8101";
const TOKEN_CAMERA = "cam_demo_cantina_do_marcos"; // criado pelo seed

/** Desenha um salão vazio no navegador e devolve como JPEG, para fazer o papel da câmera. */
async function fotoDoSalao(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const tela = document.createElement("canvas");
    tela.width = 640;
    tela.height = 360;
    const pincel = tela.getContext("2d") as CanvasRenderingContext2D;
    pincel.fillStyle = "#c9b79c"; // piso
    pincel.fillRect(0, 0, 640, 360);
    pincel.fillStyle = "#6b4f33"; // mesas
    for (const [x, y] of [
      [80, 80],
      [280, 80],
      [480, 80],
      [80, 230],
      [280, 230],
    ]) {
      pincel.fillRect(x, y, 90, 60);
    }
    return tela.toDataURL("image/jpeg", 0.8).split(",")[1];
  });
  return Buffer.from(base64, "base64");
}

test("técnico desenha a mesa 1 sobre a imagem da câmera", async ({ page, request }, info) => {
  test.skip(info.project.name === "celular", "desenho de mesas é feito no computador");

  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill("gerente@cantina.demo");
  await page.getByLabel("Senha").fill("giro1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/salao$/);

  // A câmera manda uma foto pelo serviço de visão (como o conector faria).
  const foto = await fotoDoSalao(page);
  const resposta = await request.post(`${VISAO}/visao/quadros`, {
    headers: { authorization: `Bearer ${TOKEN_CAMERA}`, "content-type": "image/jpeg" },
    data: foto,
  });
  expect(resposta.ok(), await resposta.text()).toBeTruthy();

  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Câmeras" })
    .click();
  const previa = page.getByTestId("previa-camera");
  await expect(previa.getByRole("img")).toBeVisible();

  const linhaMesa1 = page.getByTestId("linha-mesa-1");
  await linhaMesa1.getByRole("button", { name: "Desenhar" }).click();

  const caixa = await previa.boundingBox();
  if (!caixa) throw new Error("prévia sem tamanho");
  for (const [x, y] of [
    [0.1, 0.18],
    [0.3, 0.18],
    [0.3, 0.45],
    [0.1, 0.45],
  ]) {
    await previa.click({ position: { x: x * caixa.width, y: y * caixa.height } });
  }
  await expect(page.getByText("4 ponto(s)")).toBeVisible();
  await page.getByRole("button", { name: "Salvar desenho" }).click();
  await expect(page.getByText("Desenho da mesa 1 salvo.")).toBeVisible();
  await expect(linhaMesa1).toContainText("Desenhada");

  // O serviço de visão já recebe o desenho na configuração da câmera.
  const config = await request.get(`${API}/api/ingest/configuracao`, {
    headers: { authorization: `Bearer ${TOKEN_CAMERA}` },
  });
  const mesa1 = (await config.json()).mesas.find((m: { numero: number }) => m.numero === 1);
  expect(mesa1.poligono).toHaveLength(4);
  expect(mesa1.poligono[0][0]).toBeCloseTo(0.1, 1);
});
