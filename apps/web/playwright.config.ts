import { defineConfig, devices } from "@playwright/test";

// Portas próprias para não brigar com o ambiente de desenvolvimento (3000 e 8000).
const API = "http://localhost:8100";
const PAINEL = "http://localhost:3100";
const VISAO = "http://localhost:8101";
const SEGREDO_VISAO = "segredo-dos-testes-de-ponta-a-ponta";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: PAINEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // No ambiente da nuvem do Claude o Chromium já vem instalado; na CI o Playwright baixa.
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      // Sem placa de vídeo (CI e nuvem), o 3D do salão roda no processador.
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    },
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
      env: {
        GIRO_ORIGENS_CORS: JSON.stringify([PAINEL]),
        GIRO_VERIFICADOR_INTERVALO_SEG: "2",
        GIRO_VISAO_URL: VISAO,
        GIRO_VISAO_SEGREDO: SEGREDO_VISAO,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Serviço de visão com o modelo mais leve (3,6 MB), baixado na primeira vez.
      command:
        "cd ../../services/backend && uv run --extra visao uvicorn --factory giro.visao.servico:criar_app --port 8101",
      url: `${VISAO}/visao/saude`,
      env: {
        GIRO_VISAO_API_URL: API,
        GIRO_VISAO_SEGREDO: SEGREDO_VISAO,
        GIRO_VISAO_MODELO: "yolox_nano",
        GIRO_VISAO_CACHE_CONFIG_SEG: "0",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
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
