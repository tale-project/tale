'use client';

/**
 * Structured Message Orchestrator
 *
 * Parses AI response text for structured markers ([[CONCLUSION]], [[KEY_POINTS]],
 * [[DETAILS]], [[QUESTIONS]], [[NEXT_STEPS]]) and renders each section with appropriate UI.
 *
 * Falls back to plain TypewriterText when no markers are detected.
 *
 * Each structured section gets its own TypewriterText instance for independent
 * animation. Only the last section with growing content is actively streaming.
 */

import { memo, useMemo } from 'react';

import type { ParsedSection } from '@/lib/utils/marker-parser';

import { parseMarkers } from '@/lib/utils/marker-parser';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';
import {
  ConclusionSection,
  KeyPointsSection,
  DetailsSection,
  QuestionsSection,
  NextStepsSection,
} from './section-renderers';

// ============================================================================
// TYPES
// ============================================================================

interface StructuredMessageProps {
  text: string;
  isStreaming: boolean;
  onSendFollowUp?: (message: string) => void;
}

// ============================================================================
// SECTION RENDERER
// ============================================================================

function renderSection(
  section: ParsedSection,
  index: number,
  isActiveSection: boolean,
  onSendFollowUp?: (message: string) => void,
) {
  switch (section.type) {
    case 'CONCLUSION':
      return (
        <ConclusionSection
          key={`section-${index}`}
          content={section.content}
          isStreaming={isActiveSection}
        />
      );
    case 'KEY_POINTS':
      return (
        <KeyPointsSection
          key={`section-${index}`}
          content={section.content}
          isStreaming={isActiveSection}
        />
      );
    case 'DETAILS':
      return (
        <DetailsSection
          key={`section-${index}`}
          content={section.content}
          isStreaming={isActiveSection}
        />
      );
    case 'QUESTIONS':
      return (
        <QuestionsSection
          key={`section-${index}`}
          content={section.content}
          isStreaming={isActiveSection}
        />
      );
    case 'NEXT_STEPS':
      return (
        <NextStepsSection
          key={`section-${index}`}
          content={section.content}
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
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function StructuredMessageComponent({
  text,
  isStreaming,
  onSendFollowUp,
}: StructuredMessageProps) {
  const parsed = useMemo(
    () => parseMarkers(text, isStreaming),
    [text, isStreaming],
  );

  // No markers detected — render plain
  if (!parsed.hasMarkers) {
    return (
      <TypewriterText
        text={text}
        isStreaming={isStreaming}
        components={markdownComponents}
        className={markdownWrapperStyles}
      />
    );
  }

  // Render structured sections
  // The last section with content is the actively streaming one
  const lastSectionIndex = parsed.sections.length - 1;

  return (
    <div className="structured-message">
      {parsed.sections.map((section, index) => {
        const isLastSection = index === lastSectionIndex;
        const isActiveSection = isStreaming && isLastSection;

        return renderSection(section, index, isActiveSection, onSendFollowUp);
      })}
    </div>
  );
}

export const StructuredMessage = memo(
  StructuredMessageComponent,
  (prev, next) =>
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.onSendFollowUp === next.onSendFollowUp,
);
