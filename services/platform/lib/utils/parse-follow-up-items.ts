export const MAX_FOLLOW_UP_LENGTH = 60;
export const MAX_FOLLOW_UP_ITEMS = 4;

const MARKDOWN_PATTERN = /[|*#\[\]`~>]|^-\s|^\d+\.\s/;

function isValidFollowUp(line: string) {
  return (
    line.length > 0 &&
    line.length <= MAX_FOLLOW_UP_LENGTH &&
    !MARKDOWN_PATTERN.test(line)
  );
}

export function parseFollowUpItems(content: string) {
  if (!content) return [];
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(isValidFollowUp)
    .slice(0, MAX_FOLLOW_UP_ITEMS);
}
