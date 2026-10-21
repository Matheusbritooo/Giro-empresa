import { defineConfig, devices } from "@playwright/test";

// Portas próprias para não brigar com o ambiente de desenvolvimento (3000 e 8000).
const API = "http://localhost:8100";
const PAINEL = "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: PAINEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // No ambiente da nuvem do Claude o Chromium já vem instalado; na CI o Playwright baixa.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "computador", use: { ...devices["Desktop Chrome"] } },
  ],
  workers: 1, // os dois projetos usam o mesmo banco de demonstração
  webServer: [
    {
      command: "../../services/backend/scripts/servidor-e2e.sh",
      url: `${API}/api/saude`,
      env: { GIRO_ORIGENS_CORS: JSON.stringify([PAINEL]), GIRO_VERIFICADOR_INTERVALO_SEG: "2" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm build && pnpm start --port 3100",
      url: `${PAINEL}/entrar`,
      env: { NEXT_PUBLIC_API_URL: API },
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
