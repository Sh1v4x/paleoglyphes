import { describe, expect, it } from "vitest";
import { hash2, mulberry32 } from "./rng";

describe("mulberry32", () => {
  it("replays the same sequence for the same seed", () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("stays in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs between seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("hash2", () => {
  it("is stable and in [0, 1)", () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (let x = -20; x < 20; x++) {
      const v = hash2(x, x * 7, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("depends on every argument", () => {
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 2, 4));
  });
});
