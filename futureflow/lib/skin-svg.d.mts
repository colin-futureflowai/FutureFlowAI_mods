import type { Palet } from './thema.mjs'
import type { DiffRegel, Shell, ShellStatus } from './skin.mjs'
export function diffSvg(regels: DiffRegel[], pad: string, tel: { plus: number; min: number }, p: Palet, breedte?: number): string
export function shellSvg(commando: string, sh: Shell, status: ShellStatus, p: Palet, breedte?: number): string
