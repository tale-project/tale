'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { z } from 'zod';

import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { primeAudio } from '@/app/features/chat/utils/prime-audio';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useUpsertGovernancePolicy } from '@/app/features/settings/governance/hooks/mutations';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import {
  useApprovePendingMemory,
  useDismissPendingMemory,
  useSetCustomInstructionsEnabled,
  useSetMemoriesEnabled,
  useSoftDeleteMemory,
  useUpsertMyPreferences,
} from '../hooks/mutations';

const CUSTOM_INSTRUCTIONS_MAX_CHARS = 4000;

/**
 * Module-level capability-probe cache keyed by `organizationId`.
 *
 * `getCapability` is a Node `action` rate-limited at 12/min/user. The
 * settings page re-mounts on every navigation (route change, StrictMode
 * double-invoke) and the probe burns a token each time — a few quick
 * tab swaps and the limiter trips, the catch branch silently flips the
 * UI to "provider unavailable", and the user sees a false negative.
 *
 * Caching the in-flight promise per org collapses repeated mounts to
 * one network call. Result is also cached so a remount within the
 * same session reuses the resolved value without re-issuing the
 * action. Cache is in-memory only — page reload re-probes, which is
 * correct (admin may have wired up a provider in another tab).
 *
 * Phase 5 (deferred) converts `getCapability` to a Convex `query` so
 * this cache becomes unnecessary.
 */
type CapabilityProbe = (args: {
  organizationId: string;
}) => Promise<{ available: boolean }>;

const capabilityProbeCache = new Map<string, Promise<{ available: boolean }>>();

function isTransientProbeError(err: unknown): boolean {
  if (!(err instanceof ConvexError)) return false;
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null) return false;
  const code = (data as { code?: unknown }).code;
  return code === 'RATE_LIMITED' || code === 'CONTENTION';
}

function probeCapability(
  fn: CapabilityProbe,
  organizationId: string,
): Promise<{ available: boolean }> {
  const cached = capabilityProbeCache.get(organizationId);
  if (cached) return cached;
  const inflight = fn({ organizationId }).catch((err) => {
    capabilityProbeCache.delete(organizationId);
    throw err;
  });
  capabilityProbeCache.set(organizationId, inflight);
  return inflight;
}

export function PersonalizationSettings() {
  const organizationId = useOrganizationId();
  if (!organizationId) {
    return null;
  }
  return <PersonalizationSettingsInner organizationId={organizationId} />;
}

interface FeatureGate {
  orgDefaultOn: boolean;
  isFollowingDefault: boolean;
  effective: boolean;
}

function resolveGate(
  userExplicit: boolean | undefined,
  orgDefaultOn: boolean,
): FeatureGate {
  const isFollowingDefault = userExplicit === undefined;
  return {
    orgDefaultOn,
    isFollowingDefault,
    effective: isFollowingDefault ? orgDefaultOn : userExplicit,
  };
}

function PersonalizationSettingsInner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const prefs = useQuery(api.user_preferences.queries.getMyPreferences, {
    organizationId,
  });
  const approvedMemories = useQuery(api.user_memories.queries.listMyMemories, {
    organizationId,
  });
  const pendingMemories = useQuery(
    api.user_memories.queries.listPendingMemories,
    {
      organizationId,
    },
  );
  const orgDefault = useQuery(api.personalization.queries.getOrgDefault, {
    organizationId,
  });

  const orgDefaultLoaded = orgDefault !== undefined;
  const customInstructionsGate = resolveGate(
    prefs?.customInstructionsEnabled,
    orgDefault?.customInstructions === true,
  );
  const memoriesGate = resolveGate(
    prefs?.memoriesEnabled,
    orgDefault?.memories === true,
  );

  return (
    <SettingsPage
      title={tNav('personalization')}
      description={
        <>
          {tSettings('menu.personalization.description')}{' '}
          <a
            href="https://tale.dev/legal/personalization"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline"
          >
            {t('page.privacyLink')}
          </a>
        </>
      }
      narrow
    >
      <OrgDefaultsSection organizationId={organizationId} />
      <CustomInstructionsToggleSection
        organizationId={organizationId}
        gate={customInstructionsGate}
        orgDefaultLoaded={orgDefaultLoaded}
      />
      {customInstructionsGate.effective && (
        <CustomInstructionsSection
          prefs={prefs ?? null}
          organizationId={organizationId}
        />
      )}
      <MemoriesToggleSection
        organizationId={organizationId}
        gate={memoriesGate}
        orgDefaultLoaded={orgDefaultLoaded}
      />
      {memoriesGate.effective && (
        <>
          <SavedMemoriesSection memories={approvedMemories ?? []} />
          <PendingMemoriesSection memories={pendingMemories ?? []} />
        </>
      )}
      <VoiceOutputSection prefs={prefs} organizationId={organizationId} />
    </SettingsPage>
  );
}

function readPolicyEnabled(config: unknown): boolean {
  return isRecord(config) && config['enabled'] === true;
}

function OrgDefaultsSection({ organizationId }: { organizationId: string }) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const ability = useAbility();
  const { data: customInstructionsPolicy } = useGovernancePolicy(
    organizationId,
    'custom_instructions',
  );
  const { data: memoriesPolicy } = useGovernancePolicy(
    organizationId,
    'user_memories',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  if (ability.cannot('write', 'orgSettings')) return null;

  const onToggle = async (
    policyType: 'custom_instructions' | 'user_memories',
    next: boolean,
  ) => {
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType,
        config: { enabled: next },
      });
      toast({ title: t('page.orgDefault.toastUpdated') });
    } catch (err) {
      toast({
        title: errorMessage(err, t('errors.saveFailed')),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <SettingsToggleRow
        label={t('page.orgDefault.customInstructions.label')}
        description={t('page.orgDefault.customInstructions.description')}
        checked={readPolicyEnabled(customInstructionsPolicy?.config)}
        onCheckedChange={(next) => onToggle('custom_instructions', next)}
      />
      <SettingsToggleRow
        label={t('page.orgDefault.memories.label')}
        description={t('page.orgDefault.memories.description')}
        checked={readPolicyEnabled(memoriesPolicy?.config)}
        onCheckedChange={(next) => onToggle('user_memories', next)}
      />
    </>
  );
}

interface ToggleSectionProps {
  organizationId: string;
  gate: FeatureGate;
  orgDefaultLoaded: boolean;
}

function buildOrgDefaultHint(
  t: (key: string, vars?: Record<string, string>) => string,
  orgDefaultLoaded: boolean,
  gate: FeatureGate,
  baseDescription: string,
): ReactNode {
  if (!orgDefaultLoaded) return baseDescription;
  const orgStateLabel = gate.orgDefaultOn
    ? t('page.enable.orgStateOn')
    : t('page.enable.orgStateOff');
  const hint = gate.isFollowingDefault
    ? t('page.enable.followingOrgDefault', { state: orgStateLabel })
    : t('page.enable.overridingOrgDefault', { state: orgStateLabel });
  return (
    <>
      {baseDescription} <span className="text-muted-foreground">{hint}</span>
    </>
  );
}

function CustomInstructionsToggleSection({
  organizationId,
  gate,
  orgDefaultLoaded,
}: ToggleSectionProps) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled } = useSetCustomInstructionsEnabled();

  const description = buildOrgDefaultHint(
    t,
    orgDefaultLoaded,
    gate,
    t('page.customInstructionsToggle.description'),
  );

  return (
    <SettingsToggleRow
      label={t('page.customInstructionsToggle.label')}
      description={description}
      checked={gate.effective}
      onCheckedChange={async (next) => {
        try {
          await setEnabled({ organizationId, enabled: next });
          toast({ title: t('toasts.preferencesUpdated') });
        } catch (err) {
          toast({
            title: errorMessage(err, t('errors.saveFailed')),
            variant: 'destructive',
          });
        }
      }}
    />
  );
}

function MemoriesToggleSection({
  organizationId,
  gate,
  orgDefaultLoaded,
}: ToggleSectionProps) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled } = useSetMemoriesEnabled();

  const description = buildOrgDefaultHint(
    t,
    orgDefaultLoaded,
    gate,
    t('page.memoriesToggle.description'),
  );

  return (
    <SettingsToggleRow
      label={t('page.memoriesToggle.label')}
      description={description}
      checked={gate.effective}
      onCheckedChange={async (next) => {
        try {
          await setEnabled({ organizationId, enabled: next });
          toast({ title: t('toasts.preferencesUpdated') });
        } catch (err) {
          toast({
            title: errorMessage(err, t('errors.saveFailed')),
            variant: 'destructive',
          });
        }
      }}
    />
  );
}

interface CustomInstructionsForm {
  customInstructions: string;
}

function CustomInstructionsSection({
  prefs,
  organizationId,
}: {
  prefs: Doc<'userPreferences'> | null;
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: upsert } = useUpsertMyPreferences();

  const schema = useMemo(
    () =>
      z.object({
        customInstructions: z.string().max(CUSTOM_INSTRUCTIONS_MAX_CHARS),
      }),
    [],
  );

  const data = useMemo<CustomInstructionsForm | undefined>(
    () =>
      prefs === undefined
        ? undefined
        : { customInstructions: prefs?.customInstructions ?? '' },
    [prefs],
  );

  const save = useCallback(
    async (values: CustomInstructionsForm) => {
      try {
        await upsert({
          organizationId,
          customInstructions: values.customInstructions,
        });
        toast({ title: t('toasts.saved') });
      } catch (err) {
        toast({
          title: errorMessage(err, t('errors.saveFailed')),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [organizationId, t, toast, upsert],
  );

  const editor = useFormEditor<CustomInstructionsForm>({
    data,
    schema,
    save,
  });

  useRegisterActiveEditor(editor);

  const {
    form: { register, watch },
  } = editor;
  const value = watch('customInstructions') ?? '';

  return (
    <SettingsSection
      title={t('page.customInstructions.title')}
      description={t('page.customInstructions.description')}
    >
      <Textarea
        placeholder={t('page.customInstructions.placeholder')}
        rows={5}
        {...register('customInstructions')}
      />
      <Text className="text-muted-foreground text-xs">
        {t('page.customInstructions.counter', {
          count: value.length,
        })}
      </Text>
    </SettingsSection>
  );
}

function VoiceOutputSection({
  prefs,
  organizationId,
}: {
  // `undefined` is the convex `useQuery` loading state; `null` is the
  // explicit "no userPreferences row exists" answer; otherwise the doc.
  // Distinguishing the three matters because the previous collapse-to-null
  // rendered the Switch unchecked during the loading window — a user tap
  // in that window would write `false` to a row whose true value was
  // `true`, silently flipping their setting.
  prefs: Doc<'userPreferences'> | null | undefined;
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const setVoiceOutput = useMutation(api.tts.mutations.setUserVoiceOutput);
  const getCapability = useAction(api.tts.synthesize.getCapability);
  const { data: orgVoicePolicy } = useGovernancePolicy(
    organizationId,
    'voice_output',
  );
  const orgVetoed = (() => {
    const config = orgVoicePolicy?.config;
    if (!isRecord(config)) return false;
    const flag = config.enabled;
    return typeof flag === 'boolean' && !flag;
  })();
  const isLoading = prefs === undefined;
  const enabled = prefs?.voiceOutput === true;
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void probeCapability(getCapability, organizationId)
      .then((r) => {
        if (!cancelled) setProviderAvailable(r.available);
      })
      .catch((err) => {
        if (isTransientProbeError(err)) {
          console.warn(
            '[tts] capability probe transient error; leaving unknown',
          );
          return;
        }
        console.warn('[tts] capability lookup failed', err);
        if (!cancelled) setProviderAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getCapability, organizationId]);

  const switchDescription: ReactNode = orgVetoed ? (
    <>
      {t('page.voiceOutput.description')} {t('page.voiceOutput.disabledByOrg')}
    </>
  ) : providerAvailable === false ? (
    <>
      {t('page.voiceOutput.description')}{' '}
      {t('page.voiceOutput.providerUnavailable')}{' '}
      <Link
        to="/dashboard/$id/settings/providers"
        params={{ id: organizationId }}
        className="hover:text-foreground underline"
      >
        {t('page.voiceOutput.configureProvider')}
      </Link>
    </>
  ) : (
    t('page.voiceOutput.description')
  );

  const disabled =
    isLoading || (providerAvailable === false && !enabled) || orgVetoed;

  return (
    <SettingsToggleRow
      label={t('page.voiceOutput.label')}
      description={switchDescription}
      checked={enabled}
      disabled={disabled}
      ariaBusy={isLoading || providerAvailable === null}
      onCheckedChange={async (next) => {
        if (next) primeAudio();
        try {
          await setVoiceOutput({ organizationId, enabled: next });
          if (next && providerAvailable === false) {
            toast({
              title: t('toasts.voiceOutputEnabledButProviderMissing'),
              variant: 'destructive',
            });
          } else {
            toast({ title: t('toasts.preferencesUpdated') });
          }
        } catch (err) {
          toast({
            title: errorMessage(err, t('errors.saveFailed')),
            variant: 'destructive',
          });
        }
      }}
    />
  );
}

function SavedMemoriesSection({
  memories,
}: {
  memories: Doc<'userMemories'>[];
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: softDelete } = useSoftDeleteMemory();

  return (
    <SettingsSection title={t('page.memories.title')}>
      {memories.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          {t('page.memories.empty')}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {memories.map((m) => (
            <li
              key={m._id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <Text className="flex-1">{m.content}</Text>
              <IconButton
                icon={Trash2}
                aria-label={t('page.memories.delete')}
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(t('page.memories.deleteConfirm'))) return;
                  try {
                    await softDelete({ memoryId: m._id });
                    toast({ title: t('toasts.deleted') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function PendingMemoriesSection({
  memories,
}: {
  memories: Doc<'userMemories'>[];
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: approve } = useApprovePendingMemory();
  const { mutateAsync: dismiss } = useDismissPendingMemory();

  return (
    <SettingsSection title={t('page.pending.title')}>
      {memories.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          {t('page.pending.empty')}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {memories.map((m) => (
            <li key={m._id} className="flex items-start gap-3 py-2">
              <Text className="flex-1">{m.content}</Text>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  try {
                    await approve({ memoryId: m._id });
                    toast({ title: t('toasts.saved') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {t('card.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await dismiss({ memoryId: m._id });
                    toast({ title: t('toasts.discarded') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {t('card.discard')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (
      data !== null &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message;
    }
  }
  return fallback;
}
