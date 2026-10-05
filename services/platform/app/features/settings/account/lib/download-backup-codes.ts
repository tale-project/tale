import { getEnv } from '@/lib/env';
import { authenticatorName } from '@/lib/shared/authenticator-name';

/**
 * The file a set of backup codes is saved as, named after the authenticator
 * entry the codes stand in for: `acme-tale-platform-te-backup-codes.txt` on
 * a client's test deployment, `tale-platform-backup-codes.txt` on Tale's own
 * production one.
 */
export function backupCodesFileName(): string {
  const { fileSlug } = authenticatorName({
    clientName: getEnv('TOTP_CLIENT_NAME'),
    environment: getEnv('TOTP_ENVIRONMENT'),
  });
  return `${fileSlug}-backup-codes.txt`;
}

/**
 * Saves the codes one per line. Shared by the enrollment wall and the
 * account settings, which hand out the same codes.
 */
export function downloadBackupCodes(codes: string[]): void {
  const blob = new Blob([codes.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupCodesFileName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
