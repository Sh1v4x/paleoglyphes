import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Site statique (GitHub Pages) : le jeu tourne entièrement dans le navigateur.
  output: "export",
  // Sur GitHub Pages, le site est servi sous /paleoglyphes (voir .github/workflows/pages.yml) ; vide en local.
  basePath: process.env.PAGES_BASE_PATH ?? "",
  turbopack: { root: __dirname },
  /* config options here */
  reactCompiler: true,
  devIndicators: false,
};

export default nextConfig;
