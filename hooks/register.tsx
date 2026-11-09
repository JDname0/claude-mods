import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Changes, Connector, Place, Usage } from '../types'

const PANE = 'indicateurs'
const TITLE = 'Indicateurs'

const usage = atom({ plugin: 'indicateurs', key: 'usage' } as const, null, { shape: 'usage-2' })
const place = atom({ plugin: 'indicateurs', key: 'place' } as const, null, { shape: 'place-2' })
const changes = atom({ plugin: 'indicateurs', key: 'changes' } as const, null, { shape: 'changes-2' })
const connectors = atom({ plugin: 'indicateurs', key: 'connectors' } as const, null)
const isChecking = atom({ plugin: 'indicateurs', key: 'isChecking' } as const, false)
const emptyActivity: Activity = { calls: 0, byTool: {}, outputs: [] }
const activity = atom({ plugin: 'indicateurs', key: 'activity' } as const, emptyActivity)

const WRITERS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])

const fmt = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n)

const pctOf = (n: number, w: number): string => `${((n / w) * 100).toFixed(1)} %`

const LIMIT_LABEL: Record<string, string> = {
  five_hour: 'Limite 5 h',
  seven_day: 'Limite 7 jours',
  seven_day_opus: 'Limite 7 jours (Opus)',
}

const ENV_LABEL: Record<string, string> = {
  terminal: 'terminal',
  desktop: 'app desktop',
  mobile: 'mobile',
  vscode: 'VS Code',
}

function duration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

function short(path: string, cwd: string): string {
  return path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path
}

async function refreshUsage($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  const next: Usage = {
    tokens: u.context.tokens ?? null,
    window: u.context.window,
    percent: u.context.percent ?? null,
    costUsd: u.cost?.usd ?? null,
    categories: (b?.categories ?? [])
      .filter(c => c.tokens > 0)
      .map(c => ({ name: c.name, tokens: c.tokens, isDeferred: c.isDeferred }))
      .sort((x, y) => Number(x.isDeferred) - Number(y.isDeferred) || y.tokens - x.tokens),
    mcpTools: b?.mcpTools.length ?? 0,
    memoryFiles: b?.memoryFiles.length ?? 0,
    agents: b?.agents.length ?? 0,
    skills: b?.skills?.totalSkills ?? 0,
    limits: u.rateLimits.map(r => ({
      kind: r.kind,
      percent: r.percentUsed,
      resetsAt: r.resetsAt ?? null,
    })),
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
    repo: repo ? (repo.name ?? repo.remote?.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '') ?? repo.root) : null,
    envType: (await $.env.get('CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE')) ?? null,
    model: await $.session.model(),
    surfaces: [...(await $.session.surfaces())],
    turns: await $.session.turns(),
    startedAt: (await $.session.usage()).startedAt,
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
  const ahead = Number((await git($, ['rev-list', '--count', '@{upstream}..HEAD'])) ?? 0) || 0
  const lastCommit = await git($, ['log', '-1', '--format=%h %s (%cr)'])
  const c: Changes = { files: list.length, added, removed, list: list.slice(0, 8), ahead, lastCommit }
  await update($, changes, () => c)
}

function parseMcp(out: string): Connector[] {
  const list: Connector[] = []
  for (const line of out.split('\n')) {
    const m = /^(.+?): .* - (.+)$/.exec(line)
    if (!m) continue
    const name = (m[1] ?? '').replace(/^plugin:[^:]+:/, '').replace(/^claude\.ai /, '')
    const s = m[2] ?? ''
    const status: Connector['status'] = s.includes('Connected')
      ? 'ok'
      : /auth/i.test(s)
        ? 'auth'
        : /Not configured/i.test(s)
          ? 'off'
          : 'fail'
    if (!list.some(c => c.name === name)) list.push({ name, status })
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
    // keep the previous reading
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
      description: 'Ouvre le panneau Indicateurs (contexte, limites, connecteurs, modifications)',
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

  on('tool.call', async ($, e, next) => {
    const input = (e as { input?: Record<string, unknown> }).input ?? {}
    const file = WRITERS.has(e.tool)
      ? String(input['file_path'] ?? input['notebook_path'] ?? '')
      : ''
    await update($, activity, a => ({
      calls: a.calls + 1,
      byTool: { ...a.byTool, [e.tool]: (a.byTool[e.tool] ?? 0) + 1 },
      outputs: file && !a.outputs.includes(file) ? [...a.outputs, file].slice(-30) : a.outputs,
    }))
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
    const act = await read($, activity)
    const checking = await read($, isChecking)
    const now = await $.clock.now()

    const pct = u?.percent ?? null
    const barWidth = 20
    const filled = pct === null ? 0 : Math.round((pct / 100) * barWidth)
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)
    const tone = (v: number) => (v >= 85 ? 'error' : v >= 60 ? 'warning' : 'success')

    const ok = k?.list.filter(x => x.status === 'ok') ?? []
    const auth = k?.list.filter(x => x.status === 'auth') ?? []
    const fail = k?.list.filter(x => x.status === 'fail') ?? []
    const topTools = Object.entries(act.byTool).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const remote = p?.surfaces.filter(s => s !== 'terminal') ?? []

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Environnement</Text>
          {p === null ? (
            <Text dimColor>Lecture…</Text>
          ) : (
            <Box flexDirection="column">
              <Text>☁ {p.envType ? `Cloud (${p.envType})` : 'Local (cet ordinateur)'}</Text>
              <Text>📁 {p.cwd}</Text>
              <Text>⎇ {p.branch ?? 'pas de dépôt git'}{p.repo ? ` · ${p.repo}` : ''}</Text>
              <Text>📡 {remote.length > 0 ? `Suivi depuis : ${remote.map(s => ENV_LABEL[s] ?? s).join(', ')}` : 'Remote Control : aucun appareil'}</Text>
              <Text dimColor>
                {p.model} · {p.turns} messages · {duration(now - p.startedAt)}
              </Text>
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
              <Text color={tone(pct)}>{bar}</Text>
              {u.categories.map(cat => (
                <Text key={cat.name} dimColor={cat.isDeferred}>
                  {cat.name}{cat.isDeferred ? ' (différé)' : ''} : {fmt(cat.tokens)}
                  {cat.isDeferred ? '' : ` · ${pctOf(cat.tokens, u.window)}`}
                </Text>
              ))}
              <Text dimColor>
                Outils MCP {u.mcpTools} · Fichiers mémoire {u.memoryFiles} · Agents {u.agents} · Skills {u.skills}
              </Text>
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Limites d'usage</Text>
          {u === null || u.limits.length === 0 ? (
            <Text dimColor>Pas encore de mesure.</Text>
          ) : (
            u.limits.map(l => (
              <Text key={l.kind} color={tone(l.percent)}>
                {LIMIT_LABEL[l.kind] ?? l.kind} : {l.percent} %
                {l.resetsAt ? ` · reset ${l.resetsAt.slice(5, 16).replace('T', ' ')}` : ''}
              </Text>
            ))
          )}
          {u?.costUsd != null && <Text dimColor>Coût de la session : {u.costUsd.toFixed(2)} $</Text>}
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
              {ok.slice(0, 12).map(x => (
                <Text key={`ok-${x.name}`} color="success">✓ {x.name}</Text>
              ))}
              {auth.slice(0, 8).map(x => (
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
          <Text bold>Activité de la session</Text>
          {act.calls === 0 ? (
            <Text dimColor>Aucun outil utilisé pour l'instant.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>{act.calls} actions</Text>
              {topTools.map(([tool, n]) => (
                <Text key={tool} dimColor>{tool.replace(/^mcp__/, '').replace(/__/g, ' › ')} : {n}</Text>
              ))}
            </Box>
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Résultats</Text>
          {act.outputs.length === 0 ? (
            <Text dimColor>Aucun fichier créé ou modifié par Claude.</Text>
          ) : (
            act.outputs.slice(-10).map(f => (
              <Text key={f}>📄 {p ? short(f, p.cwd) : f}</Text>
            ))
          )}
        </Box>

        <Box flexDirection="column">
          <Text bold>Modifications</Text>
          {c === null ? (
            <Text dimColor>Aucun dépôt git ouvert.</Text>
          ) : (
            <Box flexDirection="column">
              {c.files === 0 ? (
                <Text dimColor>Aucune modification en cours.</Text>
              ) : (
                <Text>
                  {c.files} fichiers · <Text color="success">+{c.added}</Text>{' '}
                  <Text color="error">−{c.removed}</Text>
                </Text>
              )}
              {c.list.map(f => (
                <Text key={f} dimColor>{f}</Text>
              ))}
              {c.ahead > 0 && <Text color="warning">↑ {c.ahead} commit(s) pas encore poussé(s)</Text>}
              {c.lastCommit && <Text dimColor>Dernier commit : {c.lastCommit}</Text>}
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
