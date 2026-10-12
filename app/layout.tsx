import type { Metadata } from "next";
import { mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paléoglyphes",
  description: "Fouille, assemble et observe des dinosaures, entièrement en ASCII.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={mono.className}>
      <body>{children}</body>
    </html>
  );
}
