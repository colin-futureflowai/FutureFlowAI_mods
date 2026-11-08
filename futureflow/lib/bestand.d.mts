export function weigerReden(pad: string): string | null
export function opdracht(tekst: string): string
export function uitAntwoord(antwoord: string): string
export function controleer(origineel: string, ingekort: string): { ok: boolean; fouten: string[] }
export function diff(oud: string, nieuw: string, max?: number): string
export function tokens(tekst: string): number
