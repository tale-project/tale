/**
 * The ONE interactive-prompt primitive for the `tale` CLI.
 *
 * Wraps `@inquirer/prompts` so every prompt across the CLI looks and behaves
 * identically:
 *
 *  - Led by the reporter's `[ ? ]` question marker (and `[ + ]` once answered),
 *    matching `questionLine`/`doneLine` so prompts sit cleanly in the same
 *    output stream as everything else.
 *  - Honors `--yes`/`assumeYes`: confirms resolve to their default (or `true`),
 *    inputs/selects resolve to their default — no prompt is shown.
 *  - Throws a clear, actionable error in a non-interactive shell instead of
 *    hanging forever (the old `node:readline` `confirm` bug) or dumping a raw
 *    inquirer stack trace.
 *
 * Replaces the three competing stacks (`utils/confirm.ts` readline, raw
 * `node:readline`, scattered `@inquirer/prompts` imports).
 */

import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  password as inquirerPassword,
  select as inquirerSelect,
} from '@inquirer/prompts';
import { getMarkers, getPalette } from '@tale/shared/tux';

import { getOutputMode } from './output-mode';

/**
 * Lead prompts with the reporter's markers: cyan `[ ? ]` while asking, green
 * `[ + ]` once answered — so an answered prompt reads like a `doneLine`. Built
 * per call from the configured palette/markers (the single source of truth), so
 * `--no-color` is honored here too.
 */
function buildTheme() {
  const palette = getPalette();
  const markers = getMarkers();
  return {
    prefix: {
      idle: `${palette.cyan}${markers.question}${palette.reset}`,
      done: `${palette.green}${markers.done}${palette.reset}`,
    },
  };
}

/** Whether to auto-accept: the explicit option wins, else the global `--yes`. */
function assumeYes(option: boolean | undefined): boolean {
  return option ?? getOutputMode().assumeYes;
}

/** Thrown when a prompt is genuinely required but no terminal is attached. */
export class NonInteractiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonInteractiveError';
  }
}

/** Whether a real terminal is attached on both stdin and stdout. */
export function isInteractive(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

function requireInteractive(message: string): void {
  if (!isInteractive()) {
    throw new NonInteractiveError(
      `Cannot prompt ("${message}") — this is not an interactive terminal. ` +
        'Re-run with --yes to accept defaults, or run it in an interactive shell.',
    );
  }
}

interface ConfirmOptions {
  message: string;
  /** Default applied on Enter and when `assumeYes` is set. */
  default?: boolean;
  assumeYes?: boolean;
}

export async function confirm(options: ConfirmOptions): Promise<boolean> {
  if (assumeYes(options.assumeYes)) return options.default ?? true;
  requireInteractive(options.message);
  return inquirerConfirm({
    message: options.message,
    default: options.default ?? false,
    theme: buildTheme(),
  });
}

interface InputOptions {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string | Promise<boolean | string>;
  assumeYes?: boolean;
}

export async function input(options: InputOptions): Promise<string> {
  if (assumeYes(options.assumeYes) && options.default !== undefined) {
    return options.default;
  }
  requireInteractive(options.message);
  return inquirerInput({
    message: options.message,
    default: options.default,
    validate: options.validate,
    theme: buildTheme(),
  });
}

interface PasswordOptions {
  message: string;
  mask?: string | boolean;
}

export async function password(options: PasswordOptions): Promise<string> {
  // A password can never be assumed — always require a real terminal.
  requireInteractive(options.message);
  return inquirerPassword({
    message: options.message,
    mask: options.mask ?? '*',
    theme: buildTheme(),
  });
}

interface SelectChoice<T> {
  name: string;
  value: T;
  description?: string;
}

interface SelectOptions<T> {
  message: string;
  choices: ReadonlyArray<SelectChoice<T>>;
  default?: T;
  assumeYes?: boolean;
}

export async function select<T>(options: SelectOptions<T>): Promise<T> {
  if (assumeYes(options.assumeYes) && options.default !== undefined) {
    return options.default;
  }
  requireInteractive(options.message);
  return inquirerSelect<T>({
    message: options.message,
    choices: [...options.choices],
    default: options.default,
    theme: buildTheme(),
  });
}
