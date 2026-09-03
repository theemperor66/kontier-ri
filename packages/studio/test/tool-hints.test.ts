import { describe, expect, it } from "vitest";
import {
  buildDecisionTools,
  buildProposalTools,
  buildSelectedTileTools,
  buildStaticTools,
} from "../src/webmcp/tools";
import { useDashboardStore } from "../src/store";
import type { DataSource } from "@kontier-ri/datasource";

/**
 * Annotation invariant.
 *
 * Chrome's tool-security guidance asks for `readOnlyHint` on tools that do not
 * change state, so the agent can decide when to ask the human first. A tool
 * that declares nothing gives the agent no signal at all, which is the worst
 * of the three states. This test refuses that state for every tool the page
 * can register — static and dynamic.
 */

const ds = {
  listDatasets: async () => [],
  getSchema: async () => [],
  profileColumn: async () => ({ dataset: "d", column: "c", type: "VARCHAR" }),
  query: async () => ({ columns: [], rows: [] }),
  createView: async () => undefined,
  dropView: async () => undefined,
} as unknown as DataSource;

/** Names known to be pure reads. Everything else must declare a write. */
const READS = new Set([
  "list_datasets",
  "get_dataset_schema",
  "profile_column",
  "sample_rows",
  "run_sql",
  "list_calculated_fields",
  "get_dashboard_state",
  "get_user_focus",
  "describe_tile",
  "export_tile_data",
  "get_activity_log",
  "get_work_context",
  "explain_selected_tile",
]);

describe("every registerable tool declares a read/write hint", () => {
  it("static tools split cleanly into declared reads and declared writes", () => {
    const tools = buildStaticTools({ dataSource: ds });
    expect(tools.length).toBeGreaterThan(30);

    const undeclared = tools.filter(
      (t) => t.annotations?.readOnlyHint === undefined,
    );
    expect(undeclared.map((t) => t.name)).toEqual([]);

    for (const t of tools) {
      const expected = READS.has(t.name);
      expect(
        t.annotations?.readOnlyHint,
        `${t.name} declared the wrong hint`,
      ).toBe(expected);
      // A read that echoes dataset values or human text must also be marked
      // untrusted, so a host can keep it out of instruction authority.
      if (expected) {
        expect(t.annotations?.untrustedContentHint, t.name).toBe(true);
      }
    }
  });

  it("dynamic bundles declare hints too", () => {
    const store = useDashboardStore;
    // Selection-scoped bundle needs a selected tile to exist.
    const state = store.getState();
    const firstTile = state.doc.pages[0]?.tiles[0];
    if (firstTile) state.selectTile(firstTile.id);

    const dynamic = [
      ...buildSelectedTileTools({ dataSource: ds }),
      ...buildProposalTools({ dataSource: ds }),
      ...buildDecisionTools({ dataSource: ds }),
    ];
    for (const t of dynamic) {
      expect(
        t.annotations?.readOnlyHint,
        `${t.name} left its hint undeclared`,
      ).toBe(READS.has(t.name));
    }
  });
});
