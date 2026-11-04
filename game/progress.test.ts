import { describe, expect, it } from "vitest";
import { addBone, emptyProgress, factKey, hasFact, loadProgress, parseProgress } from "./progress";

describe("addBone", () => {
  it("adds a bone once", () => {
    const p = emptyProgress();
    expect(addBone(p, "trike", "crane")).toBe(true);
    expect(addBone(p, "trike", "crane")).toBe(false);
    expect(p.bones.trike).toEqual(["crane"]);
  });
});

describe("hasFact", () => {
  it("reads the species:fact key", () => {
    const p = emptyProgress();
    p.facts.push(factKey("trike", "bec"));
    expect(hasFact(p, "trike", "bec")).toBe(true);
    expect(hasFact(p, "trex", "bec")).toBe(false);
  });
});

describe("loadProgress", () => {
  it("starts empty without storage", () => {
    expect(loadProgress()).toEqual(emptyProgress());
  });
});

describe("parseProgress", () => {
  it("keeps a valid save", () => {
    const p = { ...emptyProgress(), bones: { trike: ["crane"] }, assembled: ["trike"], facts: ["trike:bec"], digs: 2, hints: 1, digSite: "niobrara", biomes: [0, 2] };
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
  });

  it("falls back field by field on a corrupted save", () => {
    const raw = JSON.stringify({ facts: "oops", bones: null, assembled: ["trike", 4, "dodo"], digs: "2", population: { trike: 3, dodo: 1 }, digSite: "atlantis" });
    const p = parseProgress(raw);
    expect(p.facts).toEqual([]);
    expect(p.bones).toEqual({});
    expect(p.assembled).toEqual(["trike"]);
    expect(p.digs).toBe(0);
    expect(p.population).toEqual({ trike: 3 });
    expect(p.digSite).toBeUndefined();
  });

  it("returns an empty progress for a non-object", () => {
    expect(parseProgress("[1,2]")).toEqual(emptyProgress());
  });
});
