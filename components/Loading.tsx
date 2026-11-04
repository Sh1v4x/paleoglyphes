/**
 * Écran de chargement : affiché pendant le téléchargement du jeu, puis pendant la génération de la
 * carte (quelques secondes, le navigateur est occupé : on annonce l'étape en cours avant chacune).
 */
const DINO = String.raw`
               __
              / _)
     _.----._/ /
    /         /
 __/ (  | (  |
/__.-'|_|--|_|`;

export default function Loading({ step }: { step: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <pre aria-hidden="true">{DINO}</pre>
      <p className="loading-title">PALEOGLYPHES</p>
      <p>{step}</p>
    </div>
  );
}
