// Pure quiz logic: set validation, picking the next card, scoring.
// No `$` here, so the tests exercise it directly.
import type { Card, Question, QuizSet, Score, SetInfo } from '../types'

export const CHOICES = 5
export const MISSED_EVERY = 3
export const MAX_QUESTIONS = 500
export const MAX_SETS = 200
export const MAX_TEXT = 2000
export const MAX_SOURCES = 5
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
// C0/C1 controls and DEL, which would let remote text drive the terminal.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export const EMPTY_SCORE: Score = { answered: 0, correct: 0, streak: 0, missed: [], seen: [] }

type Check<T> = { ok: true; value: T } | { ok: false; error: string }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT
export const clean = (text: string): string => text.replace(CONTROL, '')
const isHttps = (v: unknown): boolean => {
  if (!isText(v)) return false
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}

export function checkQuestion(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'not an object'
  const q = raw as Record<string, unknown>
  if (!isText(q.id)) return 'missing id'
  const at = `question ${q.id}`
  if (!isText(q.question)) return `${at}: missing question text`
  if (!Array.isArray(q.choices) || q.choices.length !== CHOICES || !q.choices.every(isText)) {
    return `${at}: needs exactly ${CHOICES} non-empty choices`
  }
  if (new Set(q.choices.map(c => String(c).trim().toLowerCase())).size !== CHOICES) {
    return `${at}: duplicate choices`
  }
  if (!Number.isInteger(q.answer_index) || (q.answer_index as number) < 0 || (q.answer_index as number) >= CHOICES) {
    return `${at}: answer_index must be 0-${CHOICES - 1}`
  }
  if (!isText(q.explanation)) return `${at}: missing explanation`
  if (!Array.isArray(q.sources) || q.sources.length === 0 || q.sources.length > MAX_SOURCES) {
    return `${at}: needs 1-${MAX_SOURCES} sources`
  }
  for (const s of q.sources) {
    const src = s as Record<string, unknown>
    if (!isText(src?.title) || !isHttps(src?.url)) return `${at}: each source needs a title and an https url`
  }
  if (!isText(q.verified_at) || !isText(q.verified_by)) return `${at}: missing verified_at / verified_by`
  return null
}

function cleanQuestion(q: Question): Question {
  return {
    ...q,
    id: clean(q.id),
    question: clean(q.question),
    choices: q.choices.map(clean),
    explanation: clean(q.explanation),
    sources: q.sources.map(src => ({ title: clean(src.title), url: src.url })),
    domain: typeof q.domain === 'string' ? clean(q.domain).slice(0, 120) : undefined,
  }
}

export function checkSet(raw: unknown, slug?: string): Check<QuizSet> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'set is not an object' }
  const s = raw as Record<string, unknown>
  if (!isText(s.slug) || !SLUG.test(s.slug)) return { ok: false, error: 'set needs a lowercase slug' }
  if (slug !== undefined && s.slug !== slug) return { ok: false, error: `set slug "${s.slug}" does not match "${slug}"` }
  if (!isText(s.subject) || !isText(s.version)) return { ok: false, error: 'set needs subject and version' }
  if (!Array.isArray(s.questions) || s.questions.length === 0) return { ok: false, error: 'set has no questions' }
  if (s.questions.length > MAX_QUESTIONS) return { ok: false, error: `set has over ${MAX_QUESTIONS} questions` }
  const ids = new Set<string>()
  for (const q of s.questions) {
    const error = checkQuestion(q)
    if (error) return { ok: false, error }
    const id = (q as Question).id
    if (ids.has(id)) return { ok: false, error: `duplicate question id ${id}` }
    ids.add(id)
  }
  const set = raw as QuizSet
  return {
    ok: true,
    value: { slug: set.slug, subject: clean(set.subject), version: clean(set.version), questions: set.questions.map(cleanQuestion) },
  }
}

export function checkIndex(raw: unknown): Check<SetInfo[]> {
  const sets = (raw as { sets?: unknown })?.sets
  if (!Array.isArray(sets)) return { ok: false, error: 'index.json has no sets list' }
  // The path is never taken from the index: a set always lives at sets/<slug>.json.
  const valid = sets.filter((x): x is SetInfo => isText(x?.slug) && SLUG.test(x.slug) && isText(x?.subject))
  return {
    ok: true,
    value: valid.slice(0, MAX_SETS).map(x => ({
      slug: x.slug,
      subject: clean(x.subject),
      version: clean(String(x.version ?? '')).slice(0, 40),
      path: `sets/${x.slug}.json`,
      count: Math.max(0, Math.floor(Number(x.count) || 0)),
    })),
  }
}

export function checkScore(raw: unknown): Score {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0)
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-MAX_QUESTIONS) : [])
  return { answered: count(r.answered), correct: count(r.correct), streak: count(r.streak), missed: ids(r.missed), seen: ids(r.seen) }
}

export function shuffled(length: number, random: () => number): number[] {
  return Array.from({ length }, (_, i) => ({ i, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(x => x.i)
}

// Every MISSED_EVERY-th card replays the oldest missed question; otherwise an
// unseen one, then any, never the card just shown.
export function nextCard(
  set: QuizSet,
  score: Score,
  counter: number,
  previousId: string | null,
  random: () => number,
): Card {
  const ids = new Set(set.questions.map(q => q.id))
  const missed = score.missed.filter(id => ids.has(id) && id !== previousId)
  const isMissedTurn = missed.length > 0 && counter % MISSED_EVERY === MISSED_EVERY - 1
  let pool: string[]
  if (isMissedTurn) {
    pool = missed.slice(0, 1)
  } else {
    const unseen = set.questions.filter(q => !score.seen.includes(q.id) && q.id !== previousId)
    const rest = set.questions.filter(q => q.id !== previousId)
    pool = (unseen.length > 0 ? unseen : rest.length > 0 ? rest : set.questions).map(q => q.id)
  }
  const questionId = pool[Math.floor(random() * pool.length)] ?? set.questions[0]?.id ?? ''
  return { questionId, order: shuffled(CHOICES, random), picked: null, fromMissed: isMissedTurn }
}

export function scoreAnswer(score: Score, questionId: string, isCorrect: boolean): Score {
  const seen = score.seen.includes(questionId) ? score.seen : [...score.seen, questionId]
  const missedWithout = score.missed.filter(id => id !== questionId)
  return {
    answered: score.answered + 1,
    correct: score.correct + (isCorrect ? 1 : 0),
    streak: isCorrect ? score.streak + 1 : 0,
    missed: isCorrect ? missedWithout : [...missedWithout, questionId],
    seen,
  }
}

export function percent(score: Score): number {
  return score.answered === 0 ? 0 : Math.round((score.correct / score.answered) * 100)
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
