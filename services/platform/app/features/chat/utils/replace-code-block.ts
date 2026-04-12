/**
 * Replaces a specific code block's content within a markdown string.
 *
 * Matches code blocks by comparing their trimmed content against the
 * original content. Preserves the language tag and fence style.
 *
 * Returns `{ markdown, replaced }` where `replaced` indicates whether
 * the target code block was found and updated.
 */
export function replaceCodeBlock(
  markdown: string,
  originalContent: string,
  newContent: string,
): { markdown: string; replaced: boolean } {
  const trimmedOriginal = originalContent.trim();

  // Match fenced code blocks: ```lang\n...content...\n```
  // Supports variable-length fences (3+ backticks)
  const fencePattern = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1\s*$/gm;

  let replaced = false;

  const result = markdown.replace(
    fencePattern,
    (match, fence, lang, content) => {
      if (replaced) return match;
      if (content.trim() === trimmedOriginal) {
        replaced = true;
        return `${fence}${lang}\n${newContent}\n${fence}`;
      }
      return match;
    },
  );

  return { markdown: result, replaced };
}
