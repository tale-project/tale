'use client';

import { useEffect, useMemo, useState } from 'react';

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils/cn';
import { parseMarkers } from '@/lib/utils/marker-parser';

import { containsNormalized, stripMarkdownOnce } from '../hooks/markdown-strip';
import { useVoiceChunks } from '../hooks/use-voice-output';
import {
  useActivePlaybackForMessage,
  useVoicePreReservationError,
} from '../hooks/voice-output-context';
import {
  markdownComponents,
  markdownWrapperStyles,
} from './message-bubble/markdown-renderer';
import { NextStepsSection } from './structured-message/section-renderers';
import { TypewriterText } from './typewriter-text';

interface AssistantMessageContentProps {
  text: string;
  isStreaming: boolean;
  onSendFollowUp?: (message: string) => void;
  /**
   * The message's id and thread id — used to look up the currently-
   * playing chunk text via `useVoiceChunks` + `useActivePlaybackForMessage`.
   * Optional so the component degrades gracefully on shared-view or
   * preview surfaces where the voice pipeline isn't wired.
   */
  messageId?: string;
  threadId?: string;
  /**
   * Gate prop: pass `false` for voice-mode-off bubbles and the
   * component renders exactly like the pre-spotlight pipeline (no
   * extra subscriptions, no per-paragraph wrap). Avoids paying for
   * `useVoiceChunks` on every assistant bubble in a thread when voice
   * isn't in use.
   */
  voiceModeEnabled: boolean;
  /**
   * True when this message's id was NOT in the chat list's first-
   * render snapshot — i.e. it arrived during this mount and is
   * eligible for voice-led reveal. Hide-text-until-audio behavior
   * gates on this so history messages (where no synthesis will fire)
   * always render their text immediately.
   */
  isFreshSinceMount: boolean;
}

const PARAGRAPH_SPLIT = /\n{2,}/;

// Fenced code blocks (and a few other block constructs) routinely contain
// blank lines that would otherwise get sliced into separate paragraphs by
// `PARAGRAPH_SPLIT`. The naive split breaks markdown rendering: an opening
// ``` ``` `` lands in one paragraph and its body / closing fence in the
// next, so react-markdown renders an unterminated `<pre>` plus literal
// backticks. Mask the fenced regions before splitting and restore them
// after. ` ``` ` and `~~~` are matched non-greedily so adjacent fences
// don't merge. Round-1 / round-2 HIGH #7.
const FENCED_BLOCK = /(`{3,}|~{3,})[\s\S]*?\1/g;

function splitParagraphsPreservingFences(content: string): string[] {
  const fences: string[] = [];
  const placeholder = (i: number) => `\x00FENCE_${i}\x00`;
  const masked = content.replace(FENCED_BLOCK, (match) => {
    fences.push(match);
    return placeholder(fences.length - 1);
  });
  const paragraphs = masked.split(PARAGRAPH_SPLIT);
  return paragraphs.map((paragraph) =>
    paragraph.replace(/\x00FENCE_(\d+)\x00/g, (_full, idx: string) => {
      const i = Number(idx);
      return Number.isFinite(i) && fences[i] !== undefined ? fences[i] : '';
    }),
  );
}

/**
 * Render an assistant message with paragraph-level "spotlight" during
 * voice playback. When voice mode is on AND a chunk of THIS message is
 * actively playing, the paragraph that contains the playing chunk text
 * stays at full opacity while every other paragraph dims to 60%. The
 * effect is purely visual — no DOM is reordered, all text remains
 * selectable / copyable.
 *
 * When voice mode is off, OR when the message is streaming, OR when
 * the playing chunk is on a *different* message, this component is a
 * thin wrapper around the existing `StructuredMessage`-equivalent
 * pipeline (parseMarkers → TypewriterText per section).
 *
 * Why paragraph-level (not sentence-level): wrapping a sentence in a
 * `<span>` inside markdown content breaks markdown structure (a span
 * across `**bold**` orphans the markers). Paragraphs are markdown
 * block-level units and survive being wrapped in a `<div>`. ChatGPT
 * itself doesn't ship sentence-level highlight.
 */
export function AssistantMessageContent({
  text,
  isStreaming,
  onSendFollowUp,
  messageId,
  threadId,
  voiceModeEnabled,
  isFreshSinceMount,
}: AssistantMessageContentProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Active-playback channel. `null` whenever (a) voice mode is off, (b)
  // no other player is currently active, OR (c) a different message is
  // the active one. In any of those cases the spotlight should not
  // engage and we render the no-op path below.
  const activePlayback = useActivePlaybackForMessage(messageId);

  // Subscribe to chunks whenever voice mode is on for this message —
  // we need to observe the FIRST ready chunk arriving even if active
  // playback hasn't been published yet (voice-first reveal). For
  // voice-off bubbles we still skip the query to avoid the per-
  // assistant-bubble subscription cost.
  const chunks = useVoiceChunks(
    voiceModeEnabled ? messageId : undefined,
    voiceModeEnabled ? threadId : undefined,
  );

  // Pre-reservation failures (NO_PROVIDER, UNKNOWN_VOICE, HOST_POLICY)
  // never create a chunk row, so we can't detect them via `chunks`.
  // Subscribe to the per-message sink so a failure also un-hides text.
  const preReservationError = useVoicePreReservationError(messageId);

  // Voice-first reveal: keep the assistant text hidden until the FIRST
  // ready chunk arrives (or any failure surfaces). Without this, the
  // text would render fully — then voice would start later — making
  // the bubble feel like two unrelated UI events. By gating on
  // `isFreshSinceMount` we leave history messages alone: their text
  // is already complete and there is no synthesis pending.
  //
  // Derived (not state-backed) because the underlying signals are
  // monotonic in practice — once `ready`, always `ready`; once an
  // error sinks, it stays until message change. Convex subscriptions
  // don't flap on these.
  const hasReadyChunk = chunks?.some((c) => c.status === 'ready') ?? false;
  const hasFailedChunk = chunks?.some((c) => c.status === 'failed') ?? false;
  const hasError = !!preReservationError || hasFailedChunk;

  // Reveal watchdog: when streaming has finished AND voice mode is on
  // AND no chunk row ever appeared AND no error sank, the bubble would
  // otherwise hang forever — the chunker correctly skips zero-length
  // stripped content (pure emoji / whitespace replies), so neither a
  // ready chunk nor a failure ever surfaces. After 2 s of `!isStreaming`
  // with no signal, force-reveal so the user always sees the text.
  // Reset on `messageId` change so a fresh bubble starts the timer
  // anew, and on `isStreaming` flipping back to `true` (mid-stream
  // resume) so a long pause doesn't trip the watchdog prematurely.
  const [revealForceShow, setRevealForceShow] = useState(false);
  useEffect(() => {
    const shouldArm =
      voiceModeEnabled &&
      isFreshSinceMount &&
      !hasReadyChunk &&
      !hasError &&
      !isStreaming &&
      chunks !== undefined &&
      chunks.length === 0;
    if (!shouldArm) return undefined;
    const timer = setTimeout(() => setRevealForceShow(true), 2000);
    return () => clearTimeout(timer);
  }, [
    voiceModeEnabled,
    isFreshSinceMount,
    isStreaming,
    chunks,
    hasReadyChunk,
    hasError,
  ]);
  useEffect(() => {
    setRevealForceShow(false);
  }, [messageId]);

  const shouldHideText =
    voiceModeEnabled &&
    isFreshSinceMount &&
    !hasReadyChunk &&
    !hasError &&
    !revealForceShow;

  const activeChunkText = useMemo(() => {
    if (!activePlayback || activePlayback.chunkIndex === null || !chunks) {
      return null;
    }
    const chunk = chunks.find((c) => c.index === activePlayback.chunkIndex);
    return chunk?.text ?? null;
  }, [activePlayback, chunks]);

  const parsed = useMemo(
    () => parseMarkers(text, isStreaming),
    [text, isStreaming],
  );

  // Cross-paragraph chunk detection: when the active chunk's text spans
  // multiple paragraphs (typical of the chunker's post-stream short-
  // reply path, which collapses `\n\n` → space and emits one chunk
  // covering the whole tail), no individual paragraph's stripped text
  // contains the joined chunk string. The spotlight branch would then
  // dim every paragraph — the bubble reads fully muted while audio
  // plays. Detect this here and fall through to the no-spotlight
  // render so the user reads at normal contrast. Hoisted above the
  // fallback gate so the branch decision is centralised.
  const spotlightMatchesAny = useMemo(() => {
    if (activeChunkText === null || activeChunkText.trim().length === 0) {
      return false;
    }
    return parsed.sections.some((section) => {
      if (section.type !== 'plain') return false;
      const paragraphs = splitParagraphsPreservingFences(section.content);
      return paragraphs.some((p) =>
        containsNormalized(stripMarkdownOnce(p), activeChunkText),
      );
    });
  }, [parsed.sections, activeChunkText]);

  // Voice-first: text is hidden until either audio starts or an error
  // surfaces. The voice indicator (mounted at the message-bubble level
  // above this component) shows "Preparing voice…" during this window.
  if (shouldHideText) return null;

  // No spotlight engaged — render exactly the original
  // `StructuredMessage` path. Avoids re-mounting TypewriterText
  // instances, which would interrupt the typewriter animation
  // mid-stream. Also engaged when the chunk spans paragraphs
  // (`!spotlightMatchesAny`) so the bubble doesn't go fully muted.
  if (
    !voiceModeEnabled ||
    isStreaming ||
    activeChunkText === null ||
    activeChunkText.trim().length === 0 ||
    !spotlightMatchesAny
  ) {
    const lastIndex = parsed.sections.length - 1;
    return (
      <>
        {parsed.sections.map((section, index) => {
          const isLast = index === lastIndex;
          const isActiveSection = isStreaming && isLast;
          switch (section.type) {
            case 'NEXT_STEPS':
              return (
                <NextStepsSection
                  key={`section-${index}`}
                  content={section.content}
                  isStreaming={isActiveSection}
                  onSendFollowUp={onSendFollowUp}
                />
              );
            case 'plain':
              return (
                <TypewriterText
                  key={`section-${index}`}
                  text={section.content}
                  isStreaming={isActiveSection}
                  components={markdownComponents}
                  className={markdownWrapperStyles}
                />
              );
            default:
              return undefined;
          }
        })}
      </>
    );
  }

  // Spotlight path: split each plain section into paragraphs, find
  // which contains the active chunk text, dim the rest. We never enter
  // this branch while streaming, so the typewriter-cursor handoff that
  // keeps `isLast` significant in the no-spotlight path above doesn't
  // apply here — every paragraph renders with `isStreaming={false}`.
  return (
    <>
      {parsed.sections.map((section, index) => {
        if (section.type === 'NEXT_STEPS') {
          // NextSteps suggestion chips are never spoken; render
          // them at full opacity too so the user can still click
          // them mid-playback. Streaming-isActive irrelevant here
          // because the spotlight path gates on `!isStreaming`.
          return (
            <NextStepsSection
              key={`section-${index}`}
              content={section.content}
              isStreaming={false}
              onSendFollowUp={onSendFollowUp}
            />
          );
        }
        if (section.type !== 'plain') return undefined;
        const paragraphs = splitParagraphsPreservingFences(section.content);
        return paragraphs.map((paragraph, pIdx) => {
          const stripped = stripMarkdownOnce(paragraph);
          const isActive = containsNormalized(stripped, activeChunkText);
          return (
            <div
              key={`section-${index}-p-${pIdx}`}
              data-paragraph-idx={pIdx}
              data-section-idx={index}
              // Inactive paragraphs are removed from the SR tree while
              // audio is playing this message — the announcer + audio
              // already cover the SR channel, so leaving the body text
              // exposed produces a double-read (round-1 / round-2 HIGH
              // #14). Active paragraph stays visible to SR so a user who
              // wants to read along still can.
              aria-hidden={!isActive || undefined}
              className={cn(
                !prefersReducedMotion && 'transition-opacity duration-300',
                // Token-driven muted colour dims inactive paragraphs
                // (passes WCAG 4.5:1 vs the bare opacity-60). The
                // non-color cue required by WCAG 1.4.1 is carried by
                // the `VoiceOutputIndicator` ("Speaking" pill) rendered
                // above the active paragraph in `message-bubble.tsx`,
                // which provides a positional + iconographic anchor
                // independent of paragraph text colour.
                isActive ? 'text-foreground' : 'text-muted-foreground',
                // Keep paragraph spacing identical to the non-spotlight
                // path so the spotlight-on/off transition doesn't reflow
                // the bubble.
                pIdx > 0 && 'mt-2',
              )}
            >
              <TypewriterText
                text={paragraph}
                isStreaming={false}
                components={markdownComponents}
                className={markdownWrapperStyles}
              />
            </div>
          );
        });
      })}
    </>
  );
}
