import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./art.css";

export const metadata: Metadata = {
  title: "증강 장기 · Augment Janggi",
  description: "별의 비용으로 승부하는 증강 카드 장기 파일럿",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "증강 장기 · Augment Janggi",
    description: "궁을 직접 잡고, 별의 비용으로 판정을 뒤집는 로컬 2인 장기",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "증강 장기 — 별의 비용으로 승부하라" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "증강 장기 · Augment Janggi",
    description: "별의 비용으로 승부하는 증강 카드 장기",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
