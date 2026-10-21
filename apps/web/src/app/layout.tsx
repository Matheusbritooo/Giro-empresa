import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/big-shoulders-display";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { ProvedorSessao } from "@/lib/sessao";

export const metadata: Metadata = {
  title: { default: "GIRO", template: "%s | GIRO" },
  description: "A câmera que já está no teto agora conta o tempo das suas mesas.",
  applicationName: "GIRO",
  appleWebApp: { capable: true, title: "GIRO", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#1d2623" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ProvedorSessao>{children}</ProvedorSessao>
      </body>
    </html>
  );
}
