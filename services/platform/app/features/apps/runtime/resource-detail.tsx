'use client';

/**
 * The app shell's generic resource-detail overlay — the target of an
 * `onSuccess: { kind: 'openDetail' }` action effect. Keyed by a polymorphic
 * `(subjectType, id)`, it renders the resource's workflow run via the reused
 * `SubjectRun` → `EmbeddedRun`, so any action (in any app) can open any
 * resource's detail in-context without leaving the page. One overlay instance
 * lives at the app shell; `useResourceDetail().open({...})` drives it.
 *
 * Mounted inside `AppRuntimeProvider` (so `SubjectRun` resolves the org from
 * context); the Radix portal keeps the React tree, so context still flows.
 */
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useT } from '@/lib/i18n/client';

import { SubjectRun } from '../registry/connected/subject-run';

export interface ResourceDetailTarget {
  subjectType: string;
  id: string;
  /** Optional dialog title; falls back to a generic localized label. */
  title?: string;
}

interface ResourceDetailApi {
  open: (target: ResourceDetailTarget) => void;
}

// Stable no-op so a block used outside the provider (e.g. the operator run view)
// degrades silently rather than throwing — the effect just does nothing there.
const NOOP: ResourceDetailApi = { open: () => undefined };

const ResourceDetailContext = createContext<ResourceDetailApi | null>(null);

export function useResourceDetail(): ResourceDetailApi {
  return useContext(ResourceDetailContext) ?? NOOP;
}

export function ResourceDetailProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useT('apps');
  const [target, setTarget] = useState<ResourceDetailTarget | null>(null);
  const open = useCallback((next: ResourceDetailTarget) => setTarget(next), []);
  const api = useMemo<ResourceDetailApi>(() => ({ open }), [open]);

  return (
    <ResourceDetailContext.Provider value={api}>
      {children}
      <ResponsiveDialog
        open={target !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setTarget(null);
        }}
      >
        {target && (
          <ResponsiveDialogContent className="max-w-3xl">
            <ResponsiveDialogTitle>
              {target.title ?? t('detail.title')}
            </ResponsiveDialogTitle>
            <div className="mt-4">
              <SubjectRun
                subjectType={target.subjectType}
                subjectId={target.id}
              />
            </div>
          </ResponsiveDialogContent>
        )}
      </ResponsiveDialog>
    </ResourceDetailContext.Provider>
  );
}
