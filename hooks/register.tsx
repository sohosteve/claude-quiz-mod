// quiz-pane: a flash-card quiz in a side pane while Claude works. The pane's
// header tracks Claude's turn, current tool and running agents, so progress
// stays visible next to the transcript while the person studies.
//
// The pane comes up on its own only once a wait runs long (a turn, or agents
// still running after it), and the pane it opened goes away when the wait ends.
//
// Bookkeeping never sits in Claude's way: the tool.call hook hands on at once,
// and every failure here is swallowed rather than allowed to stall a turn.
import type { Register } from 'claude-code'

import { PANE, TITLE, choose, markBusy, markIdle, markTool, readView, refresh, releasePane, setDismissed, tick } from './actions'
import { drawPane } from './view'

const TICK_MS = 1000
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/sohosteve/quiz-sets/main'

export const register: Register = (on, options) => {
  const source = String(options.source || DEFAULT_SOURCE)
  const isAutoOpen = options.autoOpen !== false
  let ticker: { cancel: () => void } | null = null
  let generation = 0
  let isTicking = false

  const stopTicker = () => {
    ticker?.cancel()
    ticker = null
    generation += 1
  }

  // Each beat skips while the last is still running, and the ticker stops
  // itself once tick says the wait is over and nothing is left to close. A
  // beat that outlived its ticker (a turn hook restarted it meanwhile) stops nothing.
  const onBeat = (beat: () => Promise<boolean>) => {
    const own = generation
    return () => {
      if (isTicking) return
      isTicking = true
      void beat()
        .then(isWaiting => {
          if (!isWaiting && own === generation) stopTicker()
        })
        .catch(() => undefined)
        .finally(() => {
          isTicking = false
        })
    }
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'quiz',
      description: 'Open the flash-card quiz pane (optionally: /quiz <set-slug>)',
      argumentHint: '[set-slug]',
    })
    void refresh($, source).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopTicker()
    return next(e)
  })

  on('command.run', { command: 'quiz' }, async ($, e) => {
    const slug = e.args.trim().toLowerCase()
    await setDismissed($, false)
    await releasePane($)
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (slug) await choose($, source, slug)
    return { text: opened.isPlaced ? 'Quiz pane opened.' : `Quiz pane is waiting for room (${opened.reason}).` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await setDismissed($, true).catch(() => undefined)
      await releasePane($).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    try {
      await markBusy($)
      stopTicker()
      ticker = $.clock.every(TICK_MS, onBeat(() => tick($, isAutoOpen)))
    } catch {
      // The quiz is optional; a turn must never wait on it.
    }
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) void markTool($, String(e.tool)).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        await markIdle($)
        // A fresh ticker carries on past the turn: agents may still be
        // running, and it closes an auto-opened pane once the wait is over.
        stopTicker()
        ticker = $.clock.every(TICK_MS, onBeat(() => tick($, isAutoOpen)))
      } catch {
        // As at turn.start: never hold the turn up.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return drawPane($, e, await readView($), source)
  })
}
