import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "بقالتي الذكية", description: "نظام إدارة البقالات" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Readex+Pro:wght@500;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
