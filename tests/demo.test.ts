import { describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";
import { seedDemo, resetDemo, exportAllJson } from "@/demo/seed";
import { db } from "@/db";

describe("demo data", () => {
  it("refuses to seed the real (main) profile", async () => {
    await freshDb();
    await expect(seedDemo()).rejects.toThrow();
  });
  it("seeds a complete, clearly-labelled dataset in the demo profile", async () => {
    await freshDb("demo");
    await seedDemo();
    const [p] = await db().select<{ n: number }>("SELECT count(*) AS n FROM projects");
    expect(p.n).toBeGreaterThan(4);
    const names = await db().select<{ name: string }>("SELECT name FROM projects");
    expect(names.every((x) => x.name.includes("(demo)"))).toBe(true);
    const [t] = await db().select<{ n: number }>("SELECT count(*) AS n FROM financial_transactions");
    expect(t.n).toBeGreaterThan(50);
    await resetDemo();
    const [p2] = await db().select<{ n: number }>("SELECT count(*) AS n FROM projects");
    expect(p2.n).toBe(p.n);
    expect(JSON.parse(await exportAllJson()).profile).toBe("demo");
  });
});
