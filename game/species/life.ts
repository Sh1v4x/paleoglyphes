import { scalePrim, type Prim } from "../render/raster";
import type { Species } from "./types";

/**
 * Cycle de vie dans la réserve : œuf -> bébé -> juvénile -> adulte -> âgé -> mort de vieillesse.
 * Les durées sont en secondes réelles (une journée de la réserve dure 8 min à vitesse x1) : une vie
 * dure quelques journées, assez pour voir naître, grandir et vieillir, sans que la réserve déborde.
 */

export type Stage = "baby" | "juvenile" | "adult" | "old";

/** L'espèce met-elle bas des petits vivants (gestation) plutôt que de pondre ? */
export const liveBirth = (spec: Species | undefined) => spec?.birth === "live";

/** Durée de vie (s) : les petites espèces vivent un peu moins longtemps que les géants. */
export function lifespan(spec: Species): number {
  return 1500 + Math.min(900, spec.lengthM * 70); // ~ 26 à 40 min
}

/** Fractions de la vie où l'on change de stade. */
export const STAGE_AT = { juvenile: 0.08, adult: 0.25, old: 0.82 } as const;

/** Durée d'incubation d'un œuf (s) et taille de couvée. */
export const INCUBATION = 150;
export const CLUTCH: readonly [number, number] = [2, 4];
/** Délai minimal entre deux nichées pour un même adulte (s). */
export const BREED_COOLDOWN = 420;
/** Plafond d'individus vivants par espèce dans la réserve (adultes + jeunes). */
export const MAX_PER_SPECIES = 10;

export function stageOf(spec: Species, life: number): Stage {
  const u = life / lifespan(spec);
  return u < STAGE_AT.juvenile ? "baby" : u < STAGE_AT.adult ? "juvenile" : u < STAGE_AT.old ? "adult" : "old";
}

/** Taille relative (0.32 bébé -> 1 adulte), qui grandit en douceur. */
export function growthOf(spec: Species, life: number): number {
  const u = Math.min(1, life / (lifespan(spec) * STAGE_AT.adult));
  return 0.32 + 0.68 * (1 - (1 - u) * (1 - u));
}

export const STAGE_NAME: Record<Stage, string> = { baby: "bebe", juvenile: "juvenile", adult: "adulte", old: "age" };

/**
 * Modèle d'un jeune : le corps est réduit à `g`, mais la tête (autour de l'œil) l'est moins,
 * comme chez les vrais bébés (grosse tête, gros yeux, museau court). Fonctionne pour toute espèce.
 */
export function juvenilePrims(prims: Prim[], spec: Species, g: number): Prim[] {
  if (g >= 0.999) return prims;
  const head = 1 + (1 - g) * 0.75; // facteur supplémentaire autour de la tête
  const ex = spec.eye.x, ey = spec.eye.y;
  const R = Math.max(18, spec.halfLen * 0.35);
  return prims.map((p) => {
    const px = p.k === "c" ? (p.ax + p.bx) / 2 : p.x, py = p.k === "c" ? (p.ay + p.by) / 2 : p.y;
    const d = Math.hypot(px - ex, py - ey);
    const k = d < R ? head : d < R * 2 ? 1 + (head - 1) * (1 - (d - R) / R) : 1;
    if (k === 1) return scalePrim(p, g);
    // Agrandit autour de l'œil, puis réduit l'ensemble.
    const grow = (x: number, y: number): [number, number] => [ex + (x - ex) * k, ey + (y - ey) * k];
    let q: Prim;
    if (p.k === "c") {
      const [ax, ay] = grow(p.ax, p.ay), [bx, by] = grow(p.bx, p.by);
      q = { ...p, ax, ay, bx, by, ra: p.ra * k, rb: p.rb * k, h: p.h * k };
    } else if (p.k === "e") {
      const [x, y] = grow(p.x, p.y);
      q = { ...p, x, y, rx: p.rx * k, ry: p.ry * k, h: p.h * k, yMin: undefined, yMax: undefined };
    } else {
      const [x, y] = grow(p.x, p.y);
      q = { ...p, x, y, rx: p.rx * k, ry: p.ry * k };
    }
    return scalePrim(q, g);
  });
}
