import { describe, expect, it } from "vitest";
import { createFrame } from "../render/frame";
import { captureCells, validPhoto, type Photo } from "./photo-store";

function photo(over: Partial<Photo> = {}): Photo {
  return {
    id: "a1", day: 1, clock: 9, real: 1, title: "Un Tricératops", stars: 3, species: ["trike"], notes: [],
    cols: 2, rows: 1, ch: new Uint8Array(2), fg: new Uint8Array(6), bg: new Uint8Array(6), ...over,
  };
}

describe("captureCells", () => {
  it("copies glyphs and RGB colors of the rectangle", () => {
    const f = createFrame(4, 3);
    const i = 1 * 4 + 2;
    f.ch[i] = 65;
    f.fg.set([10, 20, 30, 255], i * 4);
    f.bg.set([1, 2, 3, 255], i * 4);
    const c = captureCells(f, 2, 1, 2, 2);
    expect(c.cols).toBe(2);
    expect(c.rows).toBe(2);
    expect(c.ch[0]).toBe(65);
    expect([...c.fg.slice(0, 3)]).toEqual([10, 20, 30]);
    expect([...c.bg.slice(0, 3)]).toEqual([1, 2, 3]);
  });

  it("clamps the rectangle to the frame", () => {
    const c = captureCells(createFrame(4, 3), 3, 2, 10, 10);
    expect(c.cols).toBe(1);
    expect(c.rows).toBe(1);
  });
});

describe("validPhoto", () => {
  it("accepts a well-formed record", () => {
    expect(validPhoto(photo())).toBe(true);
  });

  it("rejects missing display fields and wrong sizes", () => {
    expect(validPhoto(null)).toBe(false);
    expect(validPhoto({ ...photo(), notes: undefined })).toBe(false);
    expect(validPhoto({ ...photo(), real: undefined })).toBe(false);
    expect(validPhoto({ ...photo(), stars: "5" })).toBe(false);
    expect(validPhoto({ ...photo(), species: ["dodo"] })).toBe(false);
    expect(validPhoto(photo({ fg: new Uint8Array(3) }))).toBe(false);
  });
});
