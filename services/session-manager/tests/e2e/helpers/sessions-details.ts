import { expect, type Locator } from '@playwright/test';

import type { Session } from '../../../lib/api/schemas';
import { t } from './i18n';
import { exitLine } from './sessions-page';

/**
 * The value beside a label in a session's details. The list is the library's
 * `PropertyList`, which has no roles: a row is its label followed by its
 * value, so the value is the label's next sibling. `scope` is what holds the
 * list: the card in the body of the page of a session, or the popover of the
 * chip.
 */
export function detail(scope: Locator, label: string): Locator {
  return scope
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::div[1]');
}

/** The names the details give the systems, as the Add session dialog does. */
function osName(os: string): string {
  switch (os) {
    case 'windows':
    case 'macos':
    case 'linux':
      return t(`sessions.add.os.${os}`);
    default:
      return os;
  }
}

/** Where the session is, as the details write it: latitude and longitude with three decimals. */
function coordinatesOf(session: Session): string | null {
  const place = session.location;
  if (place === null) return null;
  return `${place.latitude.toFixed(3)} / ${place.longitude.toFixed(3)}`;
}

/**
 * What the details say about a session: its system, screen, language, time
 * zone and location (each one only when it is known), where its proxy exits or
 * that it has none yet, and the IP the place was taken from. The same list is
 * in the popover of the chip and in the card in the body of the page, for a
 * session in any state.
 */
export async function expectDetails(
  scope: Locator,
  session: Session,
): Promise<void> {
  const { fingerprint, location, proxy } = session;
  const exitIp = proxy?.exitIp ?? location?.ip ?? null;
  const country = proxy?.country ?? location?.country ?? null;
  const exit =
    exitIp === null
      ? proxy === null
        ? t('viewer.card.noProxyYet')
        : t('viewer.card.notChecked')
      : country === null || country === ''
        ? exitIp
        : exitLine(exitIp, country);

  const known: [label: string, value: string | null | undefined][] = [
    [t('viewer.card.system'), osName(session.os)],
    [t('viewer.card.screen'), fingerprint.screen?.replace('x', '×')],
    [t('viewer.card.language'), fingerprint.locale],
    [t('viewer.card.timeZone'), fingerprint.timezone],
    [t('viewer.card.location'), coordinatesOf(session)],
  ];
  for (const [label, value] of known) {
    if (value) await expect(detail(scope, label)).toHaveText(value);
    else await expect(scope.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(detail(scope, t('viewer.card.ipAddress'))).toHaveText(exit);
}
