import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { withBasePath } from "@/lib/base-path";
import "./globals.css";

// Kontier type stack - one sans for everything (hierarchy by weight +
// size + color, not font swaps). DM Sans covers body, headings, KPI
// values; JetBrains Mono backs IDs / SQL / code so 0/O/1/l stay
// unambiguous at small sizes. globals.css wraps these variables with
// full fallback stacks (--font-sans / --font-mono in @theme).
const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans`}
    >
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
