/**
 * Carry operator answers into a re-kicked agent turn.
 *
 * An answered ask is normally delivered by resuming the SAME harness
 * conversation (`agent_host.resumeWorkflowAgentTurnWithAnswer`), so the agent
 * keeps its context and the answer arrives as the next message. When that
 * resumed turn dies before making progress — a provider outage, a crash — the
 * stepper's auto-retry re-kicks the node as a FRESH conversation over the
 * preserved workspace. The fresh turn knows nothing of the questions it
 * already asked or the answers the operator already gave: it re-derives the
 * same ambiguities and asks them AGAIN, burning an operator round-trip per
 * retry. Folding every answered ask of the node into the re-kick's prompt
 * closes that loop; a first kick has no answered asks and stays byte-identical.
 */

export interface AnsweredAskCarryover {
  readonly question: string;
  readonly answer: string;
}

/** Appended between the node prompt and the carryover so the agent reads the
 * answers as settled operator decisions, not as fresh conversation input. */
const CARRYOVER_HEADER = [
  '---',
  '',
  'OPERATOR ANSWERS ALREADY GIVEN — an earlier attempt of this step asked the' +
    ' operator and was answered before that attempt was cut short. These' +
    ' decisions STAND: apply them as settled, do not re-derive them, and do' +
    ' NOT ask these questions again. Ask only when a genuinely NEW' +
    ' operator-only decision comes up.',
].join('\n');

export function promptWithAnsweredAsks(
  prompt: string,
  asks: readonly AnsweredAskCarryover[],
): string {
  if (asks.length === 0) return prompt;
  const blocks = asks.map((ask) =>
    [
      'QUESTION (already asked):',
      ask.question,
      '',
      'OPERATOR ANSWER:',
      ask.answer,
    ].join('\n'),
  );
  return [prompt, '', CARRYOVER_HEADER, '', blocks.join('\n\n')].join('\n');
}

/**
 * The first message of the turn that delivers an operator's answer.
 *
 * With a harness conversation handle the turn RESUMES the asking
 * conversation, so the answer alone is the message — the conversation
 * already holds the task and the question. Without a handle (the asking
 * turn never reported one, or the ring dropped the announcement) the
 * delivery is a FRESH conversation over the preserved workspace: an
 * answer-only message would leave the agent without its assignment, so the
 * fallback restores the full node prompt and folds in every answered round
 * — the ask being delivered included, it is already `answered` when the
 * resume runs.
 */
export function answerResumePrompt(args: {
  nodePrompt: string;
  answer: string;
  hasConversation: boolean;
  answeredAsks: readonly AnsweredAskCarryover[];
}): string {
  if (args.hasConversation) {
    return [
      'The operator answered your question:',
      '',
      args.answer,
      '',
      'Continue the task from where you left off, applying this answer. Ask again only if a genuinely NEW operator-only decision comes up.',
    ].join('\n');
  }
  return promptWithAnsweredAsks(args.nodePrompt, args.answeredAsks);
}
