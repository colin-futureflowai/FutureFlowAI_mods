export type Stap = { id: string; titel: string; status: 'klaar' | 'bezig' | 'open' }
export type Lijst = { doel: string; stappen: Stap[]; begin: number }

export function doelVan(opdracht: string): string
export function pasToe(lijst: Lijst | null, tool: string, input: unknown, result: unknown, nu: number, opdracht: string): Lijst | null
export function telling(l: Lijst): { klaar: number; bezig: number; open: number }
export function percentage(l: Lijst): number
export function huidige(l: Lijst): Stap | undefined
export function positie(l: Lijst): number
export function blokjes(l: Lijst, max?: number): { vol: string; leeg: string }
export function duur(ms: number): string
