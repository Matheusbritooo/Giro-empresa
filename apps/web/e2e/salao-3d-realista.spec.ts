import { expect, test } from "@playwright/test";

import { camera, entrar } from "./apoio";

// Aviso que o próprio @react-three/fiber dá no three 0.186 (THREE.Clock virou THREE.Timer).
const AVISOS_CONHECIDOS = [/THREE\.Clock/];

test("salão 3D no nível alto: pessoas ilustrativas, garçom e 'Ver no salão' até a mesa", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name === "celular", "no celular o salão abre na planta");
  test.setTimeout(150_000); // nível alto no processador (SwiftShader) é lento

  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/salao?qualidade=alto");

  // Daqui em diante, nenhum erro nem aviso no console (fora o aviso conhecido do three).
  const problemas: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (AVISOS_CONHECIDOS.some((r) => r.test(m.text()))) return;
    problemas.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problemas.push(`pageerror: ${e.message}`));

  const salao = page.getByTestId("salao-3d");
  await expect(salao).toHaveAttribute("data-qualidade", "alto");
  await expect(salao.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("selo-ilustrativo")).toHaveText(
    "Pessoas ilustrativas: a câmera só conta, não filma ninguém.",
  );
  // Sem mesa para atender, o garçom espera no balcão.
  await expect(salao).toHaveAttribute("data-garcom", "balcao", { timeout: 60_000 });

  // Duas pessoas sentaram na mesa 10 há 6 minutos e ninguém foi até lá.
  await camera(request, 10, -6, 0, 2);
  const alerta = page.getByTestId("alerta-sem_atendimento-10");
  await expect(alerta).toContainText("Mesa 10 está sem atendimento");
  await expect(page.getByTestId("mesa-10")).toHaveAttribute("data-estado", "atrasada");

  // "Ver no salão" leva a câmera até a mesa: a placa dela fica perto do meio do 3D.
  await alerta.getByRole("button", { name: "Ver a mesa 10 no salão" }).click();
  await expect(salao).toHaveAttribute("data-camera-em", "mesa-10", { timeout: 30_000 });
  const area = await salao.boundingBox();
  const placa = await page.getByTestId("mesa-10").boundingBox();
  expect(area && placa).toBeTruthy();
  if (area && placa) {
    const dx = placa.x + placa.width / 2 - (area.x + area.width / 2);
    const dy = placa.y + placa.height / 2 - (area.y + area.height / 2);
    expect(Math.abs(dx)).toBeLessThan(area.width * 0.2);
    expect(Math.abs(dy)).toBeLessThan(area.height * 0.3);
  }

  // Alguém avisa que vai atender: o garçom sai do balcão e vai até a mesa 10.
  await alerta.getByRole("button", { name: "Vou atender" }).click();
  await expect(salao).toHaveAttribute("data-garcom", "mesa-10");

  await page.getByRole("button", { name: "Ver como a câmera" }).click();
  await expect(page.getByText("A câmera enxerga formas, não rostos.")).toBeVisible();
  await page.getByRole("button", { name: "Voltar à vista inicial" }).click();
  await expect(salao).toHaveAttribute("data-camera-em", "inicio");

  expect(problemas).toEqual([]);
});
