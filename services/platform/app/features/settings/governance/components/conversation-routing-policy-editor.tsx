'use client';

import {
  conversationRoutingConfigSchema,
  type ConversationRoutingConfig,
} from '@tale/shared/schemas/governance';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Label } from '@tale/ui/label';
import { Row, Stack } from '@tale/ui/layout';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { useNavigate, Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Signpost,
  Trash2,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EMAIL_PROVIDER_SLUGS,
  useMailboxes,
} from '@/app/features/conversations/hooks/queries';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { AssigneeAvatar } from '@/app/features/tasks/components/assignee-avatar';
import { useAbility } from '@/app/hooks/use-ability';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../config-parser';
import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';
import { RulesTableEmptyState } from './rules-table-empty-state';

// One sectioned picker carries both target dimensions (like the conversation
// assignee selector): the prefixes route a pick to the team or the person, and
// the sentinels drive the per-dimension clears.
const USER_PREFIX = 'user:';
const TEAM_PREFIX = 'team:';
const PEOPLE_HEADER = '__routing_people__';
const TEAM_HEADER = '__routing_team__';
const REMOVE_USER = '__routing_remove_user__';
const REMOVE_TEAM = '__routing_remove_team__';
const PLACEHOLDER_ROW_COUNT = 2;
// Loose client-side email check — the backend Zod schema (`z.string().email()`)
// is the authority; this only gates the dialog's submit button.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseConfig = createConfigParser(conversationRoutingConfigSchema, () => ({
  rules: [],
  sourceRules: [],
}));

// Where a rule applies, as the dialog's "Arrives on" picker names it: every
// mailbox (an address rule, stored in `rules`), one mailbox, or one API app
// (both stored in `sourceRules`).
const ANY_MAILBOX = 'any';
const MAILBOX_PREFIX = 'mailbox:';
const API_PREFIX = 'api:';
const MAILBOXES_HEADER = '__routing_mailboxes__';
const API_HEADER = '__routing_api__';

/** One row of the editor, over both of the file's rule arrays. */
interface EditorRule {
  arrivesOn: string;
  /** The address it was sent to; empty for "any address". */
  address: string;
  teamId?: string;
  userId?: string;
}

function targetOf(rule: { teamId?: string; userId?: string }) {
  return {
    ...(rule.teamId ? { teamId: rule.teamId } : {}),
    ...(rule.userId ? { userId: rule.userId } : {}),
  };
}

function editorRulesOf(config: ConversationRoutingConfig): EditorRule[] {
  return [
    ...config.rules.map((rule) => ({
      arrivesOn: ANY_MAILBOX,
      address: rule.address,
      ...targetOf(rule),
    })),
    ...config.sourceRules.map((rule) => ({
      arrivesOn:
        rule.mailbox !== undefined
          ? `${MAILBOX_PREFIX}${rule.mailbox}`
          : `${API_PREFIX}${rule.apiSource ?? ''}`,
      address: rule.address ?? '',
      ...targetOf(rule),
    })),
  ];
}

/** The file both arrays are saved to: any-mailbox address rules in `rules`,
 *  the rest in `sourceRules`, each keeping the editor's order. */
function configOf(
  rules: readonly EditorRule[],
  enabled: boolean,
): ConversationRoutingConfig {
  const config: ConversationRoutingConfig = {
    enabled,
    rules: [],
    sourceRules: [],
  };
  for (const rule of rules) {
    const address = rule.address.trim();
    if (rule.arrivesOn === ANY_MAILBOX) {
      config.rules.push({ address, ...targetOf(rule) });
    } else if (rule.arrivesOn.startsWith(MAILBOX_PREFIX)) {
      config.sourceRules.push({
        mailbox: rule.arrivesOn.slice(MAILBOX_PREFIX.length),
        ...(address !== '' ? { address } : {}),
        ...targetOf(rule),
      });
    } else {
      config.sourceRules.push({
        apiSource: rule.arrivesOn.slice(API_PREFIX.length),
        ...targetOf(rule),
      });
    }
  }
  return config;
}

/** Two rules that match the same conversations. */
function ruleKey(rule: EditorRule): string {
  return `${rule.arrivesOn}|${rule.address.trim().toLowerCase()}`;
}

function emptyRule(): EditorRule {
  return { arrivesOn: ANY_MAILBOX, address: '' };
}

interface Option {
  value: string;
  label: string;
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: EditorRule;
  onSave: (rule: EditorRule) => void;
  title: string;
  /** Orient handoff visitors: why this page, where rules live. */
  description?: string;
  cannotManage: boolean;
  teamOptions: Option[];
  memberOptions: Option[];
  arrivesOnOptions: SearchableSelectOption[];
  /** Whether another rule already matches the same conversations. */
  isDuplicate: (rule: EditorRule) => boolean;
}

function RuleDialog({
  open,
  onOpenChange,
  rule: initialRule,
  onSave,
  title,
  description,
  cannotManage,
  teamOptions,
  memberOptions,
  arrivesOnOptions,
  isDuplicate,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) setDraft(initialRule);
  }, [open, initialRule]);

  // People + Teams in one sectioned list — sections render only when non-empty.
  const selectOptions = useMemo<SearchableSelectOption[]>(() => {
    const opts: SearchableSelectOption[] = [];
    if (memberOptions.length > 0) {
      opts.push({
        value: PEOPLE_HEADER,
        label: t('conversationRouting.peopleSection'),
        isSectionHeader: true,
      });
      for (const m of memberOptions) {
        opts.push({ value: `${USER_PREFIX}${m.value}`, label: m.label });
      }
    }
    if (teamOptions.length > 0) {
      opts.push({
        value: TEAM_HEADER,
        label: t('conversationRouting.teamsSection'),
        isSectionHeader: true,
      });
      for (const tm of teamOptions) {
        opts.push({ value: `${TEAM_PREFIX}${tm.value}`, label: tm.label });
      }
    }
    return opts;
  }, [memberOptions, teamOptions, t]);

  const teamName = teamOptions.find((o) => o.value === draft.teamId)?.label;
  const personName = memberOptions.find((o) => o.value === draft.userId)?.label;

  // Pick from either section to set that dimension; the sentinels clear one.
  const handleSelect = useCallback((value: string) => {
    if (value === REMOVE_USER) {
      setDraft((d) => ({ ...d, userId: undefined }));
      return;
    }
    if (value === REMOVE_TEAM) {
      setDraft((d) => ({ ...d, teamId: undefined }));
      return;
    }
    if (value.startsWith(USER_PREFIX)) {
      setDraft((d) => ({ ...d, userId: value.slice(USER_PREFIX.length) }));
      return;
    }
    if (value.startsWith(TEAM_PREFIX)) {
      setDraft((d) => ({ ...d, teamId: value.slice(TEAM_PREFIX.length) }));
    }
  }, []);

  // An API app has no address to narrow by; any mailbox needs one, or the
  // rule would catch every email.
  const isApi = draft.arrivesOn.startsWith(API_PREFIX);
  const address = isApi ? '' : draft.address.trim();
  const addressTyped = address !== '';
  const addressValid = addressTyped
    ? EMAIL_RE.test(address)
    : draft.arrivesOn !== ANY_MAILBOX;
  const hasTarget = Boolean(draft.teamId || draft.userId);
  const duplicate = isDuplicate({ ...draft, address });
  const isValid = addressValid && hasTarget && !duplicate;

  const handleArrivesOnChange = useCallback((value: string) => {
    if (value === MAILBOXES_HEADER || value === API_HEADER) return;
    setDraft((d) => ({ ...d, arrivesOn: value }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid) return;
      onSave({
        arrivesOn: draft.arrivesOn,
        address,
        ...(draft.teamId ? { teamId: draft.teamId } : {}),
        ...(draft.userId ? { userId: draft.userId } : {}),
      });
      onOpenChange(false);
    },
    [draft, address, isValid, onSave, onOpenChange],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onSubmit={handleSubmit}
      submitText={t('conversationRouting.confirm')}
      isValid={isValid}
    >
      <Stack gap={4}>
        <SearchableSelect
          label={t('conversationRouting.arrivesOn')}
          value={draft.arrivesOn}
          onValueChange={handleArrivesOnChange}
          options={arrivesOnOptions}
          disabled={cannotManage}
          modal
          align="start"
          aria-label={t('conversationRouting.arrivesOn')}
        />
        {isApi ? (
          duplicate ? (
            <Text variant="error" role="alert">
              {t('conversationRouting.duplicateRule')}
            </Text>
          ) : null
        ) : (
          <Input
            label={t('conversationRouting.sentTo')}
            type="email"
            placeholder={t('conversationRouting.addressPlaceholder')}
            value={draft.address}
            onChange={(e) =>
              setDraft((d) => ({ ...d, address: e.target.value }))
            }
            disabled={cannotManage}
            description={t('conversationRouting.sentToHint')}
            isInvalid={(addressTyped && !addressValid) || duplicate}
            errorMessage={
              addressTyped && !addressValid
                ? t('conversationRouting.invalidAddress')
                : duplicate
                  ? t('conversationRouting.duplicateRule')
                  : undefined
            }
          />
        )}
        <Stack gap={2}>
          <Label>{t('conversationRouting.routeTo')}</Label>
          <SearchableSelect
            value={null}
            onValueChange={handleSelect}
            options={selectOptions}
            disabled={cannotManage}
            modal
            align="start"
            searchPlaceholder={t('conversationRouting.searchAssignees')}
            emptyText={t('conversationRouting.noAssignees')}
            aria-label={t('conversationRouting.routeTo')}
            trigger={
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-between"
                disabled={cannotManage}
                aria-label={t('conversationRouting.routeTo')}
              >
                {draft.teamId || draft.userId ? (
                  <span className="flex items-center gap-2">
                    {draft.teamId ? (
                      <span className="flex items-center gap-1.5">
                        <Users className="text-muted-foreground size-4 shrink-0" />
                        <span className="max-w-[9rem] truncate text-sm">
                          {teamName ?? draft.teamId}
                        </span>
                      </span>
                    ) : null}
                    {draft.userId ? (
                      <span className="flex items-center gap-1.5">
                        <AssigneeAvatar
                          assigneeType="user"
                          assigneeId={draft.userId}
                          name={personName}
                          size="sm"
                        />
                        <span className="max-w-[9rem] truncate text-sm">
                          {personName ?? draft.userId}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {t('conversationRouting.routeToPlaceholder')}
                  </span>
                )}
                <ChevronDown className="text-muted-foreground size-4 shrink-0" />
              </Button>
            }
            optionAction={(opt) => {
              if (opt.value.startsWith(USER_PREFIX)) {
                return draft.userId === opt.value.slice(USER_PREFIX.length) ? (
                  <Check className="text-primary size-4 shrink-0" />
                ) : null;
              }
              if (opt.value.startsWith(TEAM_PREFIX)) {
                return draft.teamId === opt.value.slice(TEAM_PREFIX.length) ? (
                  <Check className="text-primary size-4 shrink-0" />
                ) : null;
              }
              return null;
            }}
            footer={
              draft.userId || draft.teamId ? (
                <div className="flex flex-col">
                  {draft.userId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleSelect(REMOVE_USER)}
                    >
                      {t('conversationRouting.removePerson')}
                    </Button>
                  ) : null}
                  {draft.teamId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleSelect(REMOVE_TEAM)}
                    >
                      {t('conversationRouting.removeTeam')}
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        </Stack>
      </Stack>
    </FormDialog>
  );
}

interface ConversationRoutingPolicyEditorProps {
  organizationId: string;
  /** One-shot deep link: open the Add rule dialog (from inbox Auto assign). */
  openAddRule?: boolean;
  /** Prefill for the Sent to field when `openAddRule` is set. */
  initialAddress?: string;
  /** Prefill for Arrives on (`mailbox:<id>` or `api:<source>`) when
   *  `openAddRule` is set. */
  initialArrivesOn?: string;
  /** Return target while the Auto assign handoff is in flight. */
  returnToConversation?: {
    id: string;
    status: 'open' | 'closed' | 'spam' | 'archived';
  };
}

/**
 * Editor for the `conversation_routing` policy — per-org rules mapping where
 * a new conversation arrives (any mailbox with an address, one mailbox with
 * or without one, or an API app) to a team and/or a person. The built-in
 * ingest hook (`applyConversationRouting`) reads these to auto-assign new
 * conversations. Mirrors the model-access editor's rules-table + dialog
 * pattern; both rule arrays are saved on every add/edit/remove.
 */
export function ConversationRoutingPolicyEditor({
  organizationId,
  openAddRule = false,
  initialAddress,
  initialArrivesOn,
  returnToConversation,
}: ConversationRoutingPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();
  const navigate = useNavigate();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'conversation_routing',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();

  const teamOptions = useMemo<Option[]>(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );
  const memberOptions = useMemo<Option[]>(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.displayName || m.email || m.userId,
      })),
    [members],
  );

  const { mailboxes: allMailboxes } = useMailboxes();
  const mailboxes = useMemo(
    () =>
      allMailboxes.filter((entry) =>
        EMAIL_PROVIDER_SLUGS.has(entry.connectorSlug),
      ),
    [allMailboxes],
  );
  const { data: apiSources } = useBackendQuery(
    'conversations/queries:apiSources',
    organizationId ? { organizationId } : 'skip',
  );

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);
  const savedRules = useMemo(() => editorRulesOf(savedConfig), [savedConfig]);
  // Absent flag means "decide from the rules": an org that configured routing
  // before the toggle existed keeps it, a fresh org (no rules) reads off.
  const savedEnabled = savedConfig.enabled ?? savedRules.length > 0;

  const initializedRef = useRef(false);
  const [rules, setRules] = useState<EditorRule[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
  // True for the Add rule open that came from inbox Auto assign — drives the
  // orienting dialog description so visitors learn this page is the home of
  // the feature.
  const [fromHandoff, setFromHandoff] = useState(false);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setRules(savedRules);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');
  const loading = isLoading || !initializedRef.current;
  const isPending = upsertMutation.isPending;

  // The section's toggle. Rules survive it being switched off, so turning
  // routing back on restores them; ingest short-circuits on an explicit
  // `enabled: false` server-side either way.
  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'conversation_routing',
    savedEnabled,
    isLoading: loading,
    buildConfig: (next) => configOf(savedRules, next),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('conversationRouting.saveFailed'),
  });

  const saveRules = useCallback(
    (next: EditorRule[], revert: () => void) => {
      setRules(next);
      upsertMutation.mutate(
        {
          organizationId,
          policyType: 'conversation_routing',
          // A rule edit is only reachable while the section is on.
          config: configOf(next, true),
        },
        {
          onSuccess: () =>
            toast({
              title: t('toastSavedTitle'),
              description: t('conversationRouting.saved'),
              variant: 'success',
            }),
          onError: (error) => {
            revert();
            toast({
              title: t('toastSaveFailedTitle'),
              description: mapGovernanceSaveError(
                error,
                t,
                t('conversationRouting.saveFailed'),
              ),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [organizationId, upsertMutation, toast, t],
  );

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setFromHandoff(false);
    setDialogRule(emptyRule());
    setDialogOpen(true);
  }, []);

  // Inbox Auto assign handoff: open Add rule once with the thread address from
  // history state, strip open/address so refresh does not reopen, but keep
  // `returnToConversation` until Back is clicked.
  useEffect(() => {
    if (!openAddRule) return;
    setEditingIndex(null);
    setFromHandoff(true);
    const arrivesOn = initialArrivesOn ?? ANY_MAILBOX;
    setDialogRule({
      arrivesOn,
      address: arrivesOn.startsWith(API_PREFIX)
        ? ''
        : (initialAddress?.trim() ?? ''),
    });
    setDialogOpen(true);
    void navigate({
      to: '/dashboard/$id/settings/governance/policies-limits',
      params: { id: organizationId },
      hash: 'conversation-routing',
      state: (prev) => {
        const next = { ...prev };
        delete next.openRoutingRule;
        delete next.routingAddress;
        delete next.routingArrivesOn;
        return next;
      },
      replace: true,
    });
  }, [openAddRule, initialAddress, initialArrivesOn, navigate, organizationId]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) setFromHandoff(false);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setDialogRule(rules[index]);
      setDialogOpen(true);
    },
    [rules],
  );

  const handleDialogSave = useCallback(
    (rule: EditorRule) => {
      const prev = rules;
      const next =
        editingIndex === null
          ? [...rules, rule]
          : rules.map((r, i) => (i === editingIndex ? rule : r));
      saveRules(next, () => setRules(prev));
    },
    [editingIndex, rules, saveRules],
  );

  const confirmRemove = useCallback(() => {
    if (deletingIndex === null) return;
    const prev = rules;
    const next = rules.filter((_, i) => i !== deletingIndex);
    setDeletingIndex(null);
    saveRules(next, () => setRules(prev));
  }, [deletingIndex, rules, saveRules]);

  const isDuplicate = useCallback(
    (candidate: EditorRule) =>
      rules.some(
        (rule, index) =>
          index !== editingIndex && ruleKey(rule) === ruleKey(candidate),
      ),
    [rules, editingIndex],
  );

  const arrivesOnLabel = useCallback(
    (arrivesOn: string): string => {
      if (arrivesOn === ANY_MAILBOX) {
        return t('conversationRouting.anyMailbox');
      }
      if (arrivesOn.startsWith(API_PREFIX)) {
        return t('conversationRouting.apiSource', {
          source: arrivesOn.slice(API_PREFIX.length),
        });
      }
      const id = arrivesOn.slice(MAILBOX_PREFIX.length);
      return (
        mailboxes.find((entry) => entry.id === id)?.name ??
        t('conversationRouting.removedMailbox')
      );
    },
    [mailboxes, t],
  );

  // Any mailbox, then each mailbox by name (its address beneath), then each
  // API app that has synced a conversation. A rule already naming a mailbox
  // or app that is gone keeps its entry, so editing it does not lose it.
  const arrivesOnOptions = useMemo<SearchableSelectOption[]>(() => {
    const options: SearchableSelectOption[] = [
      { value: ANY_MAILBOX, label: t('conversationRouting.anyMailbox') },
    ];
    const listed = new Set<string>([ANY_MAILBOX]);
    const mailboxValues = mailboxes.map((entry) => {
      const value = `${MAILBOX_PREFIX}${entry.id}`;
      listed.add(value);
      const fromAddress = entry.config?.fromAddress;
      return {
        value,
        label: entry.name,
        ...(typeof fromAddress === 'string' && fromAddress !== ''
          ? { description: fromAddress }
          : {}),
      };
    });
    const apiValues = (apiSources ?? []).map((source) => {
      const value = `${API_PREFIX}${source}`;
      listed.add(value);
      return { value, label: arrivesOnLabel(value) };
    });
    const stale = [...rules, dialogRule]
      .map((rule) => rule.arrivesOn)
      .filter((value) => !listed.has(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .map((value) => ({ value, label: arrivesOnLabel(value) }));
    const staleMailboxes = stale.filter((o) =>
      o.value.startsWith(MAILBOX_PREFIX),
    );
    const staleApi = stale.filter((o) => o.value.startsWith(API_PREFIX));
    if (mailboxValues.length + staleMailboxes.length > 0) {
      options.push(
        {
          value: MAILBOXES_HEADER,
          label: t('conversationRouting.mailboxesSection'),
          isSectionHeader: true,
        },
        ...mailboxValues,
        ...staleMailboxes,
      );
    }
    if (apiValues.length + staleApi.length > 0) {
      options.push(
        {
          value: API_HEADER,
          label: t('conversationRouting.apiSection'),
          isSectionHeader: true,
        },
        ...apiValues,
        ...staleApi,
      );
    }
    return options;
  }, [mailboxes, apiSources, rules, dialogRule, arrivesOnLabel, t]);

  const resolveTargets = useCallback(
    (rule: EditorRule): string => {
      const parts: string[] = [];
      if (rule.teamId) {
        parts.push(
          teamOptions.find((o) => o.value === rule.teamId)?.label ??
            rule.teamId,
        );
      }
      if (rule.userId) {
        parts.push(
          memberOptions.find((o) => o.value === rule.userId)?.label ??
            rule.userId,
        );
      }
      return parts.length > 0 ? parts.join(' · ') : '—';
    },
    [teamOptions, memberOptions],
  );

  return (
    <Skeletonize loading={loading} label={t('conversationRouting.title')}>
      <SettingsSection
        id="conversation-routing"
        title={t('conversationRouting.title')}
        description={t('conversationRouting.description')}
        action={
          <Switch
            aria-label={t('conversationRouting.title')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={cannotManage || isToggling}
          />
        }
      >
        {returnToConversation ? (
          <Link
            to="/dashboard/$id/conversations/$status"
            params={{
              id: organizationId,
              status: returnToConversation.status,
            }}
            search={{ conversation: returnToConversation.id }}
            className="text-muted-foreground hover:text-foreground mb-4 inline-flex w-fit items-center gap-1.5 text-sm"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
            {t('conversationRouting.backToConversation')}
          </Link>
        ) : null}
        {/* The rules table exists only while the section is on — a toggle
            hides its content rather than showing rules nothing applies. It
            stays mounted (masked) while loading so the skeleton keeps the
            real shape. Add rule sits under the table, where Model access has
            it. */}
        {(loading || enabled) && (
          <Stack gap={4}>
            <Row justify="between" align="start" gap={4}>
              <Text variant="muted">{t('conversationRouting.precedence')}</Text>
              <Button
                variant="primary"
                onClick={openAddDialog}
                disabled={cannotManage || isPending}
                className="shrink-0"
              >
                <Signpost className="mr-1.5 size-4" />
                {t('conversationRouting.addRule')}
              </Button>
            </Row>
            <Card padding="none" className="overflow-hidden">
              <Table aria-label={t('conversationRouting.title')}>
                <TableCaption className="sr-only">
                  {t('conversationRouting.title')}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('conversationRouting.arrivesOn')}</TableHead>
                    <TableHead>{t('conversationRouting.sentTo')}</TableHead>
                    <TableHead>{t('conversationRouting.assignedTo')}</TableHead>
                    <TableHead className="text-right">
                      {t('conversationRouting.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from(
                      { length: PLACEHOLDER_ROW_COUNT },
                      (_, index) => (
                        <TableRow key={`skeleton-${index}`} data-no-hover>
                          <TableCell>
                            <div className="w-32">
                              <SkeletonText />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="w-40">
                              <SkeletonText />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="w-28">
                              <SkeletonText />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t('conversationRouting.deleteRule')}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ),
                    )
                  ) : rules.length > 0 ? (
                    rules.map((rule, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            className="hover:underline disabled:no-underline"
                            onClick={() => openEditDialog(index)}
                            disabled={cannotManage}
                          >
                            {arrivesOnLabel(rule.arrivesOn)}
                          </button>
                        </TableCell>
                        <TableCell>
                          {rule.arrivesOn.startsWith(API_PREFIX)
                            ? '—'
                            : rule.address ||
                              t('conversationRouting.anyAddress')}
                        </TableCell>
                        <TableCell>{resolveTargets(rule)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingIndex(index)}
                            disabled={cannotManage}
                            title={t('conversationRouting.deleteRule')}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow data-no-hover>
                      <TableCell colSpan={4} className="p-0">
                        <RulesTableEmptyState
                          icon={Signpost}
                          title={t('conversationRouting.noRulesTitle')}
                          description={t(
                            'conversationRouting.noRulesDescription',
                          )}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </Stack>
        )}

        {dialogOpen && (
          <RuleDialog
            open={dialogOpen}
            onOpenChange={handleDialogOpenChange}
            rule={dialogRule}
            onSave={handleDialogSave}
            title={
              editingIndex === null
                ? t('conversationRouting.addRule')
                : t('conversationRouting.editRule')
            }
            description={
              fromHandoff && editingIndex === null
                ? t('conversationRouting.handoffAddRuleDescription')
                : undefined
            }
            cannotManage={cannotManage}
            teamOptions={teamOptions}
            memberOptions={memberOptions}
            arrivesOnOptions={arrivesOnOptions}
            isDuplicate={isDuplicate}
          />
        )}

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingIndex(null);
          }}
          title={t('conversationRouting.removeRuleConfirmTitle')}
          description={t('conversationRouting.removeRuleConfirmDescription')}
          confirmText={t('conversationRouting.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={confirmRemove}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
