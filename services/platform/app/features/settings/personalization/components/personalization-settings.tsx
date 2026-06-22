'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
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
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { convexErrorMessage } from '@/lib/utils/convex-error';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useApprovePendingMemory,
  useDismissPendingMemory,
  useSetCustomInstructionsEnabled,
  useSetMemoriesEnabled,
  useSetVoiceOutput,
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

// =============================================================================
// Container — owns the Convex reads (preferences + org defaults + memory
// lists) and the loading state. Wraps the real full-width view in
// `<Skeletonize>` so the skeleton inherits the SAME section structure (no
// horizontal shift on load).
// =============================================================================
function PersonalizationSettingsInner({
  organizationId,
}: {
  organizationId: string;
}) {
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

  // Gate the page on the two reads that decide WHICH sections render — so the
  // conditional Custom-instructions / Memories blocks don't pop in (and push
  // the page down) once preferences resolve. The memory LISTS load
  // independently and render placeholder rows of their own while pending.
  const isLoading = prefs === undefined || orgDefault === undefined;

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
    <Skeletonize loading={isLoading}>
      <PersonalizationSettingsView
        organizationId={organizationId}
        prefs={prefs}
        approvedMemories={approvedMemories}
        pendingMemories={pendingMemories}
        customInstructionsGate={customInstructionsGate}
        memoriesGate={memoriesGate}
        orgDefaultLoaded={orgDefaultLoaded}
      />
    </Skeletonize>
  );
}

// =============================================================================
// Plain presentational view — renders the real full-width layout.
// Rendered both live and (wrapped in `<Skeletonize>`) as its own skeleton, so
// loading and loaded layouts are the SAME tree and cannot drift. While loading
// the gate-dependent sections are force-rendered (masked) so they reserve
// their space — the loaded layout never shifts as gates resolve.
// =============================================================================
function PersonalizationSettingsView({
  organizationId,
  prefs,
  approvedMemories,
  pendingMemories,
  customInstructionsGate,
  memoriesGate,
  orgDefaultLoaded,
}: {
  organizationId: string;
  prefs: Doc<'userPreferences'> | null | undefined;
  approvedMemories: Doc<'userMemories'>[] | undefined;
  pendingMemories: Doc<'userMemories'>[] | undefined;
  customInstructionsGate: FeatureGate;
  memoriesGate: FeatureGate;
  orgDefaultLoaded: boolean;
}) {
  const { t } = useT('personalization');
  const { t: tSettings } = useT('settings');
  const loading = useSkeleton();

  return (
    <SettingsPage>
      <SettingsSection
        title={t('page.title')}
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
      >
        <CustomInstructionsToggleSection
          organizationId={organizationId}
          gate={customInstructionsGate}
          orgDefaultLoaded={orgDefaultLoaded}
        />
        <MemoriesToggleSection
          organizationId={organizationId}
          gate={memoriesGate}
          orgDefaultLoaded={orgDefaultLoaded}
        />
        <VoiceOutputSection prefs={prefs} organizationId={organizationId} />
      </SettingsSection>
      {(loading || customInstructionsGate.effective) && (
        <CustomInstructionsSection
          prefs={prefs ?? null}
          organizationId={organizationId}
        />
      )}
      {(loading || memoriesGate.effective) && (
        <>
          <SavedMemoriesSection memories={approvedMemories ?? []} />
          <PendingMemoriesSection memories={pendingMemories ?? []} />
        </>
      )}
    </SettingsPage>
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
  const { mutateAsync: setEnabled, isPending } =
    useSetCustomInstructionsEnabled();

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
      // Disable while the write is in flight so a rapid double-toggle can't
      // enqueue overlapping mutations (the value already flipped optimistically).
      disabled={isPending}
      onCheckedChange={async (next) => {
        try {
          await setEnabled({ organizationId, enabled: next });
          toast({ title: t('toasts.preferencesUpdated') });
        } catch (err) {
          toast({
            title: convexErrorMessage(err, t('errors.saveFailed')),
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
  const { mutateAsync: setEnabled, isPending } = useSetMemoriesEnabled();

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
      // Disable while the write is in flight so a rapid double-toggle can't
      // enqueue overlapping mutations (the value already flipped optimistically).
      disabled={isPending}
      onCheckedChange={async (next) => {
        try {
          await setEnabled({ organizationId, enabled: next });
          toast({ title: t('toasts.preferencesUpdated') });
        } catch (err) {
          toast({
            title: convexErrorMessage(err, t('errors.saveFailed')),
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
          title: convexErrorMessage(err, t('errors.saveFailed')),
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
      className="border-border border-t pt-8"
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
  const { mutateAsync: setVoiceOutput, isPending: isSettingVoiceOutput } =
    useSetVoiceOutput();
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
    isLoading ||
    isSettingVoiceOutput ||
    (providerAvailable === false && !enabled) ||
    orgVetoed;

  return (
    <SettingsToggleRow
      label={t('page.voiceOutput.label')}
      // The final wording depends on an async capability probe. While it
      // resolves (after prefs have loaded), mask the description in place so it
      // doesn't pop in / change text a beat after the rest of the row.
      description={
        providerAvailable === null && !isLoading ? (
          <Skeletonize loading>
            <SkeletonBox fullWidth>
              <span>{t('page.voiceOutput.description')}</span>
            </SkeletonBox>
          </Skeletonize>
        ) : (
          switchDescription
        )
      }
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
            title: convexErrorMessage(err, t('errors.saveFailed')),
            variant: 'destructive',
          });
        }
      }}
    />
  );
}

/** Placeholder list rows shown while a memory list loads — same `divide-y`
 *  row structure as the live list, so an empty-state ("No memories") never
 *  flashes during load and the section's height is reserved. */
const MEMORY_PLACEHOLDER_ROWS = 3;

function MemoryListSkeletonRows() {
  return (
    <ul className="divide-border divide-y" aria-hidden="true">
      {Array.from({ length: MEMORY_PLACEHOLDER_ROWS }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 py-2">
          <div className="flex-1" style={{ width: `${70 - i * 10}%` }}>
            <SkeletonText />
          </div>
        </li>
      ))}
    </ul>
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
  const loading = useSkeleton();

  return (
    <SettingsSection
      className="border-border border-t pt-8"
      title={t('page.memories.title')}
    >
      {loading ? (
        <MemoryListSkeletonRows />
      ) : memories.length === 0 ? (
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
                      title: convexErrorMessage(err, t('errors.saveFailed')),
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
  const loading = useSkeleton();

  return (
    <SettingsSection
      className="border-border border-t pt-8"
      title={t('page.pending.title')}
    >
      {loading ? (
        <MemoryListSkeletonRows />
      ) : memories.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          {t('page.pending.empty')}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {memories.map((m) => (
            <li key={m._id} className="flex items-start gap-3 py-2">
              <Text className="flex-1">{m.content}</Text>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await approve({ memoryId: m._id });
                    toast({ title: t('toasts.saved') });
                  } catch (err) {
                    toast({
                      title: convexErrorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {t('card.save')}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await dismiss({ memoryId: m._id });
                    toast({ title: t('toasts.discarded') });
                  } catch (err) {
                    toast({
                      title: convexErrorMessage(err, t('errors.saveFailed')),
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
