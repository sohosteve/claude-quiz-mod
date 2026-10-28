// Draws the quiz pane: a live Claude-status header that never leaves the top,
// then the menu of sets or the current flash card.
import type { EngineInterface, RenderInput } from 'claude-code'

import type { Activity, Card, QuizSet, Score, Screen, SetInfo } from '../types'
import { choose, deal, pick, refresh, showMenu } from './actions'
import { CHOICES, elapsed, percent } from './quiz'

export type View = {
  activity: Activity
  screen: Screen
  sets: SetInfo[]
  set: QuizSet | null
  score: Score
  card: Card | null
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']

export function drawPane($: EngineInterface, e: RenderInput<'Pane'>, view: View, source: string) {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const { activity, screen } = view

  const agents = activity.agents > 0 ? `${activity.agents} agent${activity.agents === 1 ? '' : 's'}` : ''
  const status = activity.isBusy ? (
    <Text color="yellow">
      ● Claude is working {elapsed(activity.now - activity.startedAt)}
      {activity.tool ? ` · ${activity.tool}` : ''}
      {agents ? ` · ${agents}` : ''}
    </Text>
  ) : agents ? (
    <Text color="yellow">◐ Waiting on {agents}</Text>
  ) : (
    <Text color="green">✓ Claude is idle: your turn</Text>
  )
  // An auto-opened pane does not take the keyboard, so typing stays in the prompt.
  const header = (
    <Box flexDirection="column">
      {status}
      {!e.props.isFocused && <Text dimColor>ctrl+x tab to answer · ctrl+x x to close</Text>}
    </Box>
  )

  const menu = () => (
    <Box flexDirection="column">
      <Text weight="bold">Pick a quiz set</Text>
      {screen.kind === 'menu' && screen.error && <Text color="red">{screen.error}</Text>}
      {view.sets.length === 0 && <Text dimColor>No sets loaded yet. Press r to refresh.</Text>}
      {view.sets.slice(0, 9).map((info, i) => (
        <Button key={`set-${info.slug}`} plain hotkey={String(i + 1)} onPress={() => choose($, source, info.slug)}>
          {info.subject} <Text dimColor>{info.count} questions</Text>
        </Button>
      ))}
      <Box marginTop={1}>
        <Button key="refresh" plain hotkey="r" label="Refresh sets" onPress={() => refresh($, source)} />
      </Box>
    </Box>
  )

  const card = (set: QuizSet, current: Card) => {
    const q = set.questions.find(x => x.id === current.questionId)
    if (!q) return <Text color="red">Question {current.questionId} is missing from the set.</Text>
    const isAnswered = current.picked !== null
    const isRight = current.picked === q.answer_index
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {set.subject}
          {q.domain ? ` · ${q.domain}` : ''} · {view.score.correct}/{view.score.answered} ({percent(view.score)}%) ·
          streak {view.score.streak}
          {current.fromMissed ? ' · review of a missed one' : ''}
        </Text>
        <Box marginTop={1}>
          <Text weight="bold">{q.question}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {current.order.slice(0, CHOICES).map((choice, slot) => {
            const label = `${LETTERS[slot]}. ${q.choices[choice]}`
            if (!isAnswered) {
              return (
                <Button key={`choice-${slot}`} plain hotkey={String(slot + 1)} onPress={() => pick($, q.id, choice)}>
                  {label}
                </Button>
              )
            }
            const isAnswer = choice === q.answer_index
            const isPicked = choice === current.picked
            return (
              <Text key={`choice-${slot}`} color={isAnswer ? 'green' : isPicked ? 'red' : undefined} dimColor={!isAnswer && !isPicked}>
                {isAnswer ? '✓ ' : isPicked ? '✗ ' : '  '}
                {label}
              </Text>
            )
          })}
        </Box>
        {isAnswered && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={isRight ? 'green' : 'red'} weight="bold">
              {isRight ? 'Correct.' : 'Not quite.'}
            </Text>
            <Text>{q.explanation}</Text>
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Sources:</Text>
              {q.sources.map((s, i) => (
                <Link key={`source-${i}`} href={s.url} label={`  ${s.title}`} />
              ))}
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          {isAnswered && <Button key="next" hotkey="n" variant="primary" label="Next" onPress={() => deal($, q.id)} autoFocus />}
          <Button key="menu" hotkey="m" label="Sets" onPress={() => showMenu($)} />
        </Box>
      </Box>
    )
  }

  const body =
    screen.kind === 'loading' ? (
      <Box flexDirection="column">
        <Text dimColor>Loading {screen.slug}…</Text>
        <Button key="menu" hotkey="m" label="Sets" onPress={() => showMenu($)} />
      </Box>
    ) : screen.kind === 'card' && view.set && view.card ? (
      card(view.set, view.card)
    ) : (
      menu()
    )

  return (
    <Box flexDirection="column">
      {header}
      <Box marginTop={1} flexDirection="column">
        {body}
      </Box>
    </Box>
  )
}
