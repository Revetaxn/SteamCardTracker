import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Steam Kart Takipçi - Trading Card Fiyat Takip",
  description: "Steam profilinizdeki oyunların trading card fiyatlarını güncel olarak takip edin. En değerli kartları anında görün.",
  keywords: ["Steam", "Trading Cards", "Foil", "Steam Market", "Kart Fiyat", "SteamDB"],
  authors: [{ name: "Steam Kart Takipçi" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Steam Kart Takipçi",
    description: "Steam trading card fiyatlarınızı güncel olarak takip edin",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
