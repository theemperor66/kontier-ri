import { StudioCanvas } from "@kontier-ri/studio";
import { PipelineDemo } from "@/components/pipeline-demo";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Kontier RI</h1>
        <p className="text-sm text-muted-foreground">
          Revenue Intelligence Studio — humans and AI agents build dashboards
          together via WebMCP. SQL runs locally in your browser (DuckDB-WASM);
          raw data never leaves the page.
        </p>
      </header>

      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Demo data pipeline (DuckDB-WASM, in-browser)
        </h2>
        <PipelineDemo />
      </section>

      <section>
        <StudioCanvas />
      </section>
    </main>
  );
}
