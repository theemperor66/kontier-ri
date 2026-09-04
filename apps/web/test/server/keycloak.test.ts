import { describe, expect, it } from "vitest";
import { readOrganization } from "@/app/api/workspace/tenant/keycloak/route";

/**
 * Keycloak's organization claim has changed shape across versions and across
 * mappers, and the claim is what decides which workspace a signed-in person
 * lands in. Getting it wrong does not throw — it quietly puts a colleague in
 * a room of their own. So every shape we might be handed is pinned.
 */
describe("reading the organization out of an ID token", () => {
  it("accepts the alias-keyed object Keycloak 26 sends", () => {
    expect(
      readOrganization({ organization: { acme: { id: "org_123" } } }),
    ).toEqual({ id: "org_123", name: "acme" });
  });

  it("falls back to the alias when the object carries no id", () => {
    expect(readOrganization({ organization: { acme: {} } })).toEqual({
      id: "acme",
      name: "acme",
    });
  });

  it("accepts a bare string", () => {
    expect(readOrganization({ organization: "acme" })).toEqual({
      id: "acme",
      name: "acme",
    });
  });

  it("accepts an array of strings or objects", () => {
    expect(readOrganization({ organizations: ["acme"] })).toEqual({
      id: "acme",
      name: "acme",
    });
    expect(
      readOrganization({ organizations: [{ id: "org_9", name: "Acme BV" }] }),
    ).toEqual({ id: "org_9", name: "Acme BV" });
  });

  it("returns null when there is no organization, rather than inventing one", () => {
    expect(readOrganization({})).toBeNull();
    expect(readOrganization({ organization: "" })).toBeNull();
    expect(readOrganization({ organization: [] })).toBeNull();
    expect(readOrganization({ organization: {} })).toBeNull();
  });
});
