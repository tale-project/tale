/**
 * The words of the Proxies and Secrets pages, for both specs: the sentences of
 * `messages/en/` with their arguments filled in the way the app words them (a
 * spec never spells out a UI sentence of its own), and where a value shows up
 * on a page.
 */

import type { Page } from '@playwright/test';

type Values = Record<string, string | number>;

const ENGLISH_PLURALS = new Intl.PluralRules('en-US');
const ENGLISH_NUMBERS = new Intl.NumberFormat('en-US');

/** The index of the `}` that closes the `{` at `open`. */
function closingBrace(message: string, open: number): number {
  let depth = 0;
  for (let at = open; at < message.length; at++) {
    if (message[at] === '{') depth += 1;
    if (message[at] === '}') depth -= 1;
    if (depth === 0) return at;
  }
  throw new Error(`Unbalanced braces in the message: ${message}`);
}

/** `one {# proxy} other {# proxies}` as selector -> message. */
function branchesOf(options: string): Map<string, string> {
  const branches = new Map<string, string>();
  let at = 0;
  while (at < options.length) {
    const open = options.indexOf('{', at);
    if (open < 0) break;
    const selector = options.slice(at, open).trim();
    const close = closingBrace(options, open);
    branches.set(selector, options.slice(open + 1, close));
    at = close + 1;
  }
  return branches;
}

function valueOf(name: string, values: Values): string | number {
  const value = values[name];
  if (value === undefined) {
    throw new Error(`The message argument ${name} has no value`);
  }
  return value;
}

function numberOf(name: string, values: Values): number {
  const value = valueOf(name, values);
  if (typeof value !== 'number') {
    throw new TypeError(`The message argument ${name} must be a number`);
  }
  return value;
}

/** One `{...}` argument: the text between its braces. */
function argument(source: string, values: Values): string {
  const comma = source.indexOf(',');
  if (comma < 0) return String(valueOf(source.trim(), values));
  const name = source.slice(0, comma).trim();
  const rest = source.slice(comma + 1);
  const second = rest.indexOf(',');
  const kind = (second < 0 ? rest : rest.slice(0, second)).trim();
  if (kind === 'number') return ENGLISH_NUMBERS.format(numberOf(name, values));
  if (kind === 'plural') {
    const count = numberOf(name, values);
    const branches = branchesOf(second < 0 ? '' : rest.slice(second + 1));
    const chosen =
      branches.get(`=${count}`) ??
      branches.get(ENGLISH_PLURALS.select(count)) ??
      branches.get('other');
    if (chosen === undefined) throw new Error(`No branch for ${count}`);
    return render(
      chosen.replaceAll('#', ENGLISH_NUMBERS.format(count)),
      values,
    );
  }
  throw new Error(`The message argument type ${kind} is not supported`);
}

function render(message: string, values: Values): string {
  let result = '';
  let at = 0;
  while (at < message.length) {
    const open = message.indexOf('{', at);
    if (open < 0) {
      result += message.slice(at);
      break;
    }
    result += message.slice(at, open);
    const close = closingBrace(message, open);
    result += argument(message.slice(open + 1, close), values);
    at = close + 1;
  }
  return result;
}

/**
 * The message with its arguments in: `{name}`, `{n, number}` (grouped digits,
 * `4,096`) and `{n, plural, ...}` (English: `one`, `other` and exact `=0`).
 */
export function format(message: string, values: Values = {}): string {
  return render(message, values);
}

/**
 * Every word the browser's own accessibility tree holds: the names, the values
 * and the descriptions a screen reader is given. It is the tree as the browser
 * builds it, in which the value of a password field is dots; Playwright's
 * `ariaSnapshot()` reads the markup instead and lists what is typed into one.
 */
export async function accessibilityTreeText(page: Page): Promise<string> {
  const client = await page.context().newCDPSession(page);
  try {
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    return nodes
      .flatMap((node) => [node.name, node.value, node.description])
      .map((property) => property?.value)
      .filter((word): word is string => typeof word === 'string')
      .join('\n');
  } finally {
    await client.detach();
  }
}

type Place = 'markup' | 'text' | 'accessibility tree';

/**
 * Where on the page the values show up, each as "<what> in the <place>": in
 * the markup, in the text a person reads, or in the accessibility tree as
 * Playwright reads it from the markup (which lists what is typed into a field,
 * so a form that holds a value on purpose is looked at in the first two only;
 * what the browser itself tells a screen reader of a form is
 * `accessibilityTreeText`). A value the page must keep back gets an empty
 * answer. The values are named so a failure says which one leaked without
 * printing it.
 */
export async function leaksOf(
  page: Page,
  named: Record<string, string>,
  places: readonly Place[] = ['markup', 'text', 'accessibility tree'],
): Promise<string[]> {
  const body = page.locator('body');
  const content: Record<Place, () => Promise<string>> = {
    // Icons are drawn with long runs of numbers, which a short value can match.
    markup: async () =>
      (await page.content()).replaceAll(/<svg[\s\S]*?<\/svg>/g, ''),
    text: () => body.innerText(),
    'accessibility tree': () => body.ariaSnapshot(),
  };
  const found: string[] = [];
  for (const place of places) {
    const where = await content[place]();
    for (const [name, value] of Object.entries(named)) {
      if (where.includes(value)) found.push(`${name} in the ${place}`);
    }
  }
  return found;
}
