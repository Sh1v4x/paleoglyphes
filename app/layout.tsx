import type { Metadata, Viewport } from "next";
import { mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paléoglyphes",
  description: "Fouille, assemble et observe des dinosaures, entièrement en ASCII.",
};

// Mobile : le jeu gère lui-même le pincement (zoom de la réserve), la page ne zoome pas ; « cover »
// remplit tout l'écran, et le jeu se tient dans la zone sûre (encoche, barre d'accueil : globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0a0f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={mono.className}>
      <body>{children}</body>
    </html>
  );
}
