import { expect, type Page } from "@playwright/test";

/**
 * Start every test inside a real workspace.
 *
 * The product asks a first-time visitor to choose a workspace before anything
 * else, because a shared investigation tool that quietly drops you into a
 * browser-local report is showing you the wrong product. Tests therefore have
 * to sign in like a person does, rather than being handed a back door — a
 * back door would let the sign-in path rot untested, which is how it broke in
 * the first place.
 *
 * This takes the returning-visitor path: a guest workspace already exists and
 * its session is in storage. It is one API call instead of two page loads,
 * and it exercises exactly the state a returning user is in.
 */
export async function startGuestSession(
  page: Page,
  baseURL: string | undefined,
  label = "e2e",
): Promise<string> {
  const base = baseURL ?? "http://localhost:3000";
  const created = await page.request.post(`${base}/api/workspace/guest`, {
    data: { label },
  });
  // Fail here, not sixty seconds later on a blank page.
  expect(created.status(), await created.text()).toBe(201);
  const { token, workspaceId } = (await created.json()) as {
    token: string;
    workspaceId: string;
  };
  await page.addInitScript(
    ([t, id]) => {
      window.localStorage.setItem(
        "kontier-ri:ws:session",
        JSON.stringify({ token: t, workspaceId: id, label: "e2e", kind: "guest" }),
      );
    },
    [token, workspaceId] as const,
  );
  return token;
}
