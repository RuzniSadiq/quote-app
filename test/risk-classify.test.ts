import { describe, expect, it } from "vitest";
import { classify } from "../scripts/risk-classify.mjs";

const f = (filename: string, added: string[] = []) => ({
  filename,
  patch: added.map((l) => `+${l}`).join("\n"),
});

describe("risk-classify", () => {
  it("leaves a plain UI change as not Tier C", () => {
    const r = classify([f("app/page.tsx", ["<h1>Get a quote</h1>"]), f("app/globals.css")]);
    expect(r.tierC).toBe(false);
    expect(r.categories).toEqual([]);
  });

  it.each([
    ["money", "app/checkout/page.tsx"],
    ["money", "lib/pricing.ts"],
    ["auth", "proxy.ts"],
    ["auth", "app/login/page.tsx"],
    ["pii", "app/contact/actions.ts"],
    ["security", ".github/workflows/gibson-gate.yml"],
    ["security", "app/api/quotes/route.ts"],
    ["security", "next.config.ts"],
    ["prod-data", "prisma/schema.prisma"],
    ["prod-data", "db/migrations/0001_init.sql"],
  ])("flags %s for path %s", (cat, path) => {
    const r = classify([f(path)]);
    expect(r.tierC).toBe(true);
    expect(r.categories).toContain(cat);
  });

  it.each([
    ["money", 'import Stripe from "stripe";'],
    ["auth", 'import NextAuth from "next-auth";'],
    ["pii", '<input type="email" name="email" />'],
    ["security", '"use server";'],
    ["security", "<div dangerouslySetInnerHTML={{ __html: x }} />"],
    ["prod-data", "const url = process.env.DATABASE_URL;"],
  ])("flags %s for added line %s", (cat, line) => {
    const r = classify([f("app/components/widget.tsx", [line])]);
    expect(r.categories).toContain(cat);
  });

  it("ignores removed lines and diff headers", () => {
    const r = classify([{ filename: "app/x.tsx", patch: '--- a/app/x.tsx\n+++ b/app/x.tsx\n-import Stripe from "stripe";' }]);
    expect(r.tierC).toBe(false);
  });

  it("checks the pre-rename path too", () => {
    const r = classify([{ filename: "app/old-stuff.ts", previous_filename: "app/billing/old-stuff.ts" }]);
    expect(r.categories).toContain("money");
  });
});
