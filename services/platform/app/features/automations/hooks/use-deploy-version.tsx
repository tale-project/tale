'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useT } from '@/lib/i18n/client';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';

import {
  type DeployedTrigger,
  triggerOffAfterDeploy,
} from '../components/trigger-deploy-notice';
import { useAuthorText } from '../components/versions/version-author';
import {
  automationDeploymentStale,
  automationErrorCode,
  automationErrorIssues,
  automationErrorMessage,
  type StaleChange,
} from '../lib/errors';
import { useDeployAutomation } from './mutations';

/** Long enough to read the toast and reach its action before it fades. */
const DEPLOY_TOAST_MS = 10_000;

/** Why a version cannot go live, for the dialog that says so: it no longer
 * passes the checks (with what they found), or its tests fail. */
export type DeployRefusal = (
  | {
      version: number;
      kind: 'invalid';
      issues: readonly WireAutomationIssue[];
    }
  | { version: number; kind: 'testsFailing' }
) & {
  /** Where focus returns when the dialog closes: the control the deploy
   * was chosen from, when that was a menu gone by the time it answered. */
  returnFocus?: RefObject<HTMLElement | null>;
};

export interface UseDeployVersionOptions {
  organizationId: string;
  automationSlug: string;
  /** Opens the deployment history: where a refused deploy's reader looks
   * before choosing again. */
  onShowDeployments?: () => void;
  /** Called after every deploy with the trigger it left off — the page says
   * so and offers to turn it on — or null when the trigger is on or there
   * is none. */
  onTriggerOff?: (trigger: DeployedTrigger | null) => void;
  /** A refusal the page says its own way — the editor lists a version's
   * problems in its Problems panel. Answers whether it did; the hook then
   * says nothing more. A deploy someone else overtook is always the
   * hook's to say. */
  onRefused?: (error: unknown, version: number) => boolean;
}

export interface DeployVersion {
  /**
   * Put `version` live. `expected` is the version the page shows as live
   * (null: none): when another one went live meanwhile, nothing changes and
   * a toast says who put which version live. `returnFocus` is where a
   * refusal's dialog returns focus — a row's menu button, which the menu
   * the deploy was chosen from has closed by the time the answer comes.
   */
  deploy: (
    version: number,
    expected: number | null,
    returnFocus?: RefObject<HTMLElement | null>,
  ) => void;
  /** The version going live now, while its deploy runs. */
  pendingVersion: number | null;
  /** A refusal the page shows in a dialog; null when there is none. */
  refusal: DeployRefusal | null;
  closeRefusal: () => void;
}

/**
 * One click puts a version live — a deploy or a rollback, the same act —
 * guarded against a race: the deploy names the version the page shows as
 * live, and another one live now refuses it without changing anything. A
 * success says the version is live and that runs already started keep
 * theirs, with **Undo**, which puts the replaced version back the same way.
 * A version that no longer passes the checks or whose tests fail is refused
 * in a dialog the page renders from `refusal` — one failure, one surface.
 */
export function useDeployVersion({
  organizationId,
  automationSlug,
  onShowDeployments,
  onTriggerOff,
  onRefused,
}: UseDeployVersionOptions): DeployVersion {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const authorText = useAuthorText(organizationId);
  const deployAutomation = useDeployAutomation();
  const inFlight = useRef(false);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<DeployRefusal | null>(null);

  const staleText = useCallback(
    (stale: StaleChange): string => {
      if (stale.version === null || stale.by === null || stale.at === null) {
        return t('deploy.stale.changed');
      }
      const at = new Date(stale.at);
      const today = new Date().toDateString() === at.toDateString();
      const { subject } = authorText({
        actor: stale.by,
        via: stale.via,
        clientName: stale.client,
      });
      return t('deploy.stale.body', {
        who: subject.who,
        author: subject.author,
        current: stale.version,
        time: formatDate(at, today ? 'time' : 'long'),
      });
    },
    [authorText, formatDate, t],
  );

  const runDeploy = (
    version: number,
    expected: number | null,
    undo: boolean,
    returnFocus?: RefObject<HTMLElement | null>,
  ): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingVersion(version);
    setRefusal(null);
    deployAutomation
      .mutateAsync({
        organizationId,
        name: automationSlug,
        version,
        expectedDeployedVersion: expected,
      })
      .then(
        (result) => {
          const replaced = result.previousVersion ?? null;
          const canUndo =
            !undo && replaced !== null && result.kind !== 'unchanged';
          toast({
            title: t(undo ? 'deploy.toast.liveAgain' : 'deploy.toast.live', {
              version,
            }),
            description: t('deploy.toast.keep'),
            variant: 'success',
            duration: DEPLOY_TOAST_MS,
            ...(canUndo && {
              action: (
                <ToastPrimitives.Action
                  altText={t('deploy.toast.undoAltText', { version: replaced })}
                  asChild
                  onClick={() => run.current(replaced, version, true)}
                >
                  <Button type="button" variant="secondary" size="sm">
                    {t('deploy.toast.undo')}
                  </Button>
                </ToastPrimitives.Action>
              ),
            }),
          });
          onTriggerOff?.(triggerOffAfterDeploy(result.trigger));
        },
        (error: unknown) => {
          const stale = automationDeploymentStale(error);
          if (stale !== undefined) {
            toast({
              title: t('deploy.stale.title', { version }),
              description: staleText(stale),
              variant: 'destructive',
              duration: DEPLOY_TOAST_MS,
              ...(onShowDeployments !== undefined && {
                action: (
                  <ToastPrimitives.Action
                    altText={t('deploy.stale.showDeployments')}
                    asChild
                    onClick={onShowDeployments}
                  >
                    <Button type="button" variant="secondary" size="sm">
                      {t('deploy.stale.showDeployments')}
                    </Button>
                  </ToastPrimitives.Action>
                ),
              }),
            });
            return;
          }
          if (onRefused?.(error, version) === true) return;
          const code = automationErrorCode(error);
          if (
            code === 'AUTOMATION_TESTS_FAILING' ||
            code === 'AUTOMATION_DEPLOY_REJECTED'
          ) {
            setRefusal({
              version,
              kind: 'testsFailing',
              ...(returnFocus !== undefined && { returnFocus }),
            });
            return;
          }
          const issues = automationErrorIssues(error);
          if (code === 'AUTOMATION_INVALID' || issues !== undefined) {
            setRefusal({
              version,
              kind: 'invalid',
              issues: issues?.errors ?? [],
              ...(returnFocus !== undefined && { returnFocus }),
            });
            return;
          }
          toast({
            title: t('deploy.failed', { version }),
            description: automationErrorMessage(error),
            variant: 'destructive',
          });
        },
      )
      .finally(() => {
        inFlight.current = false;
        setPendingVersion(null);
      });
  };
  // Read through a ref, so a toast's Undo — which outlives the render it
  // was made in — and the stable `deploy` start the current deploy.
  const run = useRef(runDeploy);
  useLayoutEffect(() => {
    run.current = runDeploy;
  });

  const deploy = useCallback(
    (
      version: number,
      expected: number | null,
      returnFocus?: RefObject<HTMLElement | null>,
    ) => run.current(version, expected, false, returnFocus),
    [],
  );
  const closeRefusal = useCallback(() => setRefusal(null), []);
  return useMemo(
    () => ({ deploy, pendingVersion, refusal, closeRefusal }),
    [deploy, pendingVersion, refusal, closeRefusal],
  );
}
