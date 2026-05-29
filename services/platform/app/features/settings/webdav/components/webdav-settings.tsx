import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Copy, Key, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useCreateWebdavAppPassword,
  useRevokeWebdavAppPassword,
  useWebdavAppPasswords,
  type WebdavAppPasswordId,
  type WebdavAppPasswordRow,
} from '../hooks/use-webdav-app-passwords';

interface WebdavSettingsProps {
  organizationId: string;
  orgSlug: string;
  siteOrigin: string;
}

export function WebdavSettings(props: WebdavSettingsProps) {
  const rows = useWebdavAppPasswords(props.organizationId);
  return (
    <Stack gap={6}>
      <ConnectionDetailsPanel
        orgSlug={props.orgSlug}
        siteOrigin={props.siteOrigin}
      />
      <CreateAppPasswordForm organizationId={props.organizationId} />
      <AppPasswordsTable organizationId={props.organizationId} rows={rows} />
    </Stack>
  );
}

function ConnectionDetailsPanel(props: {
  orgSlug: string;
  siteOrigin: string;
}) {
  const { t } = useT('webdav');
  const url = `${props.siteOrigin}/dav/${props.orgSlug}/documents/`;
  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-2 text-base font-medium">
        {t('connectionDetails.title', 'Connection details')}
      </h2>
      <p className="text-muted-foreground mb-3 text-sm">
        {t(
          'connectionDetails.description',
          'Use these in Finder, File Explorer, or any WebDAV client.',
        )}
      </p>
      <KeyValue label="URL" value={url} />
      <KeyValue
        label={t('connectionDetails.usernameLabel', 'Username')}
        value={t(
          'connectionDetails.usernameHelp',
          'Your Tale account email (or username)',
        )}
      />
      <KeyValue
        label={t('connectionDetails.passwordLabel', 'Password')}
        value={t(
          'connectionDetails.passwordHelp',
          'An app-password you generate below — not your account password.',
        )}
      />
    </section>
  );
}

function KeyValue(props: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-baseline gap-2 py-1 text-sm">
      <span className="w-24 shrink-0 font-medium">{props.label}:</span>
      <code className="flex-1 break-all">{props.value}</code>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(props.value);
          toast({ title: 'Copied' });
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function CreateAppPasswordForm(props: { organizationId: string }) {
  const { t } = useT('webdav');
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [revealed, setRevealed] = useState<{
    password: string;
    prefix: string;
  } | null>(null);
  const create = useCreateWebdavAppPassword();

  return (
    <section className="rounded-md border p-4">
      <h2 className="mb-2 text-base font-medium">
        {t('create.title', 'Generate a new app-password')}
      </h2>
      <p className="text-muted-foreground mb-3 text-sm">
        {t(
          'create.description',
          'Use one per device. The full password is only shown once — copy it before closing this dialog.',
        )}
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const trimmed = label.trim();
          if (!trimmed) return;
          try {
            const result = await create({
              organizationId: props.organizationId,
              label: trimmed,
            });
            setRevealed(result);
            setLabel('');
          } catch (err) {
            toast({
              title:
                err instanceof Error
                  ? err.message
                  : t('create.error', 'Failed to create app-password'),
              variant: 'destructive',
            });
          }
        }}
      >
        <input
          className="flex-1 rounded border px-2 py-1 text-sm"
          placeholder={t('create.labelPlaceholder', 'e.g. MacBook Finder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
        />
        <Button type="submit" disabled={!label.trim()}>
          <Key className="mr-1 h-4 w-4" />
          {t('create.submit', 'Generate')}
        </Button>
      </form>

      {revealed && (
        <div className="mt-4 rounded border border-yellow-500/40 bg-yellow-500/10 p-3">
          <p className="mb-2 text-sm font-medium">
            {t(
              'create.savedTitle',
              'Save this password — it will not be shown again.',
            )}
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-background flex-1 rounded p-2 text-xs break-all">
              {revealed.password}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.password);
                toast({ title: 'Copied' });
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {t('create.copy', 'Copy')}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setRevealed(null)}
          >
            {t('create.dismiss', 'I have saved it')}
          </Button>
        </div>
      )}
    </section>
  );
}

function AppPasswordsTable(props: {
  organizationId: string;
  rows: WebdavAppPasswordRow[];
}) {
  const { t } = useT('webdav');
  if (props.rows.length === 0) {
    return (
      <section className="text-muted-foreground rounded-md border p-4 text-sm">
        {t('list.empty', 'No app-passwords yet.')}
      </section>
    );
  }
  return (
    <section className="rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b text-left">
          <tr>
            <th className="p-3 font-medium">{t('list.label', 'Label')}</th>
            <th className="p-3 font-medium">{t('list.prefix', 'Prefix')}</th>
            <th className="p-3 font-medium">
              {t('list.lastUsed', 'Last used')}
            </th>
            <th className="p-3 font-medium">{t('list.created', 'Created')}</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <Row key={row._id} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Row({ row }: { row: WebdavAppPasswordRow }) {
  const { t } = useT('webdav');
  const { toast } = useToast();
  const revoke = useRevokeWebdavAppPassword();
  const isRevoked = row.revokedAt !== undefined;
  return (
    <tr className="border-b last:border-b-0">
      <td className="p-3">
        {row.label}
        {isRevoked && (
          <span className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">
            {t('list.revoked', 'revoked')}
          </span>
        )}
      </td>
      <td className="p-3 font-mono text-xs">{row.prefix}…</td>
      <td className="text-muted-foreground p-3 text-xs">
        {row.lastUsedAt
          ? new Date(row.lastUsedAt).toLocaleString()
          : t('list.neverUsed', 'never')}
      </td>
      <td className="text-muted-foreground p-3 text-xs">
        {new Date(row.createdAt).toLocaleDateString()}
      </td>
      <td className="p-3 text-right">
        {!isRevoked && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await revoke({ id: row._id as WebdavAppPasswordId });
                toast({ title: t('list.revokedToast', 'Revoked') });
              } catch (err) {
                toast({
                  title: err instanceof Error ? err.message : 'Failed',
                  variant: 'destructive',
                });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}
