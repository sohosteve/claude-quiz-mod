import { expect, mock, test } from 'claude-code/testing'
import type { On, UiPane, UiOpenResult } from 'claude-code'

type World = {
  opens: { focus?: boolean }[]
  closes: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  panes: UiPane[]
  agents: { status: 'running' | 'completed' }[]
}

// Stands in for the engine beneath the plugin: panes, agents, status and toasts.
function world(on: On, placed = true): World {
  const w: World = { opens: [], closes: [], toasts: [], statuses: [], panes: [], agents: [] }
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', () => ({ cwd: '' }))
  on('agent.list', () => ({
    value: w.agents.map((a, i) => ({ id: `a${i}`, description: 'task', type: 'Explore', status: a.status })),
  }))
  on('ui.open', ($, e): { value: UiOpenResult } => {
    w.opens.push({ focus: e.focus })
    w.panes = [{ id: e.id, title: e.title ?? e.id, isShown: placed, isFocused: false, isPlaced: placed }]
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'needs 144 columns, have 120' } }
  })
  on('ui.close', ($, e) => {
    w.closes.push(e.origin.kind)
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: w.panes }))
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

const START = { text: 'do the thing', turnId: 't1' }
const DONE = { answer: 'done', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a quick reply never opens the pane', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.turn.start(START)
  await clock.advance(4000)
  await $.turn.complete(DONE)
  await clock.advance(20000)
  expect(w.opens.length).toBe(0)
})

test('a long turn opens the pane unfocused, then closes it once Claude is done', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.turn.start(START)
  await clock.advance(9000)
  expect(w.opens.length).toBe(0)
  await clock.advance(2000)
  expect(w.opens).toEqual([{ focus: undefined }])
  await clock.advance(30000)
  expect(w.opens.length).toBe(1)

  await $.turn.complete(DONE)
  await clock.advance(1000)
  expect(w.closes.length).toBe(0)
  await clock.advance(4000)
  expect(w.closes).toEqual(['plugin'])
})

test('stays up while background agents run after the turn ends', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  w.agents = [{ status: 'running' }, { status: 'running' }]
  await $.turn.start(START)
  await clock.advance(2000)
  await $.turn.complete(DONE)
  await clock.advance(12000)
  expect(w.opens.length).toBe(1)
  await clock.advance(60000)
  expect(w.closes.length).toBe(0)

  w.agents = [{ status: 'completed' }, { status: 'completed' }]
  await clock.advance(5000)
  expect(w.closes).toEqual(['plugin'])
})

test('a pane the person is using is not closed under them', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.turn.start(START)
  await clock.advance(11000)
  w.panes = w.panes.map(p => ({ ...p, isFocused: true }))
  await $.turn.complete(DONE)
  await clock.advance(10000)
  expect(w.closes.length).toBe(0)
  w.panes = w.panes.map(p => ({ ...p, isFocused: false }))
  await clock.advance(2000)
  expect(w.closes).toEqual(['plugin'])
})

test('a pane opened with /quiz belongs to the person and is never auto-closed', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  on('command.run', () => ({ text: '' }))
  await $.turn.start(START)
  await clock.advance(11000)
  await $.command.run({
    command: 'quiz',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  await $.turn.complete(DONE)
  await clock.advance(20000)
  expect(w.opens.length).toBe(2)
  expect(w.opens[1]).toEqual({ focus: true })
  expect(w.closes.length).toBe(0)
})

test('a terminal too narrow for the pane gets one toast and a status hint', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, false)
  for (const turnId of ['t1', 't2']) {
    await $.turn.start({ ...START, turnId })
    await clock.advance(11000)
    await $.turn.complete({ ...DONE, turnId })
    await clock.advance(5000)
  }
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toMatch(/\/quiz/)
  expect(w.statuses).toContain('Claude is working. /quiz to study while you wait')
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('autoOpen off never opens the pane', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  await $.turn.start(START)
  await clock.advance(30000)
  expect(w.opens.length).toBe(0)
})
