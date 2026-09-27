import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { GateBanner, Nav } from "@/components/Nav";
import { Providers } from "./providers";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["600", "700", "800"] });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Crash Test",
  description: "Checks your whole graph8 revenue machine before a customer finds the bug.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plex.variable} ${mono.variable} antialiased`}>
      <body className="min-h-screen font-sans">
        <Providers>
          <Nav />
          <GateBanner />
          <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
