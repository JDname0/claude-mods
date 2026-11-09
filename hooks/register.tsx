import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Changes, Connector, Place, Usage } from '../types'

const PANE = 'indicateurs'
const TITLE = 'Indicateurs'

const usage = atom({ plugin: 'indicateurs', key: 'usage' } as const, null)
const place = atom({ plugin: 'indicateurs', key: 'place' } as const, null)
const changes = atom({ plugin: 'indicateurs', key: 'changes' } as const, null)
const connectors = atom({ plugin: 'indicateurs', key: 'connectors' } as const, null)
const isChecking = atom({ plugin: 'indicateurs', key: 'isChecking' } as const, false)

const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)

async function refreshUsage($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' })
  const cats = (u.context.breakdown?.categories ?? [])
    .filter(c => c.tokens > 0 && !c.isDeferred)
    .map(c => ({ name: c.name, tokens: c.tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  const next: Usage = {
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    percent: u.context.percent ?? null,
    costUsd: u.cost?.usd ?? null,
    categories: cats,
  }
  await update($, usage, () => next)
}

async function git($: EngineInterface, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { timeoutMs: 10000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

async function refreshPlace($: EngineInterface): Promise<void> {
  const repo = await $.session.repo()
  const next: Place = {
    cwd: await $.session.cwd(),
    branch: repo ? await git($, ['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    repo: repo ? (repo.name ?? repo.remote ?? repo.root) : null,
    envType: (await $.env.get('CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE')) ?? null,
    model: await $.session.model(),
  }
  await update($, place, () => next)

  if (!repo) {
    await update($, changes, () => null)
    return
  }
  const status = (await git($, ['status', '--porcelain'])) ?? ''
  const list = status.split('\n').filter(Boolean).map(l => l.slice(3))
  const numstat = (await git($, ['diff', 'HEAD', '--numstat'])) ?? ''
  let added = 0
  let removed = 0
  for (const line of numstat.split('\n')) {
    const [a, r] = line.split('\t')
    added += Number(a) || 0
    removed += Number(r) || 0
  }
  const c: Changes = { files: list.length, added, removed, list: list.slice(0, 8) }
  await update($, changes, () => c)
}

function parseMcp(out: string): Connector[] {
  const list: Connector[] = []
  for (const line of out.split('\n')) {
    const m = /^(.+?): .* - (.+)$/.exec(line)
    if (!m) continue
    const raw = (m[1] ?? '').replace(/^plugin:[^:]+:/, '').replace(/^claude\.ai /, '')
    const s = m[2] ?? ''
    const status: Connector['status'] = s.includes('Connected')
      ? 'ok'
      : /auth/i.test(s)
        ? 'auth'
        : /Not configured/i.test(s)
          ? 'off'
          : 'fail'
    if (!list.some(c => c.name === raw && c.status === status)) {
      list.push({ name: raw, status })
    }
  }
  return list
}

async function refreshConnectors($: EngineInterface): Promise<void> {
  if (await read($, isChecking)) return
  await update($, isChecking, () => true)
  try {
    const r = await $.process.run(['claude', 'mcp', 'list'], { timeoutMs: 120000 })
    const list = parseMcp(r.stdout)
    const checkedAt = await $.clock.now()
    await update($, connectors, () => ({ checkedAt, list }))
  } catch {
    // leave the previous reading
  } finally {
    await update($, isChecking, () => false)
  }
}

async function refreshAll($: EngineInterface, withConnectors: boolean): Promise<void> {
  await Promise.all([
    refreshUsage($).catch(() => undefined),
    refreshPlace($).catch(() => undefined),
    withConnectors ? refreshConnectors($) : Promise.resolve(),
  ])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'indicateurs',
      description: 'Ouvre le panneau Indicateurs (contexte, environnement, connecteurs, modifications)',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    void refreshAll($, true)

    return started
  })

  on('command.run', { command: 'indicateurs' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void refreshAll($, true)

    return { text: 'Panneau Indicateurs ouvert.' }
  })

  on('session.measure', async ($, e, next) => {
    void refreshUsage($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) void refreshPlace($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const u = await read($, usage)
    const p = await read($, place)
    const c = await read($, changes)
    const k = await read($, connectors)
    const checking = await read($, isChecking)

    const pct = u?.percent ?? null
    const barWidth = 20
    const filled = pct === null ? 0 : Math.round((pct / 100) * barWidth)
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

    const ok = k?.list.filter(x => x.status === 'ok') ?? []
    const auth = k?.list.filter(x => x.status === 'auth') ?? []
    const fail = k?.list.filter(x => x.status === 'fail') ?? []

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Environnement</Text>
          {p === null ? (
            <Text dimColor>Lecture…</Text>
          ) : (
            <Box flexDirection="column">
              <Text>☁ {p.envType ? `Cloud (${p.envType})` : 'Local'}</Text>
              <Text>📁 {p.cwd}</Text>
              <Text>⎇ {p.branch ?? 'pas de dépôt git'}{p.repo ? ` · ${p.repo}` : ''}</Text>
              <Text dimColor>Modèle : {p.model}</Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Contexte</Text>
          {u === null || pct === null ? (
            <Text dimColor>Disponible après la première réponse.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{pct} % utilisé · {fmt(u.tokens ?? 0)} / {fmt(u.window)}</Text>
              <Text color={pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success'}>{bar}</Text>
              {u.categories.slice(0, 8).map(cat => (
                <Text key={cat.name} dimColor>
                  {cat.name} : {fmt(cat.tokens)} ({((cat.tokens / u.window) * 100).toFixed(1)} %)
                </Text>
              ))}
              {u.costUsd !== null && <Text dimColor>Coût session : {u.costUsd.toFixed(2)} $</Text>}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Connecteurs</Text>
          {k === null ? (
            <Text dimColor>{checking ? 'Vérification…' : 'Pas encore vérifiés.'}</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                ✓ {ok.length} connectés · ⚠ {auth.length} à connecter · ✗ {fail.length} bloqués
              </Text>
              {ok.slice(0, 10).map(x => (
                <Text key={`ok-${x.name}`} color="success">✓ {x.name}</Text>
              ))}
              {auth.slice(0, 6).map(x => (
                <Text key={`auth-${x.name}`} color="warning">⚠ {x.name} — se connecter</Text>
              ))}
              {fail.slice(0, 4).map(x => (
                <Text key={`fail-${x.name}`} dimColor>✗ {x.name}</Text>
              ))}
              {fail.length > 4 && <Text dimColor>… et {fail.length - 4} autres bloqués par le réseau</Text>}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Modifications</Text>
          {c === null ? (
            <Text dimColor>Aucun dépôt git ouvert.</Text>
          ) : c.files === 0 ? (
            <Text dimColor>Aucune modification.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                {c.files} fichiers · <Text color="success">+{c.added}</Text>{' '}
                <Text color="error">−{c.removed}</Text>
              </Text>
              {c.list.map(f => (
                <Text key={f} dimColor>{f}</Text>
              ))}
            </Box>
          )}
        </Box>

        <Button
          key="refresh"
          label={checking ? 'Actualisation…' : 'Actualiser'}
          onPress={() => refreshAll($, true)}
        />
      </Box>
    )
  })
}
