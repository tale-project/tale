import type { TFunction } from 'i18next';

import { sessionFailureText } from '@/app/lib/api/failure';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useStatusLabel } from '../components/session-status';
import { outOfSync, shownStatus } from '../lib/status';

/** How the second line of a row reads: quietly, as a warning, or as a failure. */
export type SecondLineTone = 'plain' | 'warning' | 'error';

export interface SecondLine {
  text: string;
  tone: SecondLineTone;
}

/**
 * What a session failed with, in the person's language when the app words that
 * failure (`errors.<code>`, with the cause the session carries), else the first
 * line of the backend's own text.
 */
function failureLine(session: Session, tErrors: TFunction): string | null {
  const worded = sessionFailureText(session, tErrors);
  if (worded !== null) return worded;
  const first = session.error?.split('\n')[0]?.trim();
  return first === undefined || first === '' ? null : first;
}

/**
 * The line under a session's name in a list: where it exits (running), that
 * its IP no longer matches (running, out of step), what it failed with (error,
 * or stopped with the failure of its last proxy change, which it keeps until
 * its next start), or the words of its state. It is one line in the list: the
 * row shows it cut, with the whole of it as its title.
 */
export function useSecondLine(session: Session): SecondLine {
  const { t } = useT('sessions');
  const { t: tErrors } = useT('errors');
  const statusLabel = useStatusLabel();
  const shown = shownStatus(session);

  if (shown === 'running') {
    if (outOfSync(session))
      return { text: t('row.ipChanged'), tone: 'warning' };
    const where = [session.proxy?.exitIp, session.proxy?.country]
      .filter((part): part is string => typeof part === 'string' && part !== '')
      .join(' · ');
    return {
      text: where === '' ? statusLabel('running') : where,
      tone: 'plain',
    };
  }
  if (shown === 'error' || shown === 'stopped') {
    // A stopped session stays stopped when giving it another proxy failed; the
    // list must not hide that behind a plain state.
    const failure = failureLine(session, tErrors);
    if (failure !== null) return { text: failure, tone: 'error' };
    if (shown === 'error') return { text: statusLabel('error'), tone: 'error' };
  }
  return { text: statusLabel(shown), tone: 'plain' };
}
