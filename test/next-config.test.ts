import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// Seed test for the green gate: guards the framework flags this app depends on.
describe("next.config", () => {
  it("keeps Cache Components enabled", () => {
    expect(nextConfig.cacheComponents).toBe(true);
  });

  it("routes CSS through the Tailwind turbopack loader", () => {
    const rule = nextConfig.turbopack?.rules?.["*.css"];
    expect(rule).toMatchObject({ loaders: ["@tailwindcss/turbopack"] });
  });
});
