/**
 * Scanning markup with regular expressions without the blow-up.
 *
 * The patterns the HTML and sitemap readers use match text that ENDS on a
 * literal terminator: a tag on `>`, a comment on `-->`, a link on `</a>`, a
 * sitemap entry on `</loc>`. On input that holds openers with no terminator
 * after them, the regex engine looks for the terminator to the end of the
 * input from every opener — quadratic, and cubic for the link pattern. 29 KB
 * of `<a href="…" ` with no closing bracket took six seconds to convert, and
 * a page, a sitemap or an e-mail body is megabytes of text the sender
 * chooses, read on the process's one thread.
 *
 * A match cannot reach past the last terminator, so nothing is lost by not
 * looking there. These helpers run a pattern on the part of the input that
 * ends at the last terminator, where every opener has one to find, and leave
 * the rest as it is.
 *
 * What they do not cover is a pattern that looks for a token INSIDE a tag
 * (`href=`, `name=`): that one has to stop at the next `<` itself
 * (`[^<>]*`, never `[^>]*`), or it rescans a run of unclosed tags from each
 * of them.
 *
 * Layer A: pure string work, no `node:*`.
 */

/** Where the last `terminator` ends in `input`, or 0 when it has none. A
 * pattern terminator must carry the `g` flag. */
function endOfLast(input: string, terminator: string | RegExp): number {
  if (typeof terminator === 'string') {
    const at = input.lastIndexOf(terminator);
    return at === -1 ? 0 : at + terminator.length;
  }
  let end = 0;
  for (const match of input.matchAll(terminator)) {
    end = match.index + match[0].length;
  }
  return end;
}

/** The part of `input` a pattern ending on `terminator` can match in: up to
 * and including the last terminator, empty when there is none. */
export function upToLast(input: string, terminator: string | RegExp): string {
  return input.slice(0, endOfLast(input, terminator));
}

/** What `String.prototype.replace` takes as its replacer function. */
type Replacer = Parameters<string['replace']>[1];

/** `input.replace(pattern, replacement)` for a pattern whose every match
 * ends on `terminator` (see the module note). */
export function replaceUpToLast(
  input: string,
  terminator: string | RegExp,
  pattern: RegExp,
  replacement: string | Replacer,
): string {
  const end = endOfLast(input, terminator);
  if (end === 0) return input;
  const head = input.slice(0, end);
  // Two calls: `replace` is overloaded on the replacement's type.
  const replaced =
    typeof replacement === 'string'
      ? head.replace(pattern, replacement)
      : head.replace(pattern, replacement);
  return replaced + input.slice(end);
}
