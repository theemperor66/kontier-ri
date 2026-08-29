import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { withBasePath } from "@/lib/base-path";
import "./globals.css";

const TITLE = "Kontier RI — build revenue dashboards with your AI agent";
const DESCRIPTION =
  "Agent-native revenue analytics. Humans and AI agents build dashboards together via WebMCP; SQL runs locally with DuckDB-WASM — your data never leaves the browser.";
// Origin only; the deploy base path (e.g. /kontier-ri) is applied per-asset
// via withBasePath so both root (Vercel) and subpath (GitHub Pages) resolve.
const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://theemperor66.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Kontier RI",
    type: "website",
    images: [{ url: withBasePath("/og.png"), width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [withBasePath("/og.png")],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
