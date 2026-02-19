/**
 * Marker Parser
 *
 * Parses structured markers from streaming AI responses.
 * Markers follow the format [[MARKER_NAME]] anywhere in the text.
 *
 * During streaming, partial markers (e.g., "[[CONCLU") are held back
 * in `pendingText` to prevent flashing incomplete markers to the user.
 */

const MARKERS = [
  'CONCLUSION',
  'KEY_POINTS',
  'DETAILS',
  'QUESTIONS',
  'NEXT_STEPS',
] as const;

type MarkerType = (typeof MARKERS)[number];

interface ParsedSection {
  type: MarkerType | 'plain';
  content: string;
}

interface MarkerParseResult {
  hasMarkers: boolean;
  sections: ParsedSection[];
  pendingText: string;
}

const MARKER_REGEX =
  /\[\[(CONCLUSION|KEY_POINTS|DETAILS|QUESTIONS|NEXT_STEPS)\]\]/;

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

function isValidMarker(name: string): name is MarkerType {
  return (MARKERS as readonly string[]).includes(name);
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

  // Check if any markers exist
  if (!MARKER_REGEX.test(textToParse)) {
    return {
      hasMarkers: false,
      sections: [{ type: 'plain', content: textToParse }],
      pendingText,
    };
  }

  // Split by markers using a global version of the regex
  const splitRegex =
    /\[\[(CONCLUSION|KEY_POINTS|DETAILS|QUESTIONS|NEXT_STEPS)\]\]/g;
  const sections: ParsedSection[] = [];

  let lastIndex = 0;
  let lastMarker: MarkerType | null = null;
  let match: RegExpExecArray | null;

  while ((match = splitRegex.exec(textToParse)) !== null) {
    const markerName = match[1];

    if (!isValidMarker(markerName)) continue;

    // Content before this marker
    const contentBefore = textToParse.slice(lastIndex, match.index);

    if (lastMarker === null) {
      // Text before the first marker → plain section
      const trimmed = contentBefore.trim();
      if (trimmed) {
        sections.push({ type: 'plain', content: trimmed });
      }
    } else {
      // Content of the previous marker section
      sections.push({ type: lastMarker, content: contentBefore.trim() });
    }

    lastMarker = markerName;
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after the last marker
  if (lastMarker !== null) {
    const remaining = textToParse.slice(lastIndex).trim();
    sections.push({ type: lastMarker, content: remaining });
  }

  return {
    hasMarkers: true,
    sections,
    pendingText,
  };
}

export type { MarkerType, ParsedSection, MarkerParseResult };
export { MARKERS, parseMarkers };
