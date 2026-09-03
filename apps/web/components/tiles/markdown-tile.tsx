"use client";

import ReactMarkdown from "react-markdown";
import type { MarkdownSpec, Tile } from "@/lib/dashboard-store";

/** Sanitized markdown: react-markdown never renders raw HTML; skipHtml drops it. */
export function MarkdownTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as MarkdownSpec;
  return (
    <div className="prose-sm h-full overflow-auto text-[13px] leading-relaxed [&_a]:text-accent-strong [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold">
      <ReactMarkdown skipHtml>{spec.content}</ReactMarkdown>
    </div>
  );
}
