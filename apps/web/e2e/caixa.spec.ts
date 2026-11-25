import { expect, test } from "@playwright/test";

import { entrar } from "./apoio";

/** Uma noite da demonstração (3 dias atrás), no formato do caixa: 21/11/2026. */
function noiteDoCaixa(): string {
  const dia = new Date(Date.now() - 3 * 86_400_000 - 3 * 3_600_000);
  return dia.toISOString().slice(0, 10).split("-").reverse().join("/");
}

test("gerente importa a planilha do caixa e vê o que passou sem pedido no GIRO", async ({
  page,
}) => {
  await entrar(page, "gerente@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/resultados");
  await page.getByRole("link", { name: "Conferir com o caixa" }).click();
  await expect(page.getByRole("heading", { name: "Conferir com o caixa" })).toBeVisible();

  // A planilha do caixa vem com colunas que o GIRO não lê (cliente, CPF, pagamento).
  const noite = noiteDoCaixa();
  const planilha = [
    "Data;Hora;Cliente;CPF;Produto;Qtde;Valor Total;Pagamento",
    `${noite};20:15;Fulano;123.456.789-00;LASANHA A BOLONHESA;40;2.480,00;Pix`,
    `${noite};21:30;;;Refri lata;30;210,00;Dinheiro`,
    `${noite};22:00;;;Couvert artístico;10;150,00;Crédito`,
  ].join("\n");
  await page.getByLabel("Planilha do caixa").setInputFiles({
    name: "vendas.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(planilha, "utf-8"),
  });
  const previa = page.getByTestId("previa-caixa");
  await expect(previa).toContainText("1 noite, 3 linhas, R$ 2.840");
  // O nome igual ao do cardápio já vem escolhido; o resto o gerente escolhe.
  await expect(previa.getByLabel("Item do cardápio para LASANHA A BOLONHESA")).toHaveValue(/\d+/);
  await previa
    .getByLabel("Item do cardápio para Refri lata")
    .selectOption({ label: "Refrigerante lata" });
  await previa.getByRole("button", { name: "Importar planilha" }).click();
  await expect(page.getByText("Planilha importada: 1 noite, R$ 2.840.")).toBeVisible();

  const conferencia = page.getByTestId("conferencia-caixa");
  await expect(conferencia.getByRole("term").filter({ hasText: "No caixa" })).toBeVisible();
  await expect(conferencia).toContainText("R$ 2.840");
  await expect(conferencia).toContainText("Couvert artístico");
  await expect(conferencia.getByRole("rowheader", { name: "Lasanha à bolonhesa" })).toBeVisible();
  await expect(page.getByText("Fulano")).toHaveCount(0);
});

test("o garçom não abre a conferência com o caixa", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await expect(page).toHaveURL(/\/salao$/);
  await page.goto("/resultados/caixa");
  await expect(
    page.getByText("A conferência com o caixa fica com o dono e o gerente."),
  ).toBeVisible();
});
