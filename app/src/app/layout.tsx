import "./globals.css";
import type { Metadata, Viewport } from "next";
import { BOOT_SCRIPT, FONTS_URL } from "@/lib/appearance";

export const metadata: Metadata = { title: "بقالتي الذكية", description: "نظام ذكي لإدارة بقالات الأحياء" };
export const viewport: Viewport = { themeColor: "#1f6b4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-theme="mint" data-font="tajawal" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body>{children}</body>
    </html>
  );
}
