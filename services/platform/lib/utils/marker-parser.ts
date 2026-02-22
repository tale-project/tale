/**
 * Marker Parser
 *
 * Parses structured markers from streaming AI responses.
 * Markers follow the format [[MARKER_NAME]] anywhere in the text.
 *
 * Only [[NEXT_STEPS]] creates a structural section split (rendered as
 * follow-up buttons). All other recognised markers ([[CONCLUSION]],
 * [[KEY_POINTS]], [[DETAILS]], [[QUESTIONS]]) are silently stripped so
 * their content flows as regular markdown.
 *
 * During streaming, partial markers (e.g., "[[CONCLU") are held back
 * in `pendingText` to prevent flashing incomplete markers to the user.
 */

type SectionMarkerType = 'NEXT_STEPS';

interface ParsedSection {
  type: SectionMarkerType | 'plain';
  content: string;
}

interface MarkerParseResult {
  hasMarkers: boolean;
  sections: ParsedSection[];
  pendingText: string;
}

/** Matches any recognised marker — used for partial-marker detection */
const ANY_MARKER_REGEX =
  /\[\[(CONCLUSION|KEY_POINTS|DETAILS|QUESTIONS|NEXT_STEPS)\]\]/;

/** Markers that are stripped (not used for section splitting) */
const STRIP_MARKER_REGEX =
  /\[\[(CONCLUSION|KEY_POINTS|DETAILS|QUESTIONS)\]\]\n?/g;

/** The only marker that creates a structural split */
const NEXT_STEPS_REGEX = /\[\[NEXT_STEPS\]\]/;

/** Max length of a partial marker: "[[NEXT_STEPS]]" = 14 chars */
const MAX_MARKER_LENGTH = 14;

/**
 * Check if text ends with a potential partial marker.
 * Matches trailing `[[` followed by 0-12 uppercase letters/underscores.
 */
const PARTIAL_MARKER_REGEX = /\[\[[A-Z_]{0,12}$/;

function trimPendingText(text: string): { clean: string; pending: string } {
  const match = PARTIAL_MARKER_REGEX.exec(text);
  if (!match) return { clean: text, pending: '' };

  const partialStart = match.index;
  // Only hold back if the partial is short enough to be a real marker
  if (text.length - partialStart > MAX_MARKER_LENGTH) {
    return { clean: text, pending: '' };
  }

  return {
    clean: text.slice(0, partialStart),
    pending: text.slice(partialStart),
  };
}

/**
 * Parse structured markers from AI response text.
 *
 * @param text - The full (or partial) response text
 * @param isStreaming - Whether the text is still being streamed
 * @returns Parsed sections, marker presence flag, and any held-back pending text
 */
function parseMarkers(text: string, isStreaming: boolean): MarkerParseResult {
  if (!text) {
    return { hasMarkers: false, sections: [], pendingText: '' };
  }

  // During streaming, check for partial marker at the end
  let textToParse = text;
  let pendingText = '';

  if (isStreaming) {
    const trimmed = trimPendingText(text);
    textToParse = trimmed.clean;
    pendingText = trimmed.pending;
  }

  if (!textToParse) {
    return { hasMarkers: false, sections: [], pendingText };
  }

  // Strip non-structural markers (CONCLUSION, KEY_POINTS, DETAILS, QUESTIONS)
  const stripped = textToParse.replace(STRIP_MARKER_REGEX, '');

  // Check if NEXT_STEPS marker exists
  if (!NEXT_STEPS_REGEX.test(stripped)) {
    const content = stripped.trim();
    return {
      hasMarkers: ANY_MARKER_REGEX.test(textToParse),
      sections: content ? [{ type: 'plain', content }] : [],
      pendingText,
    };
  }

  // Split on [[NEXT_STEPS]]
  const sections: ParsedSection[] = [];
  const splitRegex = /\[\[NEXT_STEPS\]\]/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = splitRegex.exec(stripped)) !== null) {
    const contentBefore = stripped.slice(lastIndex, match.index).trim();
    if (contentBefore) {
      sections.push({ type: 'plain', content: contentBefore });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after [[NEXT_STEPS]]
  const remaining = stripped.slice(lastIndex).trim();
  sections.push({ type: 'NEXT_STEPS', content: remaining });

  return {
    hasMarkers: true,
    sections,
    pendingText,
  };
}

export type { ParsedSection };
export { parseMarkers };
