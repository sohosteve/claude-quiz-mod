// Loads the quiz-set index and sets from the configured source (an https base
// URL or a local folder), caching each in $.store so play works offline.
import type { EngineInterface } from 'claude-code'

import type { QuizSet, Score, SetInfo } from '../types'
import { checkIndex, checkScore, checkSet } from './quiz'

type Loaded<T> = { ok: true; value: T; isCached: boolean } | { ok: false; error: string }
type Checker<T> = (raw: unknown) => { ok: true; value: T } | { ok: false; error: string }

const MAX_BODY = 2_000_000

const isUrl = (source: string) => /^[a-z]+:\/\//i.test(source)
const join = (base: string, path: string) => `${base.replace(/[\\/]+$/, '')}/${path.replace(/^\/+/, '')}`

async function readText($: EngineInterface, source: string, path: string): Promise<string> {
  const where = join(source, path)
  if (!isUrl(source)) return $.fs.read(where)
  if (!/^https:\/\//i.test(source)) throw new Error('source must be an https URL or a local folder')
  const res = await $.http.fetch(where)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (res.text.length > MAX_BODY) throw new Error('response is over 2 MB')
  return res.text
}

async function load<T>($: EngineInterface, source: string, path: string, cacheKey: string, check: Checker<T>): Promise<Loaded<T>> {
  let fetchError: string
  try {
    const checked = check(JSON.parse(await readText($, source, path)))
    if (checked.ok) {
      await $.store.set(cacheKey, checked.value)
      return { ok: true, value: checked.value, isCached: false }
    }
    fetchError = `${path}: ${checked.error}`
  } catch (err) {
    fetchError = `${path}: ${err instanceof Error ? err.message : String(err)}`
  }
  try {
    const cached = await $.store.get(cacheKey)
    const fromCache = cached === undefined ? null : check(cached)
    if (fromCache?.ok) return { ok: true, value: fromCache.value, isCached: true }
  } catch {
    // An unreadable cache is the same as no cache: report the fetch error.
  }
  return { ok: false, error: fetchError }
}

export function loadIndex($: EngineInterface, source: string): Promise<Loaded<SetInfo[]>> {
  return load($, source, 'index.json', 'index', checkIndex)
}

export function loadSet($: EngineInterface, source: string, info: SetInfo): Promise<Loaded<QuizSet>> {
  return load($, source, `sets/${info.slug}.json`, `set:${info.slug}`, raw => checkSet(raw, info.slug))
}

export async function loadScore($: EngineInterface, slug: string): Promise<Score> {
  return checkScore(await $.store.get(`score:${slug}`))
}

export function saveScore($: EngineInterface, slug: string, score: Score): Promise<void> {
  return $.store.set(`score:${slug}`, score)
}
