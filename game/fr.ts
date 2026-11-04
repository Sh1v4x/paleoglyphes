const ELISION = /^[aeiouyhàâäéèêëîïôöûüAEIOUYHÀÂÄÉÈÊËÎÏÔÖÛÜ]/;

export const elides = (word: string) => ELISION.test(word);

/** « le Tricératops », « l'Ankylosaure ». */
export const le = (name: string) => (elides(name) ? `l'${name}` : `le ${name}`);

/** « du Tricératops », « de l'Ankylosaure ». */
export const du = (name: string) => (elides(name) ? `de l'${name}` : `du ${name}`);

/** « de Tricératops », « d'Edmontosaure ». */
export const de = (name: string) => (elides(name) ? `d'${name}` : `de ${name}`);

export const plural = (name: string) => (/[sx]$/i.test(name) ? name : `${name}s`);
