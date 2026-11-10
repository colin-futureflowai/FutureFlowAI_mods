export const LANG: string[]
export const KORT: string[]
export const KORT_ONDER: number
export const TWEE_KOLOMMEN_VANAF: number
export const SCHEIDING: string
export function binnenBreedte(kolommen: number | undefined): number
export function kaartBreedte(breedte: number): number
export function tabTekst(i: number, naam: string): string
export function tabNamen(kolommen: number | undefined): string[]
export function tabRijen(namen: readonly string[], breedte: number): number[][]
export function rijBreedte(namen: readonly string[], rij: readonly number[]): number
export function onderstreping(namen: readonly string[], rij: readonly number[], gekozen: number): string
export function kolommenVoor(breedte: number): { n: number; breed: number }
