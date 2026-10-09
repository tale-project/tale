import type { PolicyType } from '@tale/shared/schemas/governance';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import {
  Activity,
  type ComponentType,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useT } from '@/lib/i18n/client';

import { PolicyReadAccessContext } from '../hooks/policy-read-access';
import { useDsarPolicyForUi, useGovernancePolicy } from '../hooks/queries';

interface PolicyReadState {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

function PolicyReadBoundary({
  query,
  children,
}: {
  query: PolicyReadState;
  children: ReactNode;
}) {
  const { t } = useT('governance');
  const [retrying, setRetrying] = useState(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const failed = query.isError || retrying;
  const visible = !failed && (query.isLoading || query.data !== undefined);
  const mounted = useRef(false);
  const access = useRef(false);
  access.current = visible && !query.isLoading && query.data !== undefined;
  if (visible) mounted.current = true;
  useLayoutEffect(() => {
    if (visible && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) content.current?.focus();
    }
  }, [visible]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await query.refetch();
    } catch (error) {
      console.error('[governance policy retry]', error);
    } finally {
      restoreFocus.current = document.activeElement === retryButton.current;
      setRetrying(false);
    }
  }

  return (
    <>
      {failed && (
        <Alert variant="destructive">
          <p>{t('policyReadFailed')}</p>
          <Button
            ref={retryButton}
            type="button"
            variant="secondary"
            aria-disabled={retrying}
            aria-description={retrying ? t('policyReadRetrying') : undefined}
            aria-busy={retrying}
            onClick={() => void retry()}
          >
            {t('policyReadRetry')}
          </Button>
        </Alert>
      )}
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <PolicyReadAccessContext.Provider value={access}>
          <div ref={content} tabIndex={-1}>
            {mounted.current && children}
          </div>
        </PolicyReadAccessContext.Provider>
      </Activity>
    </>
  );
}

export function withGovernancePolicyReadBoundary<
  Props extends { organizationId: string },
>(Editor: ComponentType<Props>, policyType: PolicyType) {
  return function PolicyEditor(props: Props) {
    const query = useGovernancePolicy(props.organizationId, policyType);
    return (
      <PolicyReadBoundary key={props.organizationId} query={query}>
        <Editor {...props} />
      </PolicyReadBoundary>
    );
  };
}

/** The boundary of an editor that reads two policies — the budget rules,
 * saved in the budgets file and in the project caps file beside it: it
 * waits for both, and a retry reads both again. */
export function withGovernancePolicyPairReadBoundary<
  Props extends { organizationId: string },
>(Editor: ComponentType<Props>, first: PolicyType, second: PolicyType) {
  return function PolicyEditor(props: Props) {
    const firstQuery = useGovernancePolicy(props.organizationId, first);
    const secondQuery = useGovernancePolicy(props.organizationId, second);
    const query: PolicyReadState = {
      data:
        firstQuery.data === undefined || secondQuery.data === undefined
          ? undefined
          : firstQuery.data,
      isLoading: firstQuery.isLoading || secondQuery.isLoading,
      isError: firstQuery.isError || secondQuery.isError,
      refetch: () => Promise.all([firstQuery.refetch(), secondQuery.refetch()]),
    };
    return (
      <PolicyReadBoundary key={props.organizationId} query={query}>
        <Editor {...props} />
      </PolicyReadBoundary>
    );
  };
}

export function withDsarPolicyReadBoundary<
  Props extends { organizationId: string },
>(Editor: ComponentType<Props>) {
  return function PolicyEditor(props: Props) {
    const query = useDsarPolicyForUi(props.organizationId);
    return (
      <PolicyReadBoundary key={props.organizationId} query={query}>
        <Editor {...props} />
      </PolicyReadBoundary>
    );
  };
}
