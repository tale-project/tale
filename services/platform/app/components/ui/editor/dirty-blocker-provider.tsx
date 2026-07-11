'use client';

import { Button } from '@tale/ui/button';
import { useBlocker } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { DirtySourceContext, type DirtySourceEntry } from './use-dirty-source';

interface DirtyBlockerControl {
  /**
   * Skip the blocker on the very next navigation, then re-arm. Use for
   * forced redirects (logout, org switch, billing redirect). Never for
   * regular product flows — that's exactly the silent-data-loss path the
   * blocker exists to prevent.
   */
  bypassNext: () => void;
}

const DirtyBlockerControlContext = createContext<DirtyBlockerControl | null>(
  null,
);

export function useDirtyBlockerControl(): DirtyBlockerControl {
  const ctx = useContext(DirtyBlockerControlContext);
  if (!ctx) {
    throw new Error(
      'useDirtyBlockerControl must be used inside a DirtyBlockerProvider',
    );
  }
  return ctx;
}

/**
 * Whether a navigation to `pathname` stays inside a source's scope — the
 * route subtree in which the source's state survives (see
 * `DirtySourceEntry.scopePath`). Boundary-aware so `/agents/foo` never
 * claims `/agents/foobar`.
 */
function isWithinScope(scopePath: string, pathname: string): boolean {
  return pathname === scopePath || pathname.startsWith(`${scopePath}/`);
}

interface DirtyBlockerProviderProps {
  children: ReactNode;
  /**
   * When supplied, the navigation dialog renders a third "Save & Leave"
   * button that awaits this callback before proceeding. A failed save
   * keeps the user on the page and surfaces a destructive toast.
   * Pages with section-scoped saves (e.g. governance) omit it so the
   * dialog stays a two-button choice. Without it, "Save & Leave" is still
   * offered whenever EVERY dirty source registered its own `save`.
   */
  onSaveAll?: () => Promise<void>;
}

export function DirtyBlockerProvider({
  children,
  onSaveAll,
}: DirtyBlockerProviderProps) {
  const { t } = useT('common');
  const [sources, setSources] = useState<Map<string, DirtySourceEntry>>(
    () => new Map(),
  );
  const bypassRef = useRef(false);
  const [isSavingLeave, setIsSavingLeave] = useState(false);

  const anyDirty = useMemo(
    () => Array.from(sources.values()).some((entry) => entry.dirty),
    [sources],
  );

  const register = useCallback((id: string, entry: DirtySourceEntry) => {
    setSources((prev) => {
      const existing = prev.get(id);
      if (
        existing &&
        existing.dirty === entry.dirty &&
        existing.scopePath === entry.scopePath &&
        existing.save === entry.save
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(id, entry);
      return next;
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setSources((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const sourceRegistry = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );

  // Read at shouldBlockFn time through a ref — the blocker's callback is
  // registered once and must always see the current registry.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return false;
      }
      // A dirty source only blocks navigations that LEAVE its scope; a
      // scoped source's state survives inside it (e.g. switching tabs of
      // the same agent). Sources without a scope block every navigation.
      return Array.from(sourcesRef.current.values()).some(
        (entry) =>
          entry.dirty &&
          (entry.scopePath === undefined ||
            !isWithinScope(entry.scopePath, next.pathname)),
      );
    },
    // A reload/close always drops in-memory state, scoped or not.
    enableBeforeUnload: () => anyDirty,
    withResolver: true,
  });

  const control = useMemo<DirtyBlockerControl>(
    () => ({
      bypassNext: () => {
        bypassRef.current = true;
      },
    }),
    [],
  );

  const handleStay = useCallback(() => {
    blocker.reset?.();
  }, [blocker]);

  const handleDiscardAndLeave = useCallback(() => {
    // Drop every registered dirty flag before proceeding. The user chose to
    // discard, so this can't lose work — and it makes `anyDirty` false
    // immediately, so a re-evaluation of `shouldBlockFn` during the in-flight
    // navigation can't re-arm the blocker and prompt a second time. A later
    // edit re-registers the source via its own effect.
    setSources((prev) => (prev.size === 0 ? prev : new Map()));
    blocker.proceed?.();
  }, [blocker]);

  // "Save & Leave" is available when the page supplied a save-all, or when
  // every DIRTY source registered its own save path (an invalid draft
  // deliberately registers none, so the dialog degrades to Stay/Discard).
  const dirtyEntries = useMemo(
    () => Array.from(sources.values()).filter((entry) => entry.dirty),
    [sources],
  );
  const canSaveAndLeave =
    onSaveAll !== undefined ||
    (dirtyEntries.length > 0 &&
      dirtyEntries.every((entry) => entry.save !== undefined));

  const handleSaveAndLeave = useCallback(async () => {
    setIsSavingLeave(true);
    try {
      if (onSaveAll) {
        await onSaveAll();
      } else {
        // Sequential (not parallel) so a failure stops before later saves
        // commit — the surviving dirty flags keep the remaining edits armed.
        for (const entry of sourcesRef.current.values()) {
          if (entry.dirty && entry.save) await entry.save();
        }
      }
      // Mirror discard: clear the registry so an in-flight re-evaluation of
      // `shouldBlockFn` can't re-prompt while the saved sources' effects are
      // still catching up.
      setSources((prev) => (prev.size === 0 ? prev : new Map()));
      blocker.proceed?.();
    } catch (err) {
      blocker.reset?.();
      toast({
        title: t('actions.save'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setIsSavingLeave(false);
    }
  }, [blocker, onSaveAll, t]);

  const description = canSaveAndLeave
    ? t('unsavedChanges.descriptionThreeButton')
    : t('unsavedChanges.descriptionTwoButton');

  return (
    <DirtyBlockerControlContext.Provider value={control}>
      <DirtySourceContext.Provider value={sourceRegistry}>
        {children}
        <Dialog
          open={blocker.status === 'blocked'}
          onOpenChange={(open) => {
            if (!open) handleStay();
          }}
          title={t('unsavedChanges.title')}
          description={description}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={handleStay}
                disabled={isSavingLeave}
              >
                {t('unsavedChanges.stay')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDiscardAndLeave}
                disabled={isSavingLeave}
              >
                {t('unsavedChanges.discardAndLeave')}
              </Button>
              {canSaveAndLeave && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handleSaveAndLeave()}
                  isLoading={isSavingLeave}
                  autoFocus
                >
                  {t('unsavedChanges.saveAndLeave')}
                </Button>
              )}
            </>
          }
        />
      </DirtySourceContext.Provider>
    </DirtyBlockerControlContext.Provider>
  );
}
