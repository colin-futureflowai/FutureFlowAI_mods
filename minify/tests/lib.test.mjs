import { test } from 'node:test'
import assert from 'node:assert/strict'

import { herinnering, isUitVerzoek, leesCommando, normaliseerNiveau, regelsVoor, subagentRegel } from '../lib/regels.mjs'
import { inkorten, jsonSkelet, opschonen, samenvoegen, voetregel } from '../lib/uitvoer.mjs'
import { controleer, diff, uitAntwoord, weigerReden } from '../lib/bestand.mjs'

// ---------- regels ----------

test('niveaus lezen, ook met streepje en als getal', () => {
  assert.equal(normaliseerNiveau('O2'), 'O2')
  assert.equal(normaliseerNiveau('-o3'), 'O3')
  assert.equal(normaliseerNiveau('1'), 'O1')
  assert.equal(normaliseerNiveau('O0'), 'uit')
  assert.equal(normaliseerNiveau('uit'), 'uit')
  assert.equal(normaliseerNiveau('O4'), null)
})

test('commando /minify lezen', () => {
  assert.deepEqual(leesCommando(''), { soort: 'status' })
  assert.deepEqual(leesCommando('O3'), { soort: 'niveau', niveau: 'O3' })
  assert.deepEqual(leesCommando('uit'), { soort: 'uit' })
  assert.deepEqual(leesCommando('bestand ./CLAUDE.md'), { soort: 'bestand', pad: './CLAUDE.md' })
  assert.deepEqual(leesCommando('herstel /a b/CLAUDE.md'), { soort: 'herstel', pad: '/a b/CLAUDE.md' })
  assert.deepEqual(leesCommando('standaard O1'), { soort: 'standaard', niveau: 'O1' })
  assert.deepEqual(leesCommando('toepassen'), { soort: 'toepassen' })
  assert.equal(leesCommando('bestand').soort, 'onbekend')
  assert.equal(leesCommando('banaan').soort, 'onbekend')
})

test('regels per niveau noemt het niveau en houdt de vaste regels', () => {
  for (const n of ['O1', 'O2', 'O3']) {
    const s = regelsVoor(n)
    assert.match(s, new RegExp(`minify -${n}`))
    assert.match(s, /niet, geen, nooit, alleen/)
    assert.match(s, /buiten de chat/)
  }
  assert.match(regelsVoor('O3'), /fragmenten/)
  assert.doesNotMatch(regelsVoor('O1'), /fragmenten\. Lidwoorden/)
  assert.match(subagentRegel('O2'), /^\[minify -O2\] Houd je eindrapport kort/)
  assert.match(herinnering('O3'), /^\[minify -O3\].*Fragmenten mogen/)
  assert.ok(herinnering('O2').length < 500)
})

test('uitzetten in gewone taal, alleen als het hele bericht dat zegt', () => {
  assert.equal(isUitVerzoek('doe normaal'), true)
  assert.equal(isUitVerzoek('Doe eens normaal!'), true)
  assert.equal(isUitVerzoek('stop minify'), true)
  assert.equal(isUitVerzoek('kun je uitleggen hoe stop minify werkt?'), false)
  assert.equal(isUitVerzoek('doe normaal tegen de klant in die mail'), false)
})

// ---------- uitvoer ----------

test('korte uitvoer blijft ongemoeid', () => {
  const r = inkorten('ok\n', { drempel: 100 })
  assert.equal(r.ingekort, false)
  assert.equal(r.tekst, 'ok\n')
})

test('ANSI-kleuren en voortgangsbalken gaan weg', () => {
  assert.equal(opschonen('\u001b[31mrood\u001b[0m'), 'rood')
  assert.equal(opschonen('10%\r50%\r100%'), '100%')
})

test('herhaalde regels die alleen in getallen verschillen worden samengevoegd', () => {
  const r = samenvoegen(['start', 'ok 1', 'ok 2', 'ok 3', 'ok 4', 'einde'])
  assert.deepEqual(r, ['start', 'ok 1', '… 2× vergelijkbare regel …', 'ok 4', 'einde'])
})

test('lange testuitvoer: begin, eind en foutregels met de regel erna blijven', () => {
  const regels = []
  for (let i = 0; i < 400; i++) regels.push(`✓ module${i % 7} doet ding ${'x'.repeat(i % 5)} variant-${String.fromCharCode(97 + (i % 26))}`)
  regels.splice(200, 0, 'FAIL src/auth.test.ts > token verloopt', '    at src/auth.ts:42:7')
  regels.push('Tests: 1 failed, 399 passed')
  const r = inkorten(regels.join('\n'), { drempel: 2000 })
  assert.equal(r.ingekort, true)
  assert.ok(r.na < r.voor / 2)
  assert.match(r.tekst, /FAIL src\/auth\.test\.ts/)
  assert.match(r.tekst, /src\/auth\.ts:42:7/)
  assert.match(r.tekst, /Tests: 1 failed, 399 passed/)
  assert.match(r.tekst, /regels weggelaten/)
})

test('grote JSON wordt een skelet', () => {
  const data = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, naam: `item ${i}`, tags: ['a', 'b'] })), totaal: 500 }
  const r = inkorten(JSON.stringify(data), { drempel: 1000 })
  assert.equal(r.ingekort, true)
  // Drie lagen diep: dieper staat alleen het aantal.
  assert.match(r.tekst, /items: \[500× \{ id: 0, naam: "item 0", tags: \[… 2 items\] \}\]/)
  assert.match(r.tekst, /totaal: 500/)
  assert.equal(jsonSkelet([]), '[]')
})

test('levert inkorten bijna niets op, dan blijft het origineel', () => {
  const uniek = Array.from({ length: 50 }, (_, i) => `regel ${'abcdefghij'[i % 10]}${'klmnopqrst'[(i * 3) % 10]} error ${'uvwxyz'[i % 6]}`).join('\n')
  const r = inkorten(uniek, { drempel: 100 })
  assert.equal(r.ingekort, false)
  assert.equal(r.tekst, uniek)
})

test('voetregel noemt het pad van het origineel', () => {
  assert.match(voetregel('/tmp/x/1.txt', 9000, 1200), /Volledige uitvoer: \/tmp\/x\/1\.txt/)
})

// ---------- bestand ----------

test('welke bestanden mogen', () => {
  assert.equal(weigerReden('/p/CLAUDE.md'), null)
  assert.equal(weigerReden('/p/todo.txt'), null)
  assert.match(weigerReden('/p/app.ts'), /alleen/)
  assert.match(weigerReden('/p/.env'), /alleen|geheimen/)
  assert.match(weigerReden('/p/secrets.md'), /geheimen/)
  assert.match(weigerReden('/p/CLAUDE.original.md'), /backup/)
  assert.match(weigerReden('/Companies/GIMC/vault/strategie/plan.md'), /vault/)
})

const ORIGINEEL = `---
name: x
---
# Project

Je moet er altijd voor zorgen dat je eerst de tests draait voordat je pusht naar \`main\`.

## Commando's

\`\`\`bash
pnpm test   # alle tests
\`\`\`

Zie https://example.com/docs voor meer.
`

test('controle: goede inkorting komt erdoor', () => {
  const kort = ORIGINEEL.replace('Je moet er altijd voor zorgen dat je eerst de tests draait voordat je pusht naar', 'Tests draaien vóór push naar').replace('voor meer.', '.')
  assert.deepEqual(controleer(ORIGINEEL, kort), { ok: true, fouten: [] })
})

test('controle: weggevallen code, kop of URL wordt geweigerd', () => {
  const zonderCode = ORIGINEEL.replace('pnpm test   # alle tests', 'pnpm test')
  assert.equal(controleer(ORIGINEEL, zonderCode).ok, false)
  const zonderKop = ORIGINEEL.replace("## Commando's\n", '')
  assert.match(controleer(ORIGINEEL, zonderKop).fouten.join(), /koppen/)
  const zonderUrl = ORIGINEEL.replace('https://example.com/docs', 'de docs')
  assert.match(controleer(ORIGINEEL, zonderUrl).fouten.join(), /URL/)
  const zonderInline = ORIGINEEL.replace('`main`', 'main')
  assert.match(controleer(ORIGINEEL, zonderInline).fouten.join(), /inline code/)
  assert.match(controleer(ORIGINEEL, ORIGINEEL + 'extra').fouten.join(), /niet korter/)
})

test('antwoord van het model: omringend codeblok gaat weg', () => {
  assert.equal(uitAntwoord('```markdown\n# A\ntekst\n```'), '# A\ntekst\n')
  assert.equal(uitAntwoord('# A'), '# A\n')
})

test('diff toont weggehaalde en nieuwe regels', () => {
  assert.equal(diff('a\nb\n', 'a\nc\n'), '- b\n+ c')
})
