import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'indicateurs',
  component: 'Pane',
  requestId: 'indicateurs',
  props: {
    title: 'Indicateurs',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
} as const

const breakdown = {
  categories: [
    { name: 'Messages', tokens: 700000, color: 'x', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 900000, color: 'x', isDeferred: true, kind: 'deferred' },
  ],
  totalTokens: 800000, maxTokens: 1000000, rawMaxTokens: 1000000, autocompactSource: 'auto',
  percentage: 80, gridRows: [], model: 'm', memoryFiles: [{ path: '/a', type: 'Project', tokens: 1 }],
  mcpTools: [], agents: [], skills: { totalSkills: 12, includedSkills: 12, tokens: 1, skillFrontmatter: [] },
}

test('80 % : alerte, limites, bouton Compacter qui compacte', async ($, on) => {
  let compacted = 0
  let pct = 80
  on('command.register', () => ({ value: { command: 'indicateurs' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { window: 1000000, tokens: pct * 10000, percent: pct, breakdown },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-10T05:00:00Z' }],
    cost: { usd: 1.5 },
  } }))
  on('clock.now', () => ({ value: 600000 }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.turns', () => ({ value: 3 }))
  on('env.get', () => ({ value: 'cloud_default' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.compact', () => { compacted += 1; pct = 20; return { messages: [{ role: 'user', text: 'résumé', toolUses: [] }] } })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))

  for (const surface of ['desktop', 'mobile', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /% utilisé/ }))?.text).toContain('80 % utilisé')
    expect(await ui.find({ type: 'Text', text: /bientôt plein/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Limite 5 h : 42/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Skills 12/ })).toBeTruthy()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'compact' })
  await new Promise(r => setTimeout(r, 50))
  expect(compacted).toBe(1)
  expect((await ui.find({ type: 'Text', text: /% utilisé/ }))?.text).toContain('20 % utilisé')
  expect(await ui.find({ type: 'Text', text: /bientôt plein/ })).toBeFalsy()
  await ui.unmount()
})
