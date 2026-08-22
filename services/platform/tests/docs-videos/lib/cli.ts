/**
 * Argument parsing for `bun run docs:videos` — pure and unit-tested, so the
 * CLI contract can't silently drift. `produce.ts` owns dispatch; this module
 * owns the vocabulary and the help text.
 */

import { LOCALES, type Locale } from './episode';

export const STAGES = [
  'check',
  'plan',
  'tts',
  'record',
  'compose',
  'all',
] as const;
export type Stage = (typeof STAGES)[number];

export interface CliOptions {
  /** Episode ids, or 'all' (every shippable episode, diagnostics excluded). */
  readonly episodes: readonly string[] | 'all';
  readonly locales: readonly Locale[];
  readonly stage: Stage;
  readonly list: boolean;
  readonly audition: boolean;
  readonly help: boolean;
  /** Rehearsal narration: estimated-length silence instead of ElevenLabs. */
  readonly mockTts: boolean;
  /** Fast low-res compose into `.state/out/` — never the docs tree. */
  readonly draft: boolean;
  /** Post-compose A/V verification (`--no-verify` opts out). */
  readonly verify: boolean;
  /** Environment preflight: stack, auth, orgs, tools — with fix commands. */
  readonly doctor: boolean;
}

const DEFAULTS: CliOptions = {
  episodes: ['ep1-welcome'],
  locales: ['en'],
  stage: 'all',
  list: false,
  audition: false,
  help: false,
  mockTts: false,
  draft: false,
  verify: true,
  doctor: false,
};

export class CliUsageError extends Error {}

function parseList(flag: string, raw: string | undefined): string[] {
  const values = (raw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new CliUsageError(`${flag} needs a value (see --help)`);
  }
  return values;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list':
        options.list = true;
        break;
      case '--audition':
        options.audition = true;
        break;
      case '--doctor':
        options.doctor = true;
        break;
      case '--mock-tts':
        options.mockTts = true;
        break;
      case '--draft':
        options.draft = true;
        break;
      case '--no-verify':
        options.verify = false;
        break;
      case '--episode': {
        const values = parseList('--episode', argv[++i]);
        options.episodes = values.includes('all') ? 'all' : values;
        break;
      }
      case '--locale': {
        const values = parseList('--locale', argv[++i]);
        if (values.includes('all')) {
          options.locales = [...LOCALES];
          break;
        }
        const invalid = values.filter(
          (value) => !LOCALES.includes(value as Locale),
        );
        if (invalid.length > 0) {
          throw new CliUsageError(
            `Unknown locale(s): ${invalid.join(', ')} (valid: ${LOCALES.join(', ')}, all)`,
          );
        }
        options.locales = values as Locale[];
        break;
      }
      case '--stage': {
        const value = argv[++i] ?? '';
        if (!STAGES.includes(value as Stage)) {
          throw new CliUsageError(
            `Unknown stage "${value}" (valid: ${STAGES.join(', ')})`,
          );
        }
        options.stage = value as Stage;
        break;
      }
      default:
        throw new CliUsageError(`Unknown argument: ${arg} (see --help)`);
    }
  }
  return options;
}

export function helpText(): string {
  return `docs:videos — produce the docs tutorial videos from episode specs

Usage
  bun run docs:videos -- [flags]

Selection
  --episode <ids|all>   Episode id(s), comma-separated, or "all" (every
                        shippable episode; diagnostics stay opt-in by id).
                        Default: ep1-welcome
  --locale <l,l|all>    ${LOCALES.join(', ')} or "all". Default: en

Stages (--stage <name>, default: all = tts → record → compose)
  check     Static validation only: spec ↔ choreography parity, locale
            consistency, hero-prompt ↔ mock-reply pairing. No side effects.
  plan      Print the planned timeline (measured narration when TTS ran,
            estimates otherwise). No side effects.
  tts       Synthesize narration (ElevenLabs, cache-first — bills characters).
  record    Drive the browser take (needs the Mode-A stack; see README).
  compose   ffmpeg assembly + captions + poster + manifest + verification.

Modes
  --mock-tts    Estimated-length silent narration instead of ElevenLabs —
                rehearse choreography with zero billing. Compose refuses to
                ship an estimated plan into the docs tree (use --draft).
  --draft       Compose fast + small into .state/out/ for review; skips the
                manifest, poster and docs assets entirely.
  --no-verify   Skip the post-compose A/V verification gate.

Utilities
  --list        Episodes, narration readiness, TTS/plan status.
  --doctor      Preflight the environment (stack, auth, orgs, tools) and
                print the exact fix command for anything broken.
  --audition    Voice candidates → .state/audition/.
  --help, -h    This text.

Examples
  bun run docs:videos -- --episode ep2-chat --locale all
  bun run docs:videos -- --episode ep3-knowledge --locale de --stage tts
  bun run docs:videos -- --episode spike-sync --mock-tts --draft
  bun run docs:videos -- --episode all --locale all --stage check
`;
}
