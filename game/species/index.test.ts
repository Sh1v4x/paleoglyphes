import { describe, expect, it } from "vitest";
import { MATERIAL_SETS } from "../palette";
import { emptyProgress } from "../progress";
import { M } from "../render/materials";
import { isSpeciesId, ofName, SPECIES, SPECIES_LIST } from ".";
import { hasEggs } from "./eggs";
import { liveBirth } from "./life";

describe("ofName", () => {
  it("hides the name until the skeleton is assembled", () => {
    const p = emptyProgress();
    p.bones.trike = ["crane"];
    expect(ofName(p, "trike")).toBe("de l'espece mystere n1");
    p.assembled.push("trike");
    expect(ofName(p, "trike")).toBe("de Tricératops");
  });

  it("elides before a vowel", () => {
    const p = emptyProgress();
    p.assembled.push("ankylo");
    expect(ofName(p, "ankylo")).toBe("d'Ankylosaure");
  });
});

describe("species data", () => {
  it("indexes each species under its own id", () => {
    for (const [k, spec] of Object.entries(SPECIES)) expect(spec.id).toBe(k);
    expect(SPECIES_LIST.every((s) => isSpeciesId(s.id))).toBe(true);
  });

  it("has unique fact ids per species, the first one unlocked by discover or assemble", () => {
    for (const spec of SPECIES_LIST) {
      const ids = spec.facts.map((f) => f.id);
      expect(new Set(ids).size, spec.id).toBe(ids.length);
      expect(["discover", "assemble"], spec.id).toContain(spec.facts[0].unlock);
    }
  });

  it("migrates only between its own biomes", () => {
    for (const spec of SPECIES_LIST) {
      if (!spec.migration) continue;
      for (const b of [...spec.migration.summer, ...spec.migration.winter]) expect(spec.biomes, spec.id).toContain(b);
    }
  });

  it("has an egg design exactly for the species that lay eggs", () => {
    for (const spec of SPECIES_LIST) expect(liveBirth(spec), spec.id).toBe(!hasEggs(spec.id));
  });

  it("hunts only existing species", () => {
    for (const spec of SPECIES_LIST) for (const prey of spec.behavior.prey) expect(isSpeciesId(prey), `${spec.id} -> ${prey}`).toBe(true);
  });
});

describe("materials", () => {
  it("never reuses a material id across sets", () => {
    for (const style of ["dark", "cartoon"] as const) {
      const owner = new Map<number, string>();
      for (const [name, id] of Object.entries(M)) owner.set(id, `core:${name}`);
      MATERIAL_SETS.forEach((set, i) => {
        for (const k of Object.keys(set[style])) {
          const id = Number(k);
          expect(owner.get(id), `${style} set #${i} id ${id}`).toBeUndefined();
          owner.set(id, `set #${i}`);
        }
      });
    }
  });
});
