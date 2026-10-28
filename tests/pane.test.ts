import { expect, mock, test } from 'claude-code/testing'

const SET = {
  slug: 'demo',
  subject: 'Demo Cert',
  version: '1',
  questions: [
    {
      id: 'demo-1',
      question: 'Which port does HTTPS use by default?',
      choices: ['21', '22', '443', '80', '25'],
      answer_index: 2,
      explanation: 'HTTPS defaults to TCP 443.',
      sources: [{ title: 'RFC 9110', url: 'https://www.rfc-editor.org/rfc/rfc9110' }],
      verified_at: '2026-10-28',
      verified_by: 'test',
    },
  ],
}
const INDEX = { sets: [{ slug: 'demo', subject: 'Demo Cert', version: '1', path: 'sets/demo.json', count: 1 }] }

const PANE = {
  plugin: 'quiz-pane',
  component: 'Pane',
  requestId: 'quiz',
  props: {
    title: 'Quiz',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0 },
    view: {},
  },
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`plays a card and scores it (${surface})`, async ($, on) => {
    const fetched: string[] = []
    const saved: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: saved[e.key] }))
    on('store.set', ($, e) => {
      saved[e.key] = e.value
      return { value: undefined }
    })
    on('http.fetch', ($, e) => {
      fetched.push(e.url)
      const body = e.url.endsWith('index.json') ? INDEX : SET
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
    })

    // `props` is cast: the kit's SiteScroll/SiteView carry fields this test does not need.
    const ui = await $.ui.mount({ ...PANE, surface, props: PANE.props as never })
    expect(await ui.find({ text: /Claude is idle/ })).toBeDefined()

    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'set-demo' })
    expect(fetched.some(u => u.endsWith('/index.json'))).toBe(true)
    expect(fetched.some(u => u.endsWith('/sets/demo.json'))).toBe(true)
    expect(await ui.find({ text: /Which port does HTTPS use/ })).toBeDefined()

    const buttons = await ui.findAll({ type: 'Button' })
    const right = buttons.find(b => b.text.includes('443'))
    expect(right).toBeDefined()
    await Promise.all([ui.press({ key: String(right?.key) }), ui.press({ key: String(right?.key) }).catch(() => undefined)])

    expect(await ui.find({ text: /Correct\./ })).toBeDefined()
    expect(await ui.find({ text: /1\/1 \(100%\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Link' })).toBeDefined()
    expect(saved['score:demo']).toMatchObject({ answered: 1, correct: 1, missed: [] })
  })
}

test('falls back to the cached index when the network fails', async ($, on) => {
  mock.store(on, { index: INDEX })
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE.props as never })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: /Offline: showing cached sets/ })).toBeDefined()
  expect(await ui.find({ key: 'set-demo' })).toBeDefined()
})

test('a non-https remote source is refused', { options: { source: 'http://example.com/sets' } }, async ($, on) => {
  const saved: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: saved[e.key] }))
  on('store.set', ($, e) => {
    saved[e.key] = e.value
    return { value: undefined }
  })
  on('http.fetch', () => {
    throw new Error('must not fetch')
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PANE.props as never })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: /https URL/ })).toBeDefined()
})

for (const surface of ['terminal', 'desktop'] as const) {
  for (const isFocused of [false, true]) {
    test(`the ctrl+x tab hint shows only while the pane lacks the keyboard (${surface}, focused ${isFocused})`, async ($, on) => {
      mock.store(on, {})
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, isFocused } as never })
      const hint = await ui.find({ text: /ctrl\+x tab to answer/ })
      expect(hint === undefined).toBe(isFocused)
    })
  }
}
