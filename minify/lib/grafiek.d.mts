export const KLEUR: { accent: string; accentZacht: string; goed: string; raster: string; tekst: string }
export function kort(n: number): string
export function lijn(waarden: number[], opties?: { breedte?: number; hoogte?: number }): string | null
export type Staaf = { label: string; waarde: number; nadruk?: boolean; tekst?: string }
export function staven(rijen: Staaf[], opties?: { breedte?: number; rijHoogte?: number }): string | null
export function tekstBalk(deel: number, geheel: number, breedte?: number): string
