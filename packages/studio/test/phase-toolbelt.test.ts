import { describe, expect, it } from "vitest";
import type {
  ColumnMeta,
  ColumnProfile,
  DataSource,
  DatasetMeta,
  QueryResult,
} from "@kontier-ri/datasource";
import {
  buildStaticTools,
  scopeToolsToPhase,
  PHASE_TOOL_SCOPES,
  STATIC_TOOL_NAMES,
} from "../src/webmcp/tools";
import type { WorkSessionPhase } from "../src/types";

class FakeDataSource implements DataSource {
  listDatasets(): Promise<DatasetMeta[]> {
    return Promise.resolve([]);
  }
  getSchema(): Promise<ColumnMeta[]> {
    return Promise.resolve([]);
  }
  runQuery(): Promise<QueryResult> {
    return Promise.resolve({ columns: [], rows: [], rowCount: 0, truncated: false });
  }
  profileColumn(dataset: string, column: string): Promise<ColumnProfile> {
    return Promise.resolve({
      dataset,
      column,
      type: "VARCHAR",
      count: 0,
      nulls: 0,
      distinct: 0,
      min: null,
      max: null,
      topValues: [],
    });
  }
}

const defs = () => buildStaticTools({ dataSource: new FakeDataSource() });
const names = (phase: WorkSessionPhase | null) =>
  scopeToolsToPhase(defs(), phase).map((def) => def.name);

const PHASES: WorkSessionPhase[] = [
  "ready",
  "planning",
  "working",
  "review",
  "complete",
  "paused",
];

describe("phase-keyed toolbelt", () => {
  it("returns the full surface when no phase is given (the default)", () => {
    expect(names(null)).toEqual([...STATIC_TOOL_NAMES]);
    expect(scopeToolsToPhase(defs(), undefined)).toHaveLength(
      STATIC_TOOL_NAMES.length,
    );
  });

  it("never scopes away orientation or read tools", () => {
    const reads = [
      "get_work_context",
      "get_dashboard_state",
      "get_user_focus",
      "describe_tile",
      "get_activity_log",
      "list_datasets",
      "get_dataset_schema",
      "profile_column",
      "sample_rows",
      "run_sql",
      "export_tile_data",
    ];
    for (const phase of PHASES) {
      const scoped = names(phase);
      for (const read of reads) {
        expect(scoped, `${phase} keeps ${read}`).toContain(read);
      }
    }
  });

  it("keeps writes out of the phases that are not for writing", () => {
    for (const phase of ["ready", "planning", "complete", "paused"] as const) {
      expect(names(phase)).not.toContain("add_tile");
      expect(names(phase)).not.toContain("remove_tile");
    }
    expect(names("working")).toContain("add_tile");
    expect(names("working")).toContain("propose_change_set");
    // Review is for handing work over, not for editing behind the human.
    expect(names("review")).not.toContain("add_tile");
    expect(names("review")).toContain("propose_change_set");
    expect(names("review")).toContain("complete_work");
    // The theme is a human preference: no phase hands it to the agent.
    for (const phase of PHASES) {
      expect(names(phase)).not.toContain("set_theme");
    }
  });

  it("lets each phase finish what it is for", () => {
    expect(names("ready")).toContain("present_plan");
    expect(names("planning")).toContain("update_plan_step");
    expect(names("planning")).toContain("request_decision");
    expect(names("working")).toContain("complete_work");
    // A paused or completed session exposes no mutation at all.
    for (const phase of ["paused", "complete"] as const) {
      expect(names(phase)).not.toContain("present_plan");
      expect(names(phase)).not.toContain("complete_work");
    }
  });

  it("every scoped name is a real static tool, and every phase is covered", () => {
    const known = new Set<string>(STATIC_TOOL_NAMES);
    for (const phase of PHASES) {
      const scope = PHASE_TOOL_SCOPES[phase];
      expect(scope, `${phase} has a scope`).toBeDefined();
      for (const name of scope) {
        expect(known, `${phase}: ${name} exists`).toContain(name);
      }
      // Every scope is a real narrowing: even `working`, the widest one,
      // drops the cosmetic theme tool.
      expect(scope.length).toBeLessThan(STATIC_TOOL_NAMES.length);
      expect(new Set(scope).size).toBe(scope.length);
    }
  });
});
