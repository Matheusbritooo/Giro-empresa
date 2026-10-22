import { expect, test } from "@playwright/test";

import { camera, entrar } from "./apoio";

test("dono vê o salão em 3D ao vivo, abre a mesa pela placa e pode voltar para a planta", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name === "celular", "no celular o salão abre na planta");
  await entrar(page, "marcos@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);

  // No computador o salão abre em 3D, com uma placa clicável sobre cada mesa.
  const salao = page.getByTestId("salao-3d");
  await expect(salao.locator("canvas")).toBeVisible();
  const placa = page.getByTestId("mesa-7");
  await expect(placa).toHaveAttribute("data-vista", "3d");
  await expect(placa).toBeVisible();
  await expect(page.locator('[data-vista="3d"]')).toHaveCount(14);

  // Três clientes sentam na mesa 7: a placa no 3D muda junto com a planta.
  await camera(request, 7, -0.5, 0, 3);
  await expect(placa).toHaveAttribute("data-estado", "aguardando");
  await expect(placa).toContainText("Esperando");

  await placa.click();
  const detalhe = page.getByRole("dialog");
  await expect(detalhe).toContainText("Mesa 7");
  await expect(detalhe).toContainText("3 pessoas");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Ver como a câmera" }).click();
  await expect(page.getByText("A câmera enxerga formas, não rostos.")).toBeVisible();
  // A placa da câmera só aparece depois que o projetor a põe no lugar (quadro novo no SwiftShader).
  await expect(page.getByText("Câmera do salão: 1 foto a cada 10 s")).toBeVisible({
    timeout: 15_000,
  });

  // A escolha de ver na planta fica guardada no aparelho.
  await page.getByRole("button", { name: "Planta" }).click();
  await expect(salao).toHaveCount(0);
  await expect(page.getByTestId("mesa-7")).toHaveAttribute("data-estado", "aguardando");
  await page.reload();
  await expect(page.getByTestId("mesa-14")).toBeVisible();
  await expect(page.getByTestId("salao-3d")).toHaveCount(0);
});
