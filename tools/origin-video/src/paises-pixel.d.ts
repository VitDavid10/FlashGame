// Types for the game's own country-skin module (game/paises-pixel.js), which the
// video imports as is so its pills are the ones players actually wear.
declare module "*/paises-pixel.js" {
  type Forma = (u: number, v: number) => boolean;
  export const PAISES: Record<string, { n: string }>;
  export const PAIS_FORMAS: Record<string, Forma>;
  export function paisPillRot(wL: number, code: string, ang?: number, forzarEmblema?: boolean): { cv: HTMLCanvasElement; S: number } | null;
}
