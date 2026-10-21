import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GIRO: mapa de mesas ao vivo",
    short_name: "GIRO",
    description: "A câmera que já está no teto agora conta o tempo das suas mesas.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    lang: "pt-BR",
    background_color: "#f1f3ef",
    theme_color: "#1d2623",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
