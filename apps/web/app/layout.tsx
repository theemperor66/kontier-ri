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
  // The same mark, at the same scale, as kontier.eu. Kontier RI is part of
  // the platform, not a separate product, and a tab strip is where people
  // notice that first. These are the marketing site's own rasters rather
  // than a re-export, so the two cannot drift apart.
  icons: {
    icon: [
      { url: withBasePath("/favicon.ico"), sizes: "any" },
      { url: withBasePath("/icon.svg"), type: "image/svg+xml" },
      { url: withBasePath("/favicon-16x16.png"), sizes: "16x16", type: "image/png" },
      { url: withBasePath("/favicon-32x32.png"), sizes: "32x32", type: "image/png" },
      { url: withBasePath("/favicon-48x48.png"), sizes: "48x48", type: "image/png" },
      { url: withBasePath("/favicon-96x96.png"), sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: withBasePath("/apple-icon.png"), sizes: "180x180" }],
  },
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

const DIRECTION_CONTRACT = `THESIS: A revenue investigation room where the live report is the
shared working memory of a human and a browser agent. It refuses the
chat-sidebar pattern: questions, plans, decisions and approvals are
product objects on the page, not messages beside it.
OWN-WORLD: The sponsor-pinned Kontier RI design — navy #0F1426
navigation rail against a #F5F6FA canvas, white surfaces, indigo
#3D4FE0 action ink, mint/lavender/peach KPI fields, 12px cards, 8-9px
controls, DM Sans with tabular numerals, hairline #E6E8EF rules.
STORY: The operator states a brief, points at a signal, watches the
agent work in the open, answers its questions, approves its evidence,
and keeps a report they can still edit and undo.
FIRST VIEWPORT: Rail left (workspace, surfaces, live agent status),
56px top bar with breadcrumb, command search and agent status, report
title with filter chips and page tabs, KPI row over the dotted canvas,
340px agent panel on the right holding brief, decisions and approvals.
FORM: User-pinned product design (Kontier RI.html); ported verbatim in
tokens, geometry and component grammar, with product truth replacing
the design's placeholder facts. The pin is the declared substitute for
a concept-seed key: the direction was supplied, not rolled.
FINISH: unreviewed and undocumented is unfinished; this build ends
with the finish review, the verdict, DESIGN.md, and every shipping
raster carrying its provenance.`;

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
        {/* Direction contract — emitted as a real HTML comment so it survives
            the production build and can be audited in the shipped markup. */}
        <div
          hidden
          aria-hidden
          dangerouslySetInnerHTML={{ __html: `<!--\n${DIRECTION_CONTRACT}\n-->` }}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
