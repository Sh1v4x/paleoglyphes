export function fmtNum(v: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(v * f) / f).replace(".", ",");
}

export const fmtM = (m: number) => `${fmtNum(m)} m`;

export const fmtKg = (kg: number) => (kg >= 1000 ? `${fmtNum(kg / 1000)} t` : `${Math.round(kg)} kg`);
