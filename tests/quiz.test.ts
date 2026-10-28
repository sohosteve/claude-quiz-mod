import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_SCORE, checkIndex, checkScore, checkSet, elapsed, nextCard, percent, scoreAnswer, shuffled } from '../hooks/quiz'
import type { Question, QuizSet } from '../types'

const question = (id: string, extra: Partial<Question> = {}): Question => ({
  id,
  question: `Question ${id}?`,
  choices: ['one', 'two', 'three', 'four', 'five'],
  answer_index: 2,
  explanation: 'Because.',
  sources: [{ title: 'Spec', url: 'https://example.com/spec' }],
  verified_at: '2026-10-28',
  verified_by: 'test',
  ...extra,
})

const quizSet = (ids: string[]): QuizSet => ({
  slug: 'demo',
  subject: 'Demo',
  version: '1',
  questions: ids.map(id => question(id)),
})

// Deterministic "random" that walks a fixed list.
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length] ?? 0
}

describe('checkSet', () => {
  test('accepts a well-formed set', () => {
    expect(checkSet(quizSet(['a', 'b'])).ok).toBe(true)
  })

  test('rejects a question without sources', () => {
    const bad = { ...quizSet(['a']), questions: [question('a', { sources: [] })] }
    const checked = checkSet(bad)
    expect(checked.ok).toBe(false)
    expect(checked.ok ? '' : checked.error).toContain('source')
  })

  test('rejects a non-https source, wrong choice count, bad answer index, duplicate ids', () => {
    const cases = [
      question('a', { sources: [{ title: 'x', url: 'http://example.com' }] }),
      question('a', { choices: ['1', '2', '3', '4'] }),
      question('a', { answer_index: 5 }),
      question('a', { choices: ['same', 'same', 'c', 'd', 'e'] }),
      question('a', { verified_by: '' }),
    ]
    for (const q of cases) {
      expect(checkSet({ ...quizSet([]), questions: [q] }).ok).toBe(false)
    }
    expect(checkSet({ ...quizSet([]), questions: [question('a'), question('a')] }).ok).toBe(false)
  })

  test('rejects an empty set and a bad slug', () => {
    expect(checkSet(quizSet([])).ok).toBe(false)
    expect(checkSet({ ...quizSet(['a']), slug: '../etc' }).ok).toBe(false)
  })
})

describe('checkIndex', () => {
  test('never takes the path from the index, and drops bad slugs', () => {
    const checked = checkIndex({
      sets: [
        { slug: 'ok', subject: 'OK', version: '1', path: 'sets/ok.json', count: 3 },
        { slug: 'evil', subject: 'Evil', version: '1', path: '../%2e%2e/secrets.json', count: 1 },
        { slug: '../up', subject: 'Up', version: '1', path: 'x', count: 1 },
      ],
    })
    expect(checked.ok ? checked.value.map(s => [s.slug, s.path]) : []).toEqual([
      ['ok', 'sets/ok.json'],
      ['evil', 'sets/evil.json'],
    ])
  })

  test('fails without a sets list', () => {
    expect(checkIndex({}).ok).toBe(false)
  })
})

describe('remote input', () => {
  test('strips terminal control characters from shown text', () => {
    const dirty = { ...quizSet([]), questions: [question('a', { question: 'Q[31m red?' })] }
    const checked = checkSet(dirty)
    expect(checked.ok ? checked.value.questions[0]?.question : '').toBe('Q[31m red?')
  })

  test('rejects a set whose slug differs from the one asked for, and oversized text', () => {
    expect(checkSet(quizSet(['a']), 'other').ok).toBe(false)
    expect(checkSet({ ...quizSet([]), questions: [question('a', { question: 'x'.repeat(2001) })] }).ok).toBe(false)
  })

  test('checkScore repairs a malformed stored score', () => {
    expect(checkScore({ answered: 'lots', missed: 'a', seen: ['a', 3] })).toEqual({ ...EMPTY_SCORE, seen: ['a'] })
    expect(checkScore(undefined)).toEqual(EMPTY_SCORE)
  })
})

describe('nextCard', () => {
  const set = quizSet(['a', 'b', 'c'])

  test('prefers unseen questions and never repeats the card just shown', () => {
    const score = { ...EMPTY_SCORE, seen: ['a'] }
    const card = nextCard(set, score, 0, 'b', seq(0))
    expect(card.questionId).toBe('c')
    expect(card.picked).toBe(null)
    expect(card.order.slice().sort()).toEqual([0, 1, 2, 3, 4])
  })

  test('replays the oldest missed question every third card', () => {
    const score = { ...EMPTY_SCORE, missed: ['b', 'c'], seen: ['a', 'b', 'c'] }
    const card = nextCard(set, score, 2, 'a', seq(0.9))
    expect(card.questionId).toBe('b')
    expect(card.fromMissed).toBe(true)
    expect(nextCard(set, score, 0, 'a', seq(0)).fromMissed).toBe(false)
  })

  test('falls back to any other question once all are seen', () => {
    const score = { ...EMPTY_SCORE, seen: ['a', 'b', 'c'] }
    expect(nextCard(set, score, 0, 'a', seq(0)).questionId).toBe('b')
  })
})

describe('scoreAnswer', () => {
  test('a wrong answer joins missed and resets the streak', () => {
    const s = scoreAnswer({ ...EMPTY_SCORE, streak: 4 }, 'a', false)
    expect(s).toEqual({ answered: 1, correct: 0, streak: 0, missed: ['a'], seen: ['a'] })
  })

  test('a right answer clears it from missed and grows the streak', () => {
    const s = scoreAnswer({ answered: 1, correct: 0, streak: 0, missed: ['a', 'b'], seen: ['a', 'b'] }, 'a', true)
    expect(s).toEqual({ answered: 2, correct: 1, streak: 1, missed: ['b'], seen: ['a', 'b'] })
  })

  test('does not mutate the score it was given', () => {
    const before = { ...EMPTY_SCORE, missed: ['x'] }
    scoreAnswer(before, 'y', false)
    expect(before.missed).toEqual(['x'])
  })
})

test('helpers: percent, elapsed, shuffled', () => {
  expect(percent(EMPTY_SCORE)).toBe(0)
  expect(percent({ ...EMPTY_SCORE, answered: 3, correct: 2 })).toBe(67)
  expect(elapsed(9_400)).toBe('9s')
  expect(elapsed(75_000)).toBe('1m 15s')
  expect(shuffled(5, seq(0.5, 0.1, 0.9, 0.3, 0.7))).toEqual([1, 3, 0, 4, 2])
})
