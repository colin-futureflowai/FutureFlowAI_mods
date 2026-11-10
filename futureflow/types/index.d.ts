// Contract van de state van futureflow: Slots (momentopname voor het dashboard) en Minify (niveau en tellers).

export type SlotsMemory = { freePercent: number; totalGB: number; source: string }

export type SlotsHolder = {
  kind: string
  session?: string
  cwd?: string
  command?: string
  since?: string
  pid?: number
  childPid?: number
}

export type SlotsEvent = { t: string; kind?: string; tool?: string; reason?: string; command?: string }

export type OverflowJob = {
  id: string
  repo: string
  branch: string
  base: string
  task: string
  session?: string
  started: string
  status: 'running' | 'done'
  finished?: string
  commit?: string
  report?: string
  progress?: string
  error?: string
  delivered?: boolean
}

export type SlotsSnapshot = {
  memory: SlotsMemory
  config: { limits: Record<string, number>; floorPercent: number; criticalPercent: number; cloudOverflow?: boolean; enabled?: boolean }
  slots: SlotsHolder[]
  refusals: SlotsEvent[]
  overflow?: OverflowJob[]
  at: number
  error?: string
}

export type DashboardTab = 'overzicht' | 'slots' | 'minify' | 'stijl' | 'connectors' | 'api' | 'accounts' | 'openrouter'

/** `cli/connectors.mjs list` voor de projectsleutel (git-root van de sessiemap, anders die map zelf). */
export type ConnectorsLijst = {
  /** Sleutel in `projects` van ~/.claude.json. */
  sleutel: string
  /** De map van de sessie. */
  map: string
  /** Uitgezette servers (`disabledMcpServers`). */
  uit: string[]
  /** Servers uit de eigen configuratie (mcpServers, .mcp.json): die kan /mcp uitzetten. */
  servers: string[]
  fout?: string
  /** Epoch ms van het lezen. */
  gelezen: number
}

/** `cli/api.mjs status`: alleen de laatste 4 tekens van de key, nooit de key zelf. */
export type ApiStatus = {
  heeftKey: boolean
  staart: string
  modus: 'abonnement' | 'api' | 'openrouter'
  vreemdeHelper: boolean
  /** Een ANTHROPIC_BASE_URL in settings.json die niet van futureflow is. */
  vreemdeBasis?: boolean
  /** OpenRouter-key in de sleutelhanger; alleen de laatste 4 tekens. */
  orHeeftKey?: boolean
  orStaart?: string
  /** Op OpenRouter: het hoofd- en snelle model zoals ze in settings.json staan. */
  orModel?: string
  orSnel?: string
  /** claude-or staat klaar: eigen settings-bestand met modellen (sinds 0.9.0). */
  orKlaar?: boolean
  /** ~/.local/bin/claude-or bestaat en is van futureflow. */
  orShim?: boolean
  /** De map van de shim staat op het PATH van de CLI. */
  orOpPad?: boolean
  /** Oude OpenRouter-regels (futureflow < 0.9) in ~/.claude/settings.json. */
  oudeOr?: boolean
  fout?: string
}

/** Eén model uit `cli/api.mjs openrouter modellen`; prijzen in USD per miljoen tokens. */
export type OrModel = { id: string; naam: string; context?: number; in?: number; uit?: number }

/** Uitkomst van `cli/api.mjs openrouter modellen` (of een fout zonder lijst). */
export type OrModellen = { modellen: OrModel[]; opgehaald?: number; uitCache?: boolean; fout?: string }

/** Store `api.toestand` (zelfde vorm als Toestand in lib/api.d.mts). */
export type ApiToestand = {
  modus: 'abonnement' | 'api' | 'openrouter'
  /** Stappen van de ketting na de abonnementen, in volgorde (api, openrouter). */
  stappen: ('api' | 'openrouter')[]
  auto: boolean
  /** Naar API vanaf dit percentage van het 5u- of 7d-venster (50-100). */
  hoog: number
  /** Terug naar het abonnement onder dit percentage (0-90). */
  laag: number
  /** Het venster dat de automatische wissel naar API veroorzaakte, met zijn reset (epoch ms). */
  overgeschakeldDoor?: { label: string; resetsAt?: number }
  /** Epoch ms van de laatste wissel. */
  laatsteWissel: number
  /** Met de hand gekozen: tot dit moment (epoch ms) wisselt auto niet. */
  handmatigTot?: number
}

/** Eén venster van een account (5u of 7d): percentage en reset (epoch ms). */
export type AccountsVenster = { pct?: number; resetsAt?: number }

/** Eén account uit `cli/accounts.mjs status --json`; het e-mailadres is gemaskeerd (`co…@domein`). */
export type AccountsAccount = {
  id: number
  email: string
  plan: string
  inRotatie: boolean
  status: 'ok' | 'opnieuw-inloggen' | 'onbekend'
  statusUitleg?: string
  label?: string
  gebruik: { '5u'?: AccountsVenster; '7d'?: AccountsVenster }
  /** Epoch ms van de laatste geslaagde meting. */
  gemetenOp?: number
  fout?: string
}

/** Uitkomst van `cli/accounts.mjs status --json` (zelfde vorm als Status in lib/accounts.d.mts). */
export type AccountsStatus = {
  /** Het account dat nu in de terminal ingelogd is; null = geen bekend account. */
  actief: number | null
  profiel: 'standaard' | 'eigen'
  accounts: AccountsAccount[]
  instellingen: {
    auto: boolean
    marge5u: number
    marge7d: number
    strategie: 'meeste-ruimte'
    wachttijd: number
    hysterese: number
    stand: 'stil' | 'vragen'
    maxWacht: number
  }
  laatsteWissel?: { tijd: number; van: number | null; naar: number; auto: boolean }
  wacht?: { sinds: number; wie: string[] }
  fout?: string
  /** Epoch ms van het lezen. */
  gelezen: number
}

/** Stand *vragen*: de wissel die futureflow voorstelt, met knoppen boven de prompt. */
export type AccountsVraag = { soort: 'account' | 'terug'; naar: number; van: number | null; reden: string }

/** Een wissel die wacht op sessies die midden in een beurt zitten. */
export type AccountsWacht = { sinds: number; wie: string[]; naar: number }

/** Groene regel boven de prompt na een wissel (ook uit een andere sessie), tot `tot` (epoch ms). */
export type AccountsMelding = { tekst: string; tot: number }

export type MinifyNiveau = 'O1' | 'O2' | 'O3' | 'uit'

export type MinifyTeller = {
  /** Beurten van de hoofdsessie met een gemeten usage. */
  beurten: number
  /** Output-tokens van die beurten samen. */
  output: number
  /** Tooluitvoer die minify inkortte: aantal keer en tekens voor en na. */
  ingekort: number
  uitvoerVoor: number
  uitvoerNa: number
}

/** Eén ingekorte tooluitvoer, voor de lijst in het dashboard. */
export type MinifyInkorting = {
  tool: string
  voor: number
  na: number
  pad: string
  t: number
}

/** Eén stap van de voortgangsbalk (zelfde vorm als in lib/voortgang.d.mts). */
export type Stap = { id: string; titel: string; status: 'klaar' | 'bezig' | 'open' }

/** De takenlijst van de voortgangsbalk: doel (uit de opdracht), stappen en begintijd (epoch ms). */
export type Lijst = { doel: string; stappen: Stap[]; begin: number }

declare module 'claude-code' {
  interface EngineInterface {
    // What the skin-code mod adds, when it is installed (absent, or a call throws, when it
    // is not): skins leaves it the replies it draws.
    skinCode?: {
      draws: (args: { text: string }) => Promise<boolean>
    }
  }

  interface PluginState {
    futureflow: {
      // State van de ingebouwde claude-skins (hooks/skins), met `skins.` voor elke sleutel.
      'skins.prefs': Prefs
      'skins.custom': Record<string, CustomSkin>
      'skins.startedAt': number
      'skins.frame': number
      'skins.turns': Record<string, TurnStats>
      'skins.duration': StateFamily<number>
      'skins.editing': SkinSlot
      'skins.usage': UsageSnap
      // The usage band's countdowns by limit label, as last drawn.
      'skins.countdowns': Record<string, string>
      'skins.isLight': boolean
      'skins.images': StateFamily<boolean>
      'skins.quiet': StateFamily<boolean>
      // A shell call's command, for its output card's header: ToolResult does not carry it.
      'skins.command': StateFamily<string>
      // Each tool row's chevron, and whether its opened answer shows past the fold.
      'skins.disclosure': StateFamily<Disclosure>
      'skins.showAll': StateFamily<boolean>
      // Files the turn created or edited, by absolute path, for their colour in rows and prose.
      'skins.touched': Record<string, Touch>
      // Per drawing, the keys of the blocks the person unfolded.
      'skins.folds': StateFamily<string[]>
      'skins.compacting': boolean
      'skins.pinned': boolean
      'skins.settle': number
      'skins.lastReply': string
      'slots.snapshot': SlotsSnapshot | null
      'dashboard.tab': DashboardTab | null
      'minify.niveau': MinifyNiveau | null
      'minify.teller': MinifyTeller | null
      /** Output-tokens per beurt van deze sessie, de laatste 60. */
      'minify.reeks': number[] | null
      /** De laatste 8 inkortingen, nieuwste eerst. */
      'minify.recent': MinifyInkorting[] | null
      /** Takenlijst van de hoofdsessie voor de voortgangsbalk; null = geen balk. */
      'voortgang.lijst': Lijst | null
      /** Uitgeklapt (true) of ingeklapt; null = nog niet gezet, dan geldt de store `voortgang.open`. */
      'voortgang.open': boolean | null
      /** Wanneer de lijst 100% werd (epoch ms); 0 = niet af. De ✓-regel blijft 5 s staan. */
      'voortgang.klaarSinds': number
      /** Doel uit de laatste getypte opdracht (eerste regel, max 60 tekens). */
      'voortgang.opdracht': string
      /** Telt op als de ✓-regel moet verdwijnen, zodat de balk opnieuw tekent. */
      'voortgang.tik': number
      /** Laatst gelezen lijst van de tab Connectors (na openen, na een klik en elke 30 s); null = nog niet gelezen. */
      'connectors.lijst': ConnectorsLijst | null
      /** Per server wat in deze sessie met een klik is omgezet; geldt pas vanaf de volgende sessie. */
      'connectors.gewijzigd': Record<string, 'uit' | 'aan'>
      /** Uitkomst van `cli/api.mjs status` (nooit de key zelf); null = nog niet gelezen. */
      'api.status': ApiStatus | null
      /** Kopie van de store `api.toestand`, zodat de tab opnieuw tekent na een wissel. */
      'api.toestand': ApiToestand | null
      /** Telt op na een actie in de tab API, zodat die opnieuw tekent (en het key-veld leeg wordt). */
      'api.versie': number
      /** Takenlijst-tools in de terminal aan (env in settings.json); null = nog niet gelezen. */
      'stijl.takenlijst': boolean | null
      /** Modellijst van OpenRouter (cache van de CLI); null = nog niet gelezen. */
      'openrouter.modellen': OrModellen | null
      /** Zoektekst in de tab OpenRouter. */
      'openrouter.zoek': string
      'openrouter.pagina': number
      /** Telt op na een actie in de tab OpenRouter, zodat die opnieuw tekent. */
      'openrouter.versie': number
      /** Uitkomst van de laatste verbindingstest (één regel); null = nog niet getest. */
      'openrouter.test': string | null
      /** Laatst gelezen status van de tab Accounts (bij openen, na een klik, elke 30 s en na een meting); null = nog niet gelezen. */
      'accounts.status': AccountsStatus | null
      /** Telt op na een actie in de tab Accounts, zodat die opnieuw tekent. */
      'accounts.versie': number
      /** Telt op na een actie in de kaart Automatisch wisselen (tabs API, Accounts, OpenRouter). */
      'wissel.versie': number
      /** Stand vragen: de voorgestelde wissel; null = geen vraag. */
      'accounts.vraag': AccountsVraag | null
      /** Een wissel die wacht op bezige sessies; null = niets. */
      'accounts.wacht': AccountsWacht | null
      /** Wisselmelding boven de prompt; null = geen. */
      'accounts.melding': AccountsMelding | null
      /** Deze sessie is een desktop-sessie (CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH): de tab is alleen-lezen. */
      'accounts.desktop': boolean
      /** Tot wanneer auto een keuze met de hand laat staan (ms); null = geen. */
      'accounts.handmatigTot': number | null
      /** Het account waarvoor Verwijderen één keer is aangeklikt (tweede klik bevestigt); null = geen. */
      'accounts.weg': number | null
    }
  }
}

// ---- claude-skins (MIT, hellosverre, commit cf0d39f): typen van de ingebouwde skin ----

// Every colour a skin names. `fg` is body text, `muted` secondary text, `surface` the
// band behind a table header, `zebra` every other table row.
export type SkinSlot =
  | 'read'
  | 'write'
  | 'run'
  | 'search'
  | 'web'
  | 'mcp'
  | 'other'
  | 'user'
  | 'fg'
  | 'muted'
  | 'surface'
  | 'zebra'
  | 'ok'
  | 'err'
  | 'warn'

// What /skin and the settings pane change. `skin` is a skin's name, or 'off'.
export type Prefs = {
  skin: string
  icons: 'unicode' | 'ascii'
  // Which side the outline around a typed prompt sits on; 'right' matches the desktop app.
  // 'plain' drops the outline for a leading marker.
  prompt: 'left' | 'right' | 'plain'
  // Whose words the spinner and the turn footer show: 'claude' keeps Claude Code's own,
  // whatever the skin says; 'skin' draws the skin's.
  words: 'claude' | 'skin'
  rail: boolean
  // 'text' keeps the skin but draws tables and code as text the desktop can select.
  tables: 'on' | 'text' | 'off'
  shimmer: boolean
  band: boolean
  // When each plan limit resets, beside its meter in the band.
  countdown: boolean
  clipOutput: boolean
  markdown: boolean
  quiet: boolean
  charts: boolean
  // Display formulas as cards and inline TeX as Unicode.
  math: boolean
  // Tables and code in slash-command output drawn the way replies are.
  commands: boolean
  // Shell output as a card: the command, its exit status, stderr apart, long output folded.
  shell: boolean
  // Fenced code on the terminal and shell output in the skin's colours.
  highlight: boolean
  // The model-only note that charts and diagrams draw here.
  hints: boolean
  // Bare URLs as links: OSC 8 where the terminal draws it, anchors on the desktop.
  links: boolean
  // Copy buttons on tables, code, diagrams and whole replies.
  copy: boolean
  // Long code, tables and shell output folded behind a `▾ N more` control.
  fold: boolean
  // Runs of reads and searches drawn open, as if each had been expanded, not as one line.
  expand: boolean
  // The band's Compact button, and its nudge once the context is full enough to be worth it.
  compact: boolean
  // While /skin calm is on, the parts it changed as they were before it, for calm off to
  // put back; null while it is off.
  calm: CalmSnapshot | null
}

// The prefs /skin calm changes: no shimmer, no rail line above each tool row, quiet output.
export type CalmSnapshot = { shimmer: boolean; rail: boolean; quiet: boolean }

// A skin someone made in the settings pane or through their agent: a built-in skin
// with some slots and words changed.
export type CustomSkin = {
  name: string
  label: string
  base: string
  palette: Partial<Record<SkinSlot, string>>
  spinner: string[]
  done: string[]
}

// How full the context window is and how much of each plan limit is spent, in percent,
// as the band above the prompt shows them, and when each limit resets (epoch ms) where known.
export type UsageSnap = { context: number | null; limits: { label: string; percent: number; resetsAt?: number }[] }

// What one turn did, shown in its footer.
export type TurnStats = { tools: number; added: number; removed: number }

// What this turn did to a file: made it, or changed one that was there.
export type Touch = 'created' | 'edited'

// How a tool row stands: opened or closed by the person, or `auto`, open only when the
// call failed.
export type Disclosure = 'auto' | 'open' | 'closed'

// `$.skins.markdown`'s argument: where the tree draws, the markdown, the width in columns.
export type SkinsMarkdownArgs = { surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'; text: string; columns: number }
