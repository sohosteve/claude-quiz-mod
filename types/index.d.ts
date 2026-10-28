export type Source = { title: string; url: string }

export type Question = {
  id: string
  question: string
  choices: string[]
  answer_index: number
  explanation: string
  sources: Source[]
  verified_at: string
  verified_by: string
  domain?: string
}

export type QuizSet = {
  slug: string
  subject: string
  version: string
  questions: Question[]
}

export type SetInfo = {
  slug: string
  subject: string
  version: string
  path: string
  count: number
}

export type Score = {
  answered: number
  correct: number
  streak: number
  missed: string[]
  seen: string[]
}

export type Card = {
  questionId: string
  order: number[]
  picked: number | null
  fromMissed: boolean
}

export type Activity = {
  isBusy: boolean
  startedAt: number
  now: number
  tool: string | null
  agents: number
}

export type Screen =
  | { kind: 'menu'; error: string | null }
  | { kind: 'loading'; slug: string }
  | { kind: 'card'; slug: string }

declare module 'claude-code' {
  interface PluginState {
    'quiz-pane': {
      activity: Activity
      screen: Screen
      sets: SetInfo[]
      set: QuizSet | null
      score: Score
      card: Card | null
      counter: number
      dismissed: boolean
      loadToken: number
    }
  }
}
