'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { SavedBackupCodesDialog } from './saved-backup-codes-dialog';

interface BackupCodesContextValue {
  showBackupCodes: (codes: string[]) => void;
}

const BackupCodesContext = createContext<BackupCodesContextValue | null>(null);

/**
 * Hosts the "just-enrolled / just-regenerated backup codes" dialog at the
 * root of the app.
 *
 * Why root-level: the codes arrive the moment enrolment succeeds, which is
 * also the moment the two-factor status flips and `TwoFactorSection` swaps
 * its not-enrolled state for the enrolled one — unmounting the component
 * that asked to show them — and a layout error boundary's retry remounts
 * the whole settings page. If the dialog state lived inside that tree, the
 * backup codes would be wiped before the user sees them. Owning the state
 * above the dashboard keeps the dialog on screen throughout the transition.
 */
export function BackupCodesDialogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const showBackupCodes = useCallback((next: string[]) => setCodes(next), []);
  const value = useMemo(() => ({ showBackupCodes }), [showBackupCodes]);

  return (
    <BackupCodesContext.Provider value={value}>
      {children}
      {codes !== null && (
        <SavedBackupCodesDialog
          backupCodes={codes}
          onClose={() => setCodes(null)}
        />
      )}
    </BackupCodesContext.Provider>
  );
}

export function useShowBackupCodes(): BackupCodesContextValue['showBackupCodes'] {
  const ctx = useContext(BackupCodesContext);
  if (!ctx) {
    throw new Error(
      'useShowBackupCodes must be used within BackupCodesDialogProvider',
    );
  }
  return ctx.showBackupCodes;
}
