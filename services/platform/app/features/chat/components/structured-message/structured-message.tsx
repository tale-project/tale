'use client';

/**
 * Structured Message Orchestrator
 *
 * Parses AI response text for the [[NEXT_STEPS]] marker and renders it as
 * follow-up buttons. All other recognised markers ([[CONCLUSION]], etc.)
 * are silently stripped so their content renders as regular markdown.
 *
 * Falls back to plain TypewriterText when no markers are detected.
 */

import { memo, useMemo } from 'react';

import type { ParsedSection } from '@/lib/utils/marker-parser';

import { parseMarkers } from '@/lib/utils/marker-parser';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';
import { NextStepsSection } from './section-renderers';

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
