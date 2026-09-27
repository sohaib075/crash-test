// Every graph8 operationId the code calls must exist in @graph8/sdk's published
// contract, the forbidden ones are blocked at the call layer, and no code path
// can edit, void or resend a sent quote from the app.
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ops = new Set((JSON.parse(readFileSync("docs/ops.json", "utf8")) as { id: string }[]).map((o) => o.id));
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
const used = (paths: string[]) => {
  const out = new Set<string>();
  for (const f of paths) for (const m of readFileSync(f, "utf8").matchAll(/"([a-z0-9_]+_(?:get|post|patch|put|delete))"/g)) out.add(m[1]);
  return out;
};

describe("graph8 contract", () => {
  const app = used([...files("packages/core/src"), ...files("packages/ai/src"), ...files("apps/server/src"), ...files("apps/worker/src")]);
  const scripts = used(files("scripts"));

  it("uses only operationIds that exist", () => {
    expect(app.size).toBeGreaterThan(30);
    expect([...app, ...scripts].filter((id) => !ops.has(id))).toEqual([]);
  });

  it("the app never edits, voids or resends a quote", () => {
    const forbidden = [...app].filter((id) => /quote/.test(id) && !/^(list_quotes|get_quote)/.test(id));
    expect(forbidden).toEqual([]);
  });

  it("assign-owner is refused unless scoped to a list_id", async () => {
    process.env.GRAPH8_API_KEY = "test-key-no-network";
    const { call } = await import("../packages/core/src/graph8/client");
    await expect(call("assign_contact_owner_contacts_assign_owner_post", { body: { owner_id: null } })).rejects.toThrow(/Safety/);
    await expect(call("assign_contact_owner_contacts_assign_owner_post", { body: { owner_id: null, list_id: 7, filterModel: {} } })).rejects.toThrow(/Safety/);
    await expect(call("assign_company_owner_companies_assign_owner_post", { body: { list_id: 7 } })).rejects.toThrow(/Safety/);
    process.env.GRAPH8_API_KEY = "";
    // The only caller passes a temporary list.
    const callers = files("packages/core/src").filter((f) => !f.endsWith("client.ts") && /assign_contact_owner/.test(readFileSync(f, "utf8")));
    expect(callers).toEqual([path.join("packages", "core", "src", "graph8", "backend.ts")]);
    expect(readFileSync(callers[0], "utf8")).toMatch(/assign_contact_owner_contacts_assign_owner_post", \{ body: \{ owner_id: null, list_id: num\(listId\) \} \}/);
  });
});
