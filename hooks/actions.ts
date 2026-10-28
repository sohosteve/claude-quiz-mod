// What the pane's buttons and the session's events do to the quiz state.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Activity, Card, QuizSet, Score, Screen, SetInfo } from '../types'
import { loadIndex, loadScore, loadSet, saveScore } from './bank'
import { EMPTY_SCORE, nextCard, scoreAnswer } from './quiz'

export const PANE = 'quiz'
export const TITLE = 'Quiz'

// A ticker left running past this (a turn whose completion never arrived) stops itself.
const MAX_BUSY_MS = 6 * 60 * 60 * 1000
// How long a wait must last before the pane opens unasked, so quick replies never flash it.
const OPEN_AFTER_MS = 10 * 1000
// How long an auto-opened pane stays once the wait ends, so a turn that hands
// straight on to a background agent does not close and reopen it.
const CLOSE_AFTER_MS = 3 * 1000
const NARROW_HINT = 'Claude is working. /quiz to study while you wait'

export const activity = atom({ plugin: 'quiz-pane', key: 'activity' } as const, {
  isBusy: false,
  startedAt: 0,
  now: 0,
  tool: null,
  agents: 0,
  idleAt: 0,
  isOffered: false,
} as Activity)
export const screen = atom({ plugin: 'quiz-pane', key: 'screen' } as const, { kind: 'menu', error: null } as Screen)
export const sets = atom({ plugin: 'quiz-pane', key: 'sets' } as const, [] as SetInfo[])
export const set = atom({ plugin: 'quiz-pane', key: 'set' } as const, null as QuizSet | null)
export const score = atom({ plugin: 'quiz-pane', key: 'score' } as const, EMPTY_SCORE as Score)
export const card = atom({ plugin: 'quiz-pane', key: 'card' } as const, null as Card | null)
export const counter = atom({ plugin: 'quiz-pane', key: 'counter' } as const, 0)
export const dismissed = atom({ plugin: 'quiz-pane', key: 'dismissed' } as const, false)
// The pane on screen is one this plugin opened unasked, so it is this plugin's to close.
export const autoOpened = atom({ plugin: 'quiz-pane', key: 'autoOpened' } as const, false)
// The narrow-terminal toast was shown this session.
export const hinted = atom({ plugin: 'quiz-pane', key: 'hinted' } as const, false)
export const loadToken = atom({ plugin: 'quiz-pane', key: 'loadToken' } as const, 0)

const toMenu = (error: string | null): Screen => ({ kind: 'menu', error })

export async function refresh($: EngineInterface, source: string): Promise<void> {
  const loaded = await loadIndex($, source)
  if (loaded.ok) {
    await update($, sets, () => loaded.value)
    await update($, screen, s => (s.kind === 'menu' ? toMenu(loaded.isCached ? 'Offline: showing cached sets.' : null) : s))
  } else {
    await update($, screen, s => (s.kind === 'menu' ? toMenu(`Could not load sets: ${loaded.error}`) : s))
  }
}

// Deals a new card only when `afterId` is still the card shown (or none is) and it
// was answered, so a stale or repeated Next press does nothing.
export async function deal($: EngineInterface, afterId: string | null): Promise<void> {
  const current = await read($, set)
  if (!current) return
  const currentScore = await read($, score)
  const n = await update($, counter, c => c + 1)
  const dealt = nextCard(current, currentScore, n - 1, afterId, Math.random)
  await update($, card, c => {
    const isFresh = c === null || (c.questionId === afterId && c.picked !== null)
    return isFresh ? dealt : c
  })
}

export async function showMenu($: EngineInterface): Promise<void> {
  await update($, loadToken, t => t + 1)
  await update($, screen, () => toMenu(null))
}

export async function choose($: EngineInterface, source: string, slug: string): Promise<void> {
  const token = await update($, loadToken, t => t + 1)
  const isStale = async () => (await read($, loadToken)) !== token
  if ((await read($, sets)).length === 0) await refresh($, source)
  const info = (await read($, sets)).find(s => s.slug === slug)
  if (!info) {
    await update($, screen, () => toMenu(`No quiz set named "${slug}".`))
    return
  }
  await update($, screen, () => ({ kind: 'loading', slug }) as Screen)
  const loaded = await loadSet($, source, info)
  if (await isStale()) return
  if (!loaded.ok) {
    await update($, screen, () => toMenu(`Could not load ${info.subject}: ${loaded.error}`))
    return
  }
  const saved = await loadScore($, slug)
  if (await isStale()) return
  const before = await read($, set)
  await update($, set, () => loaded.value)
  await update($, score, () => saved)
  if (before?.slug !== slug) await update($, card, () => null)
  if (!(await read($, card))) await deal($, null)
  await update($, screen, () => ({ kind: 'card', slug }) as Screen)
}

// Scores at most once per card: the card write is the compare-and-set, and
// only the call that flipped `picked` from null goes on to score.
export async function pick($: EngineInterface, questionId: string, choice: number): Promise<void> {
  const current = await read($, set)
  const q = current?.questions.find(x => x.id === questionId)
  if (!current || !q) return
  let isWinner = false
  await update($, card, c => {
    isWinner = c !== null && c.questionId === questionId && c.picked === null
    return isWinner && c ? { ...c, picked: choice } : c
  })
  if (!isWinner) return
  const scored = await update($, score, s => scoreAnswer(s, q.id, choice === q.answer_index))
  await saveScore($, current.slug, scored)
}

export async function runningAgents($: EngineInterface): Promise<number> {
  return (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending').length
}

// One beat of the wait ticker. Claude is waited on while its turn runs or any
// agent it started is still running. Resolves false once the ticker should stop:
// the wait is over and no auto-opened pane is left to close.
export async function tick($: EngineInterface, isAutoOpen: boolean): Promise<boolean> {
  const now = await $.clock.now()
  const agents = await runningAgents($)
  // Derived inside the updater from the value it is handed, so a turn that
  // started or ended while this beat awaited is never written over. A wait
  // past MAX_BUSY_MS (a lost completion, an agent stuck pending) ends itself.
  const after = await update($, activity, a => {
    const isFresh = now - a.startedAt <= MAX_BUSY_MS
    const isBusy = a.isBusy && isFresh
    const isWaiting = isBusy || (agents > 0 && isFresh)
    const idleAt = isWaiting ? 0 : a.idleAt || now
    const isSameSecond = Math.floor(now / 1000) === Math.floor(a.now / 1000)
    const isSame = isSameSecond && agents === a.agents && isBusy === a.isBusy && idleAt === a.idleAt
    return isSame ? a : { ...a, now, agents, isBusy, idleAt, tool: isBusy ? a.tool : null }
  })
  if (after.idleAt === 0) {
    if (isAutoOpen && now - after.startedAt >= OPEN_AFTER_MS) await offerPane($)
    return true
  }
  $.ui.status(undefined)
  return retirePane($, now - after.idleAt)
}

// Opens the pane unasked, once per wait, unless the person closed it or has it open.
async function offerPane($: EngineInterface): Promise<void> {
  if ((await read($, activity)).isOffered) return
  await update($, activity, a => ({ ...a, isOffered: true }))
  if (await read($, dismissed)) return
  if ((await $.ui.panes()).some(p => p.id === PANE)) return
  await update($, autoOpened, () => true)
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  if (opened.isPlaced) return
  $.ui.status(NARROW_HINT)
  if (await read($, hinted)) return
  await update($, hinted, () => true)
  $.ui.toast(`${NARROW_HINT} (the pane opens on its own from 110 columns once you have used /quiz)`, { timeoutMs: 8000 })
}

// Closes the pane this plugin opened, once the wait has been over for
// CLOSE_AFTER_MS and the person is not using it. Resolves whether to keep ticking.
async function retirePane($: EngineInterface, idleForMs: number): Promise<boolean> {
  if (!(await read($, autoOpened))) return false
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (!pane) {
    await update($, autoOpened, () => false)
    return false
  }
  if (pane.isFocused || idleForMs < CLOSE_AFTER_MS) return true
  await $.ui.close({ id: PANE })
  await update($, autoOpened, () => false)
  return false
}

export async function markBusy($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, activity, a => {
    const isNewWait = !a.isBusy && a.idleAt !== 0
    return { ...a, isBusy: true, startedAt: now, now, tool: null, idleAt: 0, isOffered: isNewWait ? false : a.isOffered }
  })
}

export async function markTool($: EngineInterface, tool: string): Promise<void> {
  const before = await read($, activity)
  if (before.isBusy && before.tool !== tool) await update($, activity, a => (a.isBusy ? { ...a, tool } : a))
}

export async function markIdle($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const agents = await runningAgents($)
  await update($, activity, a => ({ ...a, isBusy: false, now, tool: null, agents, idleAt: agents > 0 ? 0 : now }))
}

// The person took the pane over (opened it with /quiz, or closed it by hand):
// it is no longer this plugin's to close.
export async function releasePane($: EngineInterface): Promise<void> {
  await update($, autoOpened, () => false)
}

// Set when the person closes the pane, so it stops reopening on each wait; /quiz clears it.
export async function setDismissed($: EngineInterface, value: boolean): Promise<void> {
  await update($, dismissed, () => value)
}

export async function readView($: EngineInterface) {
  return {
    activity: await read($, activity),
    screen: await read($, screen),
    sets: await read($, sets),
    set: await read($, set),
    score: await read($, score),
    card: await read($, card),
  }
}
