'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Center, Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  Check,
  ChevronDown,
  Loader2Icon,
  Trash2Icon,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Input } from '@/app/components/ui/forms/input';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { selectTriggerClasses } from '@/app/components/ui/forms/select';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { AssigneeAvatar } from '@/app/features/tasks/components/assignee-avatar';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useAuth } from '@/app/hooks/use-session-user';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

import {
  useComposeEmailConversation,
  useGenerateUploadUrl,
} from '../hooks/mutations';
import { useEmailConnectors } from '../hooks/queries';
import {
  emailDomain,
  isSenderAddressValid,
  supportsDynamicSender,
} from '../lib/email-connectors';
import { ContactRecipientPicker } from './contact-recipient-picker';
import { messageDraftKeys, type AttachedFile } from './message-editor/types';

// Milkdown is heavy; load it only once compose is open (mirrors the reply
// composer in the conversation panel).
const MessageEditor = lazyComponent(
  () =>
    import('./message-editor').then((mod) => ({ default: mod.MessageEditor })),
  {
    loading: () => (
      <Center className="p-4">
        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
      </Center>
    ),
  },
);

/** Prefixes / sentinels for the dual-dimension assign picker (person + team). */
const USER_PREFIX = 'user:';
const TEAM_PREFIX = 'team:';
const PEOPLE_HEADER = '__people_header__';
const TEAM_HEADER = '__team_header__';
const UNASSIGN_TEAM = '__unassign_team__';

/**
 * Build the full sender from an edited local part + the inbox's fixed domain.
 * Strips anything from an '@' on (defends against a pasted full address); an
 * empty local part yields '' so the sender falls back to the inbox default.
 */
function senderFromLocalPart(localPart: string, domain: string): string {
  const clean = localPart.replace(/@.*/, '').trim();
  return clean ? `${clean}@${domain}` : '';
}

export interface ComposeEmailPaneProps {
  organizationId: string;
  /** Seed the recipient (e.g. arriving from a contact row). */
  initialContactId?: string;
  /** Navigate to the created conversation after a successful send. */
  onSent: (conversationId: string) => void;
  /** Dismiss compose (keeps the draft — Discard clears it). */
  onClose: () => void;
}

interface UploadedAttachment {
  storageId: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Compose a brand-new outbound email, rendered IN the inbox reading pane where a
 * thread normally shows: the same header/scroll/footer skeleton as
 * `ConversationPanel`, with the reply composer (Milkdown) at the bottom.
 *
 * Draft lifecycle: every field (recipient, inbox, sender override, subject) plus
 * the body is persisted per user + org, so closing or navigating away and
 * reopening resumes the in-progress email. Arriving from a contact row seeds the
 * recipient. A successful send — and the explicit Discard — clear the whole
 * draft. The body draft is owned by `MessageEditor` (keyed via
 * {@link messageDraftKeys}); Discard clears that same key.
 *
 * "Empty" fields are stored as `''` rather than `null`: `usePersistedState`'s
 * type guard rejects a stored string when the initial value is `null`, which
 * would silently drop a restored recipient/inbox.
 */
export function ComposeEmailPane({
  organizationId,
  initialContactId,
  onSent,
  onClose,
}: ComposeEmailPaneProps) {
  const { t } = useT('conversations');
  const { user } = useAuth();
  const assignTriggerId = useId();
  const { emailConnectors, isLoading: connectorsLoading } =
    useEmailConnectors(organizationId);
  const { mutateAsync: composeEmail } = useComposeEmailConversation();
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();

  const draftPrefix = user?.userId
    ? `compose-${user.userId}-${organizationId}`
    : `compose-${organizationId}`;
  const composeBodyMessageId = `compose-${organizationId}`;

  const [contactId, setContactId, clearContactId] = usePersistedState(
    `${draftPrefix}-contact`,
    initialContactId ?? '',
  );
  const [connectorName, setConnectorName, clearConnectorName] =
    usePersistedState(`${draftPrefix}-inbox`, '');
  const [senderAddress, setSenderAddress, clearSenderAddress] =
    usePersistedState(`${draftPrefix}-sender`, '');
  const [subject, setSubject, clearSubject] = usePersistedState(
    `${draftPrefix}-subject`,
    '',
  );
  const [assigneeUserId, setAssigneeUserId, clearAssigneeUserId] =
    usePersistedState(`${draftPrefix}-assignee`, user?.userId ?? '');
  const [assigneeTeamId, setAssigneeTeamId, clearAssigneeTeamId] =
    usePersistedState(`${draftPrefix}-assignee-team`, '');
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  // Default the assignee to the creator once auth resolves (a fresh draft has no
  // stored value). Only admins can pick someone else or a team; the field is
  // read-only otherwise, and the server clamps a non-admin to self / no team.
  const { members = [] } = useMembers(organizationId);
  const { teams = [] } = useOrgTeams();
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const canReassign =
    !!memberContext &&
    'role' in memberContext &&
    (memberContext.role === 'admin' || memberContext.role === 'owner');
  useEffect(() => {
    if (!assigneeUserId && user?.userId) setAssigneeUserId(user.userId);
  }, [assigneeUserId, user?.userId, setAssigneeUserId]);

  const assignee = members.find((m) => m.userId === assigneeUserId);
  const assigneeName =
    assignee?.displayName ?? assignee?.email ?? assigneeUserId;
  const team = teams.find((tm) => tm.id === assigneeTeamId);
  const teamName = team?.name;

  // Shared-inbox model: person owner and team queue are independent. Trigger
  // shows both when both are set (team · person), matching the header picker.
  const assignTriggerLabel = useMemo(() => {
    const parts: string[] = [];
    if (teamName) parts.push(teamName);
    if (assigneeName) parts.push(assigneeName);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [teamName, assigneeName]);

  const assigneeOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = [];
    if (members.length > 0) {
      options.push({
        value: PEOPLE_HEADER,
        label: t('header.peopleSection'),
        isSectionHeader: true,
      });
      const sorted = [...members].sort((a, b) =>
        a.userId === user?.userId ? -1 : b.userId === user?.userId ? 1 : 0,
      );
      for (const member of sorted) {
        options.push({
          value: `${USER_PREFIX}${member.userId}`,
          label: member.displayName ?? member.email ?? member.userId,
          description:
            member.userId === user?.userId ? undefined : member.email,
          labelBadge:
            member.userId === user?.userId ? (
              <Badge variant="outline" className="text-[10px]">
                {t('compose.assignYou')}
              </Badge>
            ) : undefined,
        });
      }
    }
    if (teams.length > 0) {
      options.push({
        value: TEAM_HEADER,
        label: t('header.teamsSection'),
        isSectionHeader: true,
      });
      for (const tm of teams) {
        options.push({
          value: `${TEAM_PREFIX}${tm.id}`,
          label: tm.name,
        });
      }
    }
    return options;
  }, [members, teams, user?.userId, t]);

  // Seeded recipient (from a contact row) wins over a restored draft contact.
  useEffect(() => {
    if (initialContactId) setContactId(initialContactId);
  }, [initialContactId, setContactId]);

  const selectedConnector = useMemo(
    () => emailConnectors.find((i) => i.slug === connectorName) ?? null,
    [emailConnectors, connectorName],
  );

  // Once inboxes load: keep the persisted inbox only if it's still connected,
  // else auto-select the sole inbox (or clear when there's a choice to make).
  useEffect(() => {
    if (connectorsLoading) return;
    const stillConnected =
      connectorName !== '' &&
      emailConnectors.some((i) => i.slug === connectorName);
    if (stillConnected) return;
    setConnectorName(
      emailConnectors.length === 1 ? emailConnectors[0].slug : '',
    );
  }, [connectorsLoading, emailConnectors, connectorName, setConnectorName]);

  // Sender is an OVERRIDE over the inbox's configured address: empty means "use
  // the inbox default", so switching inbox (which clears the override) falls
  // back cleanly without an effect that could clobber a restored override.
  const senderDefault = selectedConnector?.fromAddress ?? '';
  const senderInputValue = senderAddress || senderDefault;
  // Only the local part is editable; the domain is fixed to the inbox's and
  // shown as a badge, so the address can never leave the verified domain.
  const senderLocalPart = senderInputValue.replace(/@.*/, '');
  const effectiveSender = senderAddress.trim() || senderDefault;
  const dynamicSender = supportsDynamicSender(selectedConnector);
  const senderDomain = senderDefault ? emailDomain(senderDefault) : '';
  const senderValid =
    !dynamicSender || isSenderAddressValid(effectiveSender, senderDomain);

  const hasEmailConnector = emailConnectors.length > 0;
  const canSend = Boolean(
    contactId &&
    connectorName &&
    subject.trim() &&
    hasEmailConnector &&
    senderValid,
  );

  const handleInboxChange = (slug: string) => {
    setConnectorName(slug);
    clearSenderAddress();
  };

  const clearDraftFields = useCallback(() => {
    clearContactId();
    clearConnectorName();
    clearSenderAddress();
    clearSubject();
    clearAssigneeUserId();
    clearAssigneeTeamId();
  }, [
    clearContactId,
    clearConnectorName,
    clearSenderAddress,
    clearSubject,
    clearAssigneeUserId,
    clearAssigneeTeamId,
  ]);

  const handleAssignChange = (value: string) => {
    if (value === PEOPLE_HEADER || value === TEAM_HEADER) return;
    if (value === UNASSIGN_TEAM) {
      clearAssigneeTeamId();
      setAssignOpen(false);
      return;
    }
    if (value.startsWith(USER_PREFIX)) {
      const next = value.slice(USER_PREFIX.length);
      if (next !== assigneeUserId) setAssigneeUserId(next);
      setAssignOpen(false);
      return;
    }
    if (value.startsWith(TEAM_PREFIX)) {
      const next = value.slice(TEAM_PREFIX.length);
      if (next !== assigneeTeamId) setAssigneeTeamId(next);
      setAssignOpen(false);
    }
  };

  const discardDraft = useCallback(() => {
    clearDraftFields();
    // The body/instruction drafts live inside MessageEditor's own persistence;
    // clear the same keys so a discard truly empties the composer on reopen.
    const keys = messageDraftKeys(user?.userId, composeBodyMessageId);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(keys.body);
        window.localStorage.removeItem(keys.improveInstruction);
      } catch (error) {
        console.warn('Failed to clear compose body draft:', error);
      }
    }
    onClose();
  }, [clearDraftFields, user?.userId, composeBodyMessageId, onClose]);

  const uploadAttachments = async (
    attachments: AttachedFile[],
  ): Promise<UploadedAttachment[]> => {
    const valid = attachments.filter((a) => a.file);
    return Promise.all(
      valid.map(async (attachment) => {
        const file = attachment.file;
        if (!file) throw new Error('missing file');
        const uploadUrl = await generateUploadUrl({});
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!result.ok) throw new Error('upload failed');
        const { storageId } = await result.json();
        if (typeof storageId !== 'string') throw new Error('upload failed');
        return {
          storageId: storageId,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        };
      }),
    );
  };

  const handleSend = async (
    message: string,
    attachments?: AttachedFile[],
    sourceMarkdown?: string,
  ) => {
    if (!contactId || !connectorName || !subject.trim()) return;

    let uploaded: UploadedAttachment[] | undefined;
    if (attachments && attachments.length > 0) {
      try {
        uploaded = await uploadAttachments(attachments);
      } catch (error) {
        console.error('Error uploading attachments:', error);
        toast({ title: t('compose.uploadFailed'), variant: 'destructive' });
        return;
      }
    }

    try {
      const result = await composeEmail({
        organizationId,
        contactId: contactId,
        connectorName,
        subject: subject.trim(),
        content: message,
        ...(sourceMarkdown ? { sourceMarkdown } : {}),
        ...(assigneeUserId ? { assigneeUserId } : {}),
        ...(assigneeTeamId ? { assigneeTeamId } : {}),
        ...(dynamicSender && effectiveSender ? { from: effectiveSender } : {}),
        ...(uploaded?.length ? { attachments: uploaded } : {}),
      });
      toast({ title: t('compose.sent'), variant: 'success' });
      // MessageEditor clears its own body draft on a successful send; clear the
      // field drafts here so a sent email never reappears as a draft.
      clearDraftFields();
      onSent(result.conversationId);
    } catch (error) {
      // Re-throw so MessageEditor keeps the draft and shows its own error toast.
      console.error('Failed to compose email:', error);
      throw error;
    }
  };

  return (
    <>
      <Stack gap={0} className="relative min-h-0 flex-1">
        <Stack gap={0} className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-border bg-background sticky top-0 z-20 border-b p-4 sm:px-6 sm:py-4">
            <Row justify="between" align="center" gap={2}>
              <Stack gap={0} className="min-w-0">
                <Text variant="label" className="truncate">
                  {t('compose.title')}
                </Text>
                <Text variant="muted" className="truncate text-xs">
                  {t('compose.description')}
                </Text>
              </Stack>
              <Row gap={1} className="shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2Icon}
                  onClick={() => setConfirmDiscardOpen(true)}
                >
                  {t('compose.discard')}
                </Button>
              </Row>
            </Row>
          </div>

          <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
            <Stack gap={4}>
              {/* The "who" first — external recipient, then internal owner. */}
              <ContactRecipientPicker
                organizationId={organizationId}
                value={contactId || null}
                onChange={setContactId}
              />

              <SearchableSelect
                label={t('compose.assignLabel')}
                id={assignTriggerId}
                // Two dimensions can be selected at once, so there is no single
                // controlled value — current picks are marked via optionAction.
                value={null}
                onValueChange={handleAssignChange}
                options={assigneeOptions}
                disabled={!canReassign}
                open={assignOpen}
                onOpenChange={setAssignOpen}
                placeholder={t('compose.assignPlaceholder')}
                searchPlaceholder={t('compose.assignSearch')}
                emptyText={t('header.noAssignees')}
                aria-label={t('compose.assignLabel')}
                trigger={
                  <button
                    type="button"
                    id={assignTriggerId}
                    disabled={!canReassign}
                    className={selectTriggerClasses()}
                  >
                    <span
                      className={cn(
                        'truncate',
                        !assignTriggerLabel && 'text-muted-foreground',
                      )}
                    >
                      {assignTriggerLabel ?? t('compose.assignPlaceholder')}
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 opacity-50"
                      aria-hidden="true"
                    />
                  </button>
                }
                optionAction={(opt) => {
                  if (opt.value.startsWith(USER_PREFIX)) {
                    const uid = opt.value.slice(USER_PREFIX.length);
                    return (
                      <span className="flex items-center gap-1.5">
                        {assigneeUserId === uid && (
                          <Check className="text-primary size-4 shrink-0" />
                        )}
                        <AssigneeAvatar
                          assigneeType="user"
                          assigneeId={uid}
                          name={opt.label}
                        />
                      </span>
                    );
                  }
                  if (opt.value.startsWith(TEAM_PREFIX)) {
                    const tid = opt.value.slice(TEAM_PREFIX.length);
                    return (
                      <span className="flex items-center gap-1.5">
                        {assigneeTeamId === tid && (
                          <Check className="text-primary size-4 shrink-0" />
                        )}
                        <Users
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden="true"
                        />
                      </span>
                    );
                  }
                  return null;
                }}
                footer={
                  assigneeTeamId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleAssignChange(UNASSIGN_TEAM)}
                    >
                      {t('header.unassignTeam')}
                    </Button>
                  ) : undefined
                }
              />

              <Input
                label={t('compose.subject')}
                required
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t('compose.subjectPlaceholder')}
              />

              {/* Sending details — demoted below the message fields; most orgs
                  have one inbox and a fixed sender, so this is usually empty. */}
              {connectorsLoading ? null : !hasEmailConnector ? (
                <Text variant="muted">{t('compose.noEmailConnector')}</Text>
              ) : (
                <>
                  {emailConnectors.length > 1 && (
                    <SearchableSelect
                      label={t('compose.inboxLabel')}
                      required
                      value={connectorName || null}
                      onValueChange={handleInboxChange}
                      options={emailConnectors.map((i) => ({
                        value: i.slug,
                        label: i.title,
                        description: i.fromAddress,
                      }))}
                      placeholder={t('compose.inboxPlaceholder')}
                      aria-label={t('compose.inboxLabel')}
                    />
                  )}

                  {selectedConnector &&
                    (dynamicSender ? (
                      <Input
                        label={t('compose.fromLabel')}
                        required
                        value={senderLocalPart}
                        onChange={(event) =>
                          setSenderAddress(
                            senderFromLocalPart(
                              event.target.value,
                              senderDomain,
                            ),
                          )
                        }
                        suffix={`@${senderDomain}`}
                        description={t('compose.fromDomainHint', {
                          domain: senderDomain,
                        })}
                        placeholder={t('compose.fromLocalPlaceholder')}
                      />
                    ) : (
                      <Text variant="muted">
                        {t('compose.from', {
                          from: selectedConnector.fromAddress
                            ? `${selectedConnector.title} <${selectedConnector.fromAddress}>`
                            : selectedConnector.title,
                        })}
                      </Text>
                    ))}
                </>
              )}
            </Stack>
          </div>
        </Stack>

        <PanelFooter className="px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <MessageEditor
              onSave={handleSend}
              placeholder={t('compose.bodyPlaceholder')}
              organizationId={organizationId}
              messageId={composeBodyMessageId}
              disabled={!canSend}
            />
            {hasEmailConnector && !canSend && (
              <Text variant="muted" className="mt-2 text-xs">
                {t('compose.fillRequired')}
              </Text>
            )}
          </div>
        </PanelFooter>
      </Stack>

      {confirmDiscardOpen && (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirmDiscardOpen(false);
          }}
          variant="destructive"
          title={t('compose.discardConfirm.title')}
          description={t('compose.discardConfirm.description')}
          confirmText={t('compose.discard')}
          onConfirm={discardDraft}
        />
      )}
    </>
  );
}
