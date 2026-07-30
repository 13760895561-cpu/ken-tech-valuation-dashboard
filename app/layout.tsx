import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://13760895561-cpu.github.io/ken-tech-valuation-dashboard";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "科技股长期估值与经营效率看板",
  description:
    "覆盖A股、美股与中国成熟科技锚的长期估值、经营效率、事件与来源审计看板。",
  applicationName: "科技股长期跟踪系统",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: siteUrl,
    siteName: "科技股长期跟踪系统",
    title: "科技股长期估值与经营效率看板",
    description: "实时行情、长期估值、经营效率与证据来源一体化跟踪。",
    images: [
      {
        url: `${siteUrl}/og.png`,
        width: 1731,
        height: 909,
        alt: "科技股长期跟踪系统：实时估值、经营效率与来源审计",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "科技股长期估值与经营效率看板",
    description: "实时行情、长期估值、经营效率与证据来源一体化跟踪。",
    images: [`${siteUrl}/og.png`],
  },
};

export const viewport: Viewport = {
  themeColor: "#173b63",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
