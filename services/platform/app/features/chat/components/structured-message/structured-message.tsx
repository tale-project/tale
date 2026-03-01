'use client';

/**
 * Structured Message Orchestrator
 *
 * Parses AI response text for the [[NEXT_STEPS]] marker and renders it as
 * follow-up buttons. All other recognised markers ([[CONCLUSION]], etc.)
 * are silently stripped so their content renders as regular markdown.
 *
 * Always renders via the mapped-sections path so the TypewriterText at
 * key="section-0" survives when new sections appear (e.g. [[NEXT_STEPS]]
 * arriving mid-stream). Without this, the render-path switch would
 * unmount the TypewriterText, dumping all buffered content at once.
 */

import { memo, useMemo } from 'react';

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

  const lastSectionIndex = parsed.sections.length - 1;

  return (
    <>
      {parsed.sections.map((section, index) => {
        const isLastSection = index === lastSectionIndex;
        const isActiveSection = isStreaming && isLastSection;

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
      })}
    </>
  );
}

export const StructuredMessage = memo(
  StructuredMessageComponent,
  (prev, next) =>
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.onSendFollowUp === next.onSendFollowUp,
);
