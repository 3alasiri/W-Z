import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "بقالتي الذكية", description: "نظام إدارة البقالات" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
