import { expect, type Page, test } from "@playwright/test";

import { entrar } from "./apoio";

// Os dois projetos (celular e computador) usam o mesmo banco: cada um mexe em ingredientes
// diferentes, e os testes conferem o que mudou, não o saldo exato.
const INGREDIENTES = {
  celular: { compra: "Batata", contagem: "Espaguete", perda: "Creme de leite", perdeu: "0,5" },
  computador: { compra: "Tomate", contagem: "Fettuccine", perda: "Água sem gás", perdeu: "1" },
};

async function abrirEstoque(page: Page) {
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Estoque" })
    .click();
  await expect(page.getByRole("heading", { name: "Estoque", exact: true })).toBeVisible();
}

test("gerente lança a compra, conta o estoque e vê o livro do ingrediente", async ({
  page,
}, info) => {
  const nomes = INGREDIENTES[info.project.name as keyof typeof INGREDIENTES];
  await entrar(page, "gerente@cantina.demo");
  await abrirEstoque(page);
  await expect(page.getByRole("columnheader", { name: "Preço médio" })).toBeVisible();

  await page.getByRole("button", { name: "Chegou compra" }).click();
  await page.locator("#compra-insumo").selectOption({ label: nomes.compra });
  await page.getByLabel("Quantidade (kg)").fill("2");
  await page.getByLabel("Valor da nota (R$)").fill("16");
  await page.getByRole("button", { name: "Registrar compra" }).click();
  await expect(
    page.getByText(`Compra registrada: 2 kg de ${nomes.compra.toLowerCase()}.`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Contar estoque" }).click();
  await page.getByLabel(`Contei de ${nomes.contagem}, em kg`).fill("3");
  await page.getByRole("button", { name: "Salvar contagem" }).click();
  await expect(page.getByText(/^Contagem salva\./)).toContainText(`${nomes.contagem}:`);
  const linha = page.getByRole("row", { name: new RegExp(`^${nomes.contagem}`) });
  await expect(linha).toContainText("3 kg");

  // O livro mostra a compra com o valor da nota e quem lançou.
  await page
    .getByRole("row", { name: new RegExp(`^${nomes.compra}`) })
    .getByRole("button", { name: "Ver livro" })
    .click();
  await expect(page.getByText("Chegou compra").first()).toBeVisible();
  await expect(page.getByText(/nota de R\$ 16, por Gerente da Cantina/).first()).toBeVisible();
});

test("garçom registra perda e vê a ficha sem valores", async ({ page }, info) => {
  const nomes = INGREDIENTES[info.project.name as keyof typeof INGREDIENTES];
  await entrar(page, "equipe@cantina.demo");
  await abrirEstoque(page);
  await expect(page.getByRole("button", { name: "Chegou compra" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Preço médio" })).toHaveCount(0);

  await page.getByRole("button", { name: "Registrar perda" }).click();
  await page.locator("#perda-insumo").selectOption({ label: nomes.perda });
  await page.getByLabel(/^Quantidade \(/).fill(nomes.perdeu);
  await page.locator("#perda-motivo").selectOption("Venceu");
  await page.getByRole("button", { name: "Registrar perda" }).last().click();
  await expect(page.getByText(/^Perda registrada: .+ \(Venceu\)\.$/)).toContainText(
    nomes.perda.toLowerCase(),
  );

  // A cozinha vê a porção de cada prato, sem custo.
  await page.getByRole("tab", { name: "Fichas dos pratos" }).click();
  await page.locator("#ficha-prato").selectOption({ label: "Lasanha à bolonhesa" });
  await expect(page.getByText("Massa de lasanha")).toBeVisible();
  await expect(page.getByText("120 g").first()).toBeVisible();
  await expect(page.getByText("Custo pela ficha")).toHaveCount(0);
});

test("dono muda a ficha e o custo do prato acompanha no cardápio", async ({ page }) => {
  await entrar(page, "marcos@cantina.demo");
  await abrirEstoque(page);
  await page.getByRole("tab", { name: "Fichas dos pratos" }).click();
  await page.locator("#ficha-prato").selectOption({ label: "Lasanha à bolonhesa" });
  const custo = page.getByText(/^Custo pela ficha:/);
  await expect(custo).toContainText("R$");
  const antes = await custo.textContent();

  // 10 g a mais de massa por prato: o custo muda antes mesmo de salvar.
  const massa = page.getByLabel("Massa de lasanha por prato, em g");
  const atual = Number(await massa.inputValue());
  await massa.fill(String(atual === 120 ? 130 : 120));
  await expect(custo).not.toHaveText(antes ?? "");
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(
    page.getByText(/^Ficha de Lasanha à bolonhesa salva\. O custo do prato agora é R\$/),
  ).toBeVisible();

  // No cardápio, o custo da lasanha vem da ficha e não se digita.
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Cardápio" })
    .click();
  const lasanha = page.getByRole("listitem").filter({ hasText: "Lasanha à bolonhesa" });
  await expect(lasanha.getByRole("link", { name: "pela ficha" })).toBeVisible();
  await expect(lasanha.getByLabel("Custo de Lasanha à bolonhesa em reais")).toHaveCount(0);
});

test("gerente vê a lista de compras com o porquê e copia para o WhatsApp", async ({ page }) => {
  await entrar(page, "gerente@cantina.demo");
  await abrirEstoque(page);
  await expect(page.getByText(/^Próxima compra:/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Até quando" })).toBeVisible();

  await page.getByRole("tab", { name: "Lista de compras" }).click();
  await expect(page.getByRole("heading", { name: /^Compra de / })).toBeVisible();
  const primeira = page.locator("[data-testid^='compra-']").first();
  await primeira.locator("summary").click();
  await expect(primeira).toContainText(/Tem agora: .+/);
  await expect(primeira).toContainText(/Com folga de \d+%: .+/);

  // Fim de semana de feriado: mais folga só nesta conta.
  await page.getByRole("button", { name: "40%" }).click();
  await expect(page.getByRole("button", { name: "40%" })).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-testid^='compra-'] summary").first().click();
  await expect(page.locator("[data-testid^='compra-']").first()).toContainText("Com folga de 40%");

  await page.getByRole("button", { name: "Copiar lista para o WhatsApp" }).click();
  await expect(page.getByText(/Lista copiada|Não deu para copiar sozinho/).first()).toBeVisible();
});

test("a equipe não vê a lista de compras", async ({ page }) => {
  await entrar(page, "equipe@cantina.demo");
  await abrirEstoque(page);
  await expect(page.getByRole("tab", { name: "Lista de compras" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Até quando" })).toBeVisible();
});

test("dono muda a folga em Ajustes e a lista passa a usar", async ({ page }, info) => {
  const folga = info.project.name === "celular" ? "20" : "18";
  await entrar(page, "marcos@cantina.demo");
  await page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("link", { name: "Ajustes" })
    .click();
  await expect(page.getByRole("group", { name: "Dias de compra" })).toBeVisible();
  await expect(page.getByLabel("Ter")).toBeChecked();
  await page.getByLabel("Folga da lista de compras (%)").fill(folga);
  await page.getByRole("button", { name: "Salvar ajustes" }).click();
  await expect(page.getByText("Ajustes salvos.")).toBeVisible();

  await abrirEstoque(page);
  await page.getByRole("tab", { name: "Lista de compras" }).click();
  await expect(page.getByRole("button", { name: `${folga}% (padrão)` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
