// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { Web3Providers } from "./Web3Providers"; // 👈 NEW

export const metadata: Metadata = {
  title: "Scall.io",
  description: "Decentralized perpetual options",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col" suppressHydrationWarning>
        <Web3Providers>{children}</Web3Providers>
      </body>
    </html>
  );
}

