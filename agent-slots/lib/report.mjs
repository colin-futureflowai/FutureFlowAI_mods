// Het bericht waarmee de mod een klaar rapport van een cloud-worker in de sessie zet.
// Puur JavaScript: gebruikt door de hooks-module en de tests.

export function reportMessage(job) {
  return [
    `[agent-slots] Cloud-worker klaar: ${job.branch} (basis ${job.base}, rapportcommit ${job.commit ?? '?'}).`,
    job.task ? `Taak: ${job.task}` : '',
    '',
    'Rapport van de worker:',
    job.report ?? '(leeg)',
    '',
    `Volgende stap (skill cloud-overflow): \`git fetch origin\`, lees \`git diff origin/${job.base}...origin/${job.branch}\` zelf na, draai de tests lokaal als er een slot vrij is, en vertel de gebruiker wat er gedaan is en wat open staat. Mergen of een PR maken pas na akkoord van de gebruiker.`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}
