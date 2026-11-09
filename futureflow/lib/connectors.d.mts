export type McpTool = { name: string; serverName: string; tokens: number; isLoaded: boolean }
export type ServerRij = { server: string; tools: number; tokens: number; inContext: number; uit: boolean }
export function perServer(mcpTools: McpTool[] | null | undefined, uit: string[] | null | undefined, ook?: string[]): ServerRij[]
export function totalen(rijen: ServerRij[]): { tokens: number; inContext: number }
export function getal(n: number): string
export function procent(deel: number, geheel: number): string
