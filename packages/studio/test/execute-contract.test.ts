import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeToolExecute } from "../src/webmcp/useWebMCPTool";

describe("makeToolExecute host-compat contract", () => {
  const schema = z.object({ n: z.number() }).strict();

  it("works when the host omits the options object entirely (Chrome executeTool repro)", async () => {
    const exec = makeToolExecute(
      () => schema,
      (input, signal) => ({ got: input, hasSignal: signal instanceof AbortSignal }),
      new AbortController().signal,
    );
    // NOTE: no second argument — this crashed with
    // "Cannot read properties of undefined (reading 'signal')" before the fix.
    const result = (await exec({ n: 42 })) as { got: unknown; hasSignal: boolean };
    expect(result.got).toEqual({ n: 42 });
    expect(result.hasSignal).toBe(true); // fallback signal substituted
  });

  it("prefers the host-provided signal when present", async () => {
    const hostController = new AbortController();
    const exec = makeToolExecute(
      () => schema,
      (_input, signal) => signal === hostController.signal,
      new AbortController().signal,
    );
    await expect(exec({ n: 1 }, { signal: hostController.signal })).resolves.toBe(true);
  });

  it("returns {error} for invalid input and thrown errors", async () => {
    const exec = makeToolExecute(
      () => schema,
      () => { throw new Error("boom"); },
      new AbortController().signal,
    );
    const bad = (await exec({ nope: true })) as { error: string };
    expect(bad.error).toMatch(/Invalid input/);
    const thrown = (await exec({ n: 1 })) as { error: string };
    expect(thrown.error).toBe("boom");
  });
});
