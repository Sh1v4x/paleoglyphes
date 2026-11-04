import { describe, expect, it } from "vitest";
import { interest, starsText, titleOf, type ShotContext, type Subject } from "./photo-score";

const day: ShotContext = { area: 1000, night: false, golden: false, hour: 12, population: {} };

function subject(over: Partial<Subject>): Subject {
  return {
    kind: "animal", sp: "trike", name: "Tricératops", stage: "adult", act: "idle", carnivore: false,
    inside: 100, total: 100, cx: 0.5, cy: 0.5, water: false, habitat: "land", ...over,
  };
}

describe("interest", () => {
  it("ranks spectacular, nice and plain moments", () => {
    expect(interest("hunt")).toBe(1);
    expect(interest("eat")).toBe(0.5);
    expect(interest("idle")).toBe(0);
  });
});

describe("titleOf", () => {
  it("names the landscape without a subject", () => {
    expect(titleOf([], -1, day)).toBe("Paysage de la réserve");
    expect(titleOf([], -1, { ...day, night: true })).toBe("La réserve sous la lune");
  });

  it("counts members of the main species", () => {
    const herd = [subject({}), subject({}), subject({})];
    expect(titleOf(herd, 0, day)).toBe("Trois Tricératops");
  });

  it("does not count a nest as an animal of the other species", () => {
    const shot = [
      subject({ sp: "trex", name: "T. rex", carnivore: true }),
      subject({}),
      subject({ kind: "nest", act: "nest" }),
    ];
    expect(titleOf(shot, 0, day)).toBe("Un T. rex face à un Tricératops");
  });

  it("elides before a vowel for nests", () => {
    const nest = subject({ kind: "nest", sp: "edmonto", name: "Édmontosaure", act: "nest" });
    expect(titleOf([nest], 0, day)).toBe("Un nid d'Édmontosaure");
  });
});

describe("starsText", () => {
  it("draws five slots", () => {
    expect(starsText(3)).toBe("***..");
    expect(starsText(0)).toBe(".....");
  });

  it("clamps out-of-range ratings instead of throwing", () => {
    expect(starsText(6)).toBe("*****");
    expect(starsText(-2)).toBe(".....");
  });
});
