import { describe, expect, it } from "vitest";
import {
  readOrganization,
  workspaceBinding,
} from "@/app/api/workspace/tenant/keycloak/route";

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

describe("which workspace a verified identity opens", () => {
  it("prefers an organization claim when the realm has one", () => {
    expect(
      workspaceBinding({ organization: { acme: { id: "org_1" } } }, "sub_1"),
    ).toEqual({ workspaceId: "kontier_org_org_1", label: "Kontier · acme" });
  });

  it("puts colleagues with the same VERIFIED email domain in one workspace", () => {
    const dana = workspaceBinding(
      { email: "dana@acme.com", email_verified: true },
      "sub_dana",
    );
    const sam = workspaceBinding(
      { email: "sam@ACME.com", email_verified: true },
      "sub_sam",
    );
    expect(dana.workspaceId).toBe("kontier_domain_acme.com");
    // Case must not split a company across two rooms.
    expect(sam.workspaceId).toBe(dana.workspaceId);
  });

  it("REFUSES to bind an unverified email to a domain", () => {
    // Without this, anyone who can register an address at a domain walks
    // into that company's workspace.
    const attacker = workspaceBinding(
      { email: "intruder@acme.com", email_verified: false },
      "sub_intruder",
    );
    expect(attacker.workspaceId).toBe("kontier_user_sub_intruder");
    expect(attacker.workspaceId).not.toContain("acme.com");
  });

  it("falls back to a stable private workspace rather than refusing", () => {
    const first = workspaceBinding({ preferred_username: "dana" }, "sub_x");
    const again = workspaceBinding({ preferred_username: "dana" }, "sub_x");
    expect(first.workspaceId).toBe("kontier_user_sub_x");
    expect(again.workspaceId).toBe(first.workspaceId);
  });

  it("keeps every workspace id filesystem-safe", () => {
    const nasty = workspaceBinding(
      { email: "x@../../etc/passwd", email_verified: true },
      "sub/../../root",
    );
    expect(nasty.workspaceId).not.toContain("/");
    expect(nasty.workspaceId).not.toContain("..");
  });
});
