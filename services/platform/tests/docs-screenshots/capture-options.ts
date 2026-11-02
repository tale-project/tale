import path from 'node:path';

export const CAPTURE_LOCALES = ['en', 'de', 'fr'] as const;
export type CaptureLocale = (typeof CAPTURE_LOCALES)[number];

/** The layouts a shot is captured in: Tale's desktop layout, and its phone
 * layout below the `md` breakpoint (`MOBILE_QUERY` in `@tale/ui/use-is-mobile`). */
export const CAPTURE_DEVICES = ['desktop', 'phone'] as const;
export type CaptureDevice = (typeof CAPTURE_DEVICES)[number];

export interface CaptureArgs {
  list: boolean;
  skipSeed: boolean;
  only: string[];
  grep: RegExp | null;
  locales: CaptureLocale[];
  /** `--devices`; null takes the default of `captureDevices`. */
  devices: CaptureDevice[] | null;
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
    devices: null,
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
    } else if (arg === '--devices') {
      const devices = valueAfter(i++).split(',');
      for (const device of devices) {
        if (!CAPTURE_DEVICES.includes(device as CaptureDevice)) {
          throw new Error(`Unsupported capture device: ${device}`);
        }
      }
      args.devices = [...new Set(devices)] as CaptureDevice[];
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

/**
 * The layouts a locale is captured in. The docs pages show English captures,
 * so a phone capture is English unless `--devices` asks for it in every
 * locale of the run.
 */
export function captureDevices(
  args: CaptureArgs,
  locale: CaptureLocale,
): readonly CaptureDevice[] {
  return args.devices ?? (locale === 'en' ? CAPTURE_DEVICES : ['desktop']);
}

/** Keep the English documentation URLs stable; localized pixels get their own
 * directory, and a phone capture sits beside its desktop file as
 * `<shot>.phone.webp`. */
export function screenshotFile(
  section: string,
  shot: string,
  locale: CaptureLocale,
  device: CaptureDevice = 'desktop',
): string {
  return [
    'images',
    section,
    ...(locale === 'en' ? [] : [locale]),
    device === 'desktop' ? `${shot}.webp` : `${shot}.${device}.webp`,
  ].join('/');
}
