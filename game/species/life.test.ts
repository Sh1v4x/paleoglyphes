import { describe, expect, it } from "vitest";
import { SPECIES } from ".";
import { growthOf, lifespan, STAGE_AT, stageOf } from "./life";

const trike = SPECIES.trike;
const at = (u: number) => u * lifespan(trike);

describe("stageOf", () => {
  it("walks through the four stages in order", () => {
    expect(stageOf(trike, 0)).toBe("baby");
    expect(stageOf(trike, at(STAGE_AT.juvenile))).toBe("juvenile");
    expect(stageOf(trike, at(STAGE_AT.adult))).toBe("adult");
    expect(stageOf(trike, at(STAGE_AT.old))).toBe("old");
    expect(stageOf(trike, at(2))).toBe("old");
  });
});

describe("growthOf", () => {
  it("grows from 0.32 to 1 at adulthood, then stays at 1", () => {
    expect(growthOf(trike, 0)).toBeCloseTo(0.32);
    expect(growthOf(trike, at(STAGE_AT.adult))).toBeCloseTo(1);
    expect(growthOf(trike, at(0.9))).toBeCloseTo(1);
  });

  it("never shrinks", () => {
    let prev = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const g = growthOf(trike, at(u));
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});
