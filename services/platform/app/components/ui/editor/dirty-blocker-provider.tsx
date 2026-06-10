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

import { DirtySourceContext } from './use-dirty-source';

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

interface DirtyBlockerProviderProps {
  children: ReactNode;
  /**
   * When supplied, the navigation dialog renders a third "Save & Leave"
   * button that awaits this callback before proceeding. A failed save
   * keeps the user on the page and surfaces a destructive toast.
   * Pages with section-scoped saves (e.g. governance) omit it so the
   * dialog stays a two-button choice.
   */
  onSaveAll?: () => Promise<void>;
}

export function DirtyBlockerProvider({
  children,
  onSaveAll,
}: DirtyBlockerProviderProps) {
  const { t } = useT('common');
  const [sources, setSources] = useState<Map<string, boolean>>(() => new Map());
  const bypassRef = useRef(false);
  const [isSavingLeave, setIsSavingLeave] = useState(false);

  const anyDirty = useMemo(
    () => Array.from(sources.values()).some(Boolean),
    [sources],
  );

  const register = useCallback((id: string, dirty: boolean) => {
    setSources((prev) => {
      if (prev.get(id) === dirty) return prev;
      const next = new Map(prev);
      next.set(id, dirty);
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

  const blocker = useBlocker({
    shouldBlockFn: () => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return false;
      }
      return anyDirty;
    },
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

  const handleSaveAndLeave = useCallback(async () => {
    if (!onSaveAll) return;
    setIsSavingLeave(true);
    try {
      await onSaveAll();
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

  const description = onSaveAll
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
              {onSaveAll && (
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
