import path from 'node:path';

export const CAPTURE_LOCALES = ['en', 'de', 'fr'] as const;
export type CaptureLocale = (typeof CAPTURE_LOCALES)[number];

export interface CaptureArgs {
  list: boolean;
  skipSeed: boolean;
  only: string[];
  grep: RegExp | null;
  locales: CaptureLocale[];
  stateDir: string | null;
  configDir: string | null;
}

export function parseCaptureArgs(argv: readonly string[]): CaptureArgs {
  const args: CaptureArgs = {
    list: false,
    skipSeed: false,
    only: [],
    grep: null,
    locales: ['en'],
    stateDir: null,
    configDir: null,
  };
  const valueAfter = (index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argv[index]}`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--list') args.list = true;
    else if (arg === '--skip-seed') args.skipSeed = true;
    else if (arg === '--only') args.only.push(...valueAfter(i++).split(','));
    else if (arg === '--grep') args.grep = new RegExp(valueAfter(i++));
    else if (arg === '--state-dir') args.stateDir = valueAfter(i++);
    else if (arg === '--config-dir') args.configDir = valueAfter(i++);
    else if (arg === '--locales') {
      const locales = valueAfter(i++).split(',');
      for (const locale of locales) {
        if (!CAPTURE_LOCALES.includes(locale as CaptureLocale)) {
          throw new Error(`Unsupported capture locale: ${locale}`);
        }
      }
      args.locales = [...new Set(locales)] as CaptureLocale[];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** CLI isolation takes precedence over the environment and existing local state. */
export function screenshotStateDir(
  args: CaptureArgs,
  envStateDir: string | undefined,
  defaultStateDir: string,
): string {
  return path.resolve(args.stateDir ?? envStateDir ?? defaultStateDir);
}

/** Keep the English documentation URLs stable; localized pixels get their own directory. */
export function screenshotFile(
  section: string,
  shot: string,
  locale: CaptureLocale,
): string {
  return [
    'images',
    section,
    ...(locale === 'en' ? [] : [locale]),
    `${shot}.webp`,
  ].join('/');
}
