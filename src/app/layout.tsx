import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZapFlow | Campanhas WhatsApp",
  description:
    "Painel de gerenciamento de campanhas e comunicações do ZapFlow.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
