// quiz-pane: a flash-card quiz in a side pane while Claude works. The pane's
// header tracks Claude's turn, current tool and running agents, so progress
// stays visible next to the transcript while the person studies.
//
// Bookkeeping never sits in Claude's way: the tool.call hook hands on at once,
// and every failure here is swallowed rather than allowed to stall a turn.
import type { Register } from 'claude-code'

import { choose, isDismissed, markBusy, markIdle, markTool, readView, refresh, setDismissed, tick } from './actions'
import { drawPane } from './view'

const PANE = 'quiz'
const TITLE = 'Quiz'
const TICK_MS = 1000
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/sohosteve/quiz-sets/main'

export const register: Register = (on, options) => {
  const source = String(options.source || DEFAULT_SOURCE)
  const isAutoOpen = options.autoOpen !== false
  let ticker: { cancel: () => void } | null = null
  let isTicking = false

  const stopTicker = () => {
    ticker?.cancel()
    ticker = null
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
    const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
    if (slug) await choose($, source, slug)
    return { text: opened.isPlaced ? 'Quiz pane opened.' : `Quiz pane is waiting for room (${opened.reason}).` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await setDismissed($, true).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    try {
      await markBusy($)
      stopTicker()
      ticker = $.clock.every(TICK_MS, () => {
        if (isTicking) return
        isTicking = true
        void tick($)
          .then(isBusy => {
            if (!isBusy) stopTicker()
          })
          .catch(() => undefined)
          .finally(() => {
            isTicking = false
          })
      })
      const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
      if (isAutoOpen && !isOpen && !(await isDismissed($))) {
        const opened = await $.ui.open({ id: PANE, title: TITLE })
        if (!opened.isPlaced) $.ui.status('Claude is working. /quiz to study while you wait')
      }
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
      stopTicker()
      await markIdle($).catch(() => undefined)
      $.ui.status(undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return drawPane($, e, await readView($), source)
  })
}
