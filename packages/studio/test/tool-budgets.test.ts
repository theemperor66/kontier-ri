import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  buildDecisionTools,
  buildProposalTools,
  buildSelectedTileTools,
  buildStaticTools,
} from "../src/webmcp/tools";
import type { DataSource } from "@kontier-ri/datasource";

/**
 * Chrome publishes character budgets for WebMCP tools, to keep tool
 * declarations inside agent guardrails:
 *
 *   30 characters   per tool name and parameter name
 *   500 characters  per tool description
 *   150 characters  per parameter description
 *
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 *
 * These are budgets, not spec limits — nothing rejects an over-budget tool.
 * That is exactly why they need a test: an over-long description degrades
 * agent behaviour silently, and the only symptom is a model that picks the
 * wrong tool. `add_tile` was 888 characters when this test was written,
 * because it repeated the spec grammar the inputSchema already carries.
 */

const NAME_BUDGET = 30;
const DESCRIPTION_BUDGET = 500;
const PARAM_DESCRIPTION_BUDGET = 150;

const ds = {
  listDatasets: async () => [],
  getSchema: async () => [],
  profileColumn: async () => ({ dataset: "d", column: "c", type: "VARCHAR" }),
  query: async () => ({ columns: [], rows: [] }),
  createView: async () => undefined,
  dropView: async () => undefined,
} as unknown as DataSource;

function allTools() {
  return [
    ...buildStaticTools({ dataSource: ds }),
    ...buildSelectedTileTools({ dataSource: ds }),
    ...buildProposalTools({ dataSource: ds }),
    ...buildDecisionTools({ dataSource: ds }),
  ];
}

interface JsonSchemaish {
  properties?: Record<string, { description?: string }>;
}

describe("Chrome WebMCP character budgets", () => {
  it("every tool name fits 30 characters", () => {
    const over = allTools()
      .filter((t) => t.name.length > NAME_BUDGET)
      .map((t) => `${t.name} (${t.name.length})`);
    expect(over).toEqual([]);
  });

  it("every tool description fits 500 characters", () => {
    const over = allTools()
      .filter((t) => t.description.length > DESCRIPTION_BUDGET)
      .map((t) => `${t.name} (${t.description.length})`);
    expect(over).toEqual([]);
  });

  it("every parameter name and description fits its budget", () => {
    const overNames: string[] = [];
    const overDescriptions: string[] = [];
    for (const t of allTools()) {
      let schema: JsonSchemaish;
      try {
        schema = z.toJSONSchema(t.inputSchema) as JsonSchemaish;
      } catch {
        continue; // a schema JSON Schema cannot express is covered elsewhere
      }
      for (const [param, value] of Object.entries(schema.properties ?? {})) {
        if (param.length > NAME_BUDGET) {
          overNames.push(`${t.name}.${param} (${param.length})`);
        }
        const description = value?.description ?? "";
        if (description.length > PARAM_DESCRIPTION_BUDGET) {
          overDescriptions.push(
            `${t.name}.${param} (${description.length})`,
          );
        }
      }
    }
    expect(overNames).toEqual([]);
    expect(overDescriptions).toEqual([]);
  });

  it("descriptions are still substantive, not trimmed into uselessness", () => {
    // The budget is an upper bound. A one-word description would pass the
    // test above and fail the agent, so hold a floor too.
    const tooShort = allTools()
      .filter((t) => t.description.length < 20)
      .map((t) => t.name);
    expect(tooShort).toEqual([]);
  });
});
