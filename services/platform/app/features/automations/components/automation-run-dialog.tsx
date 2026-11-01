'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { CodeEditor } from '@tale/ui/code-editor';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { RadioGroup } from '@tale/ui/radio-group';
import { SchemaTree, schemaKindLabel } from '@tale/ui/schema-tree';
import { Text } from '@tale/ui/text';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationRun } from '../hooks/queries';
import {
  parseJsonText,
  useJsonInputDraft,
} from '../hooks/use-json-input-draft';
import {
  rememberedSource,
  sourceMemoryOf,
  type RunInputSource,
  type SourceBench,
} from '../lib/automation-tests/run-sources';
import { guidedIssueSource } from '../lib/issue-import';
import { nodeTitle } from '../lib/node-face';
import { runInputProviders } from '../lib/run-input-completion';
import { IssueImportFields } from './issue-import-fields';

export interface AutomationRunRequest {
  automationSlug?: string;
  initialInput?: Record<string, unknown>;
  mode: 'mock' | 'live';
  version: number;
  schema?: Record<string, unknown>;
  projectId?: string;
  scopeText: string;
  /** The draft differs from the version on screen: the dialog asks which
   * of the two runs, the draft first, and checks the draft's input against
   * the draft's own schema. */
  draft?: { schema?: Record<string, unknown> };
  /** A step test of the draft up to this node: the draft is what runs. */
  upTo?: { node: string; label: string };
}

/** What a test run runs: the unsaved draft, tried once and kept nowhere,
 * or the saved version, whose run is kept with the others. */
export type RunTarget = 'draft' | 'version';

/** Where a test run's input can start from, and where the dialog keeps the
 * last choice for this automation. */
export interface RunSources {
  organizationId: string;
  memoryKey: string;
  items: readonly RunInputSource[];
}

function readMemory(key: string | undefined): string | null {
  if (key === undefined) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch (error) {
    // A browser that keeps no session storage still runs; it only forgets.
    console.warn('Could not read where the run input started from', error);
    return null;
  }
}

function writeMemory(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    console.warn('Could not keep where the run input started from', error);
  }
}

/** Reads a run's input once a run is chosen to start from, and hands it on
 * once — mounted only while one is being read. */
function RunInputLoader({
  organizationId,
  runId,
  onLoaded,
  onFailed,
}: {
  organizationId: string;
  runId: string;
  onLoaded: (input: unknown) => void;
  onFailed: () => void;
}) {
  const query = useAutomationRun(organizationId, runId);
  const handed = useRef(false);
  useEffect(() => {
    if (handed.current) return;
    if (query.data !== undefined && query.data !== null) {
      handed.current = true;
      onLoaded(query.data.input ?? {});
    } else if (query.isError) {
      handed.current = true;
      onFailed();
    }
  }, [query.data, query.isError, onLoaded, onFailed]);
  return null;
}

/** Mounted for one reviewed version and run scope. The server remains the
 * authority; client validation gives feedback before scheduling any work. */
export function AutomationRunDialog({
  organizationId,
  request,
  sources,
  pending = false,
  error,
  onClose,
  onConfirm,
}: {
  /** Whose projects an issue import's project is picked from. */
  organizationId: string;
  request: AutomationRunRequest;
  /** Where the input can start from (a test run in the editor). */
  sources?: RunSources;
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  /** `bench` is a test's stand-ins, sent with a try of the draft. */
  onConfirm: (input: unknown, target: RunTarget, bench?: SourceBench) => void;
}) {
  const { t } = useT('automations');
  const { t: tSchema } = useT('schemaTree');
  const { locale } = useLocale();
  const inputId = useId();
  // The last place the input started from for this automation, when it is
  // still on offer: the dialog opens on it.
  const [remembered] = useState(() =>
    sources === undefined
      ? undefined
      : rememberedSource(sources.items, readMemory(sources.memoryKey)),
  );
  const [chosen, setChosen] = useState<RunInputSource | null>(
    remembered ?? null,
  );
  const [reading, setReading] = useState<RunInputSource | null>(
    remembered?.kind === 'run' ? remembered : null,
  );
  const [readFailed, setReadFailed] = useState(false);
  const [news, setNews] = useState('');
  const [useStandIns, setUseStandIns] = useState(true);
  const [text, setText] = useState(() =>
    JSON.stringify(
      remembered !== undefined && remembered.kind !== 'run'
        ? remembered.input
        : (request.initialInput ?? {}),
      null,
      2,
    ),
  );
  const [target, setTarget] = useState<RunTarget>(
    request.draft === undefined ? 'version' : 'draft',
  );
  const tryingDraft = target === 'draft';
  // The input the chosen document takes: the draft may declare another.
  const schema = tryingDraft ? request.draft?.schema : request.schema;
  const source = guidedIssueSource(request.automationSlug, request.schema);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(request.projectId !== undefined && { projectId: request.projectId }),
    limit: 100,
    ...(source === 'glitchtip' && { query: 'is:unresolved' }),
    ...request.initialInput,
  }));
  const { check } = useJsonInputDraft(schema);
  // The fields the schema declares, offered where a key of the input is
  // typed, each with its kind.
  const providers = useMemo(
    () =>
      runInputProviders(schema, (field) =>
        schemaKindLabel(tSchema, field, locale),
      ),
    [schema, tSchema, locale],
  );
  const parsed = useMemo(() => {
    let input: unknown = values;
    if (source === null) {
      const read = parseJsonText(text);
      if (!read.ok) {
        // The editor marks where the text stops being JSON; this line says
        // nothing can start until it is.
        return {
          valid: false as const,
          error: t('detail.runInput.invalidJson'),
        };
      }
      input = read.value;
    }
    const checked = check(input);
    if (!checked.valid) {
      return {
        valid: false as const,
        error: t('detail.runInput.invalid', {
          paths: checked.paths.join(', '),
        }),
      };
    }
    // Send the original JSON, not a converter's transformed/stripped value.
    return { valid: true as const, input: checked.input };
  }, [check, text, source, values, t]);

  /** Puts `input` in the field, from `from`, and says so. */
  const startFrom = (from: RunInputSource, input: unknown): void => {
    setText(JSON.stringify(input, null, 2));
    setChosen(from);
    setNews(t('detail.runSource.replaced', { source: from.label }));
  };
  const choose = (from: RunInputSource): void => {
    if (sources !== undefined) {
      writeMemory(sources.memoryKey, sourceMemoryOf(from));
    }
    setReadFailed(false);
    if (from.kind === 'run') {
      setReading(from);
      return;
    }
    setReading(null);
    startFrom(from, from.input);
  };
  // A test's stand-ins go with a try of the draft; a saved version's run
  // takes none.
  const standIns = chosen?.kind === 'test' ? chosen.bench : undefined;
  const bench = tryingDraft && useStandIns ? standIns : undefined;
  const confirm = (input: unknown): void => {
    onConfirm(input, target, ...(bench === undefined ? [] : [bench]));
  };

  const confirmText =
    request.mode === 'live' ? t('detail.runLive') : t('detail.runMock');
  const groups = sources === undefined ? [] : sourceGroups(sources.items);

  return (
    <ConfirmDialog
      open
      onOpenChange={onClose}
      title={
        request.upTo !== undefined
          ? t('stepTest.upToTitle', { node: request.upTo.label })
          : request.mode === 'live'
            ? t('detail.runLiveTitle')
            : t('detail.runMock')
      }
      description={
        request.upTo !== undefined
          ? t('stepTest.upToDescription')
          : request.mode === 'live'
            ? t('detail.runLiveBody')
            : tryingDraft
              ? t('detail.runInput.mockDescriptionDraft')
              : t('detail.runInput.mockDescription')
      }
      confirmText={confirmText}
      disableConfirm={!parsed.valid || reading !== null}
      isLoading={pending}
      onConfirm={() => {
        if (parsed.valid) confirm(parsed.input);
      }}
    >
      {error && <Alert variant="destructive" description={error} />}
      {request.draft !== undefined && request.upTo === undefined && (
        <RadioGroup
          label={t('detail.runTarget.label')}
          value={target}
          onValueChange={(next) => {
            setTarget(next === 'version' ? 'version' : 'draft');
          }}
          disabled={pending}
          options={[
            {
              value: 'draft',
              label: t('detail.runTarget.draft'),
              description: t('detail.runTarget.draftHelp'),
            },
            {
              value: 'version',
              label: t('detail.runTarget.version', {
                version: request.version,
              }),
              description: t('detail.runTarget.versionHelp'),
            },
          ]}
        />
      )}
      {source === null && !tryingDraft && (
        <Text as="p" variant="muted" className="text-sm">
          {request.scopeText}
        </Text>
      )}
      {source !== null ? (
        <>
          <IssueImportFields
            organizationId={organizationId}
            source={source}
            value={values}
            {...(request.projectId !== undefined && {
              pinnedProjectId: request.projectId,
            })}
            disabled={pending}
            onChange={setValues}
          />
          {!parsed.valid && (
            <Text as="p" variant="muted" className="mt-3 text-sm" role="status">
              {parsed.error}
            </Text>
          )}
        </>
      ) : (
        // The input is typed when the document that runs declares one, when
        // the caller hands a sample to edit (a trigger's Run now), or when it
        // can start from somewhere (a test run in the editor).
        (schema !== undefined ||
          request.initialInput !== undefined ||
          groups.length > 0) && (
          <div className="mt-4 space-y-3">
            {groups.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {reading !== null && (
                  <Text as="span" variant="muted" className="text-xs">
                    {t('detail.runSource.reading')}
                  </Text>
                )}
                <DropdownMenu
                  align="end"
                  trigger={
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                    >
                      {t('detail.runSource.button')}
                      <ChevronDown aria-hidden="true" className="size-4" />
                    </Button>
                  }
                  items={() =>
                    groups.map((group) => {
                      const section: DropdownMenuGroup = [
                        { type: 'label', content: t(GROUP_KEYS[group.kind]) },
                      ];
                      for (const item of group.items) {
                        section.push({
                          type: 'item',
                          label: item.label,
                          selected: chosen?.id === item.id,
                          onClick: () => choose(item),
                        });
                      }
                      return section;
                    })
                  }
                />
              </div>
            )}
            <Field
              label={t('detail.runInput.label')}
              htmlFor={inputId}
              description={
                tryingDraft
                  ? t('detail.runInput.descriptionDraft')
                  : t('detail.runInput.description', {
                      version: request.version,
                    })
              }
              error={
                readFailed
                  ? t('detail.runSource.readFailed')
                  : parsed.valid
                    ? undefined
                    : parsed.error
              }
            >
              <CodeEditor
                id={inputId}
                language="json"
                value={text}
                onChange={(next) => {
                  setText(next);
                }}
                minRows={6}
                maxRows={14}
                providers={providers}
                // Mod-Enter starts the run, as the dialog's button does —
                // once the input is one the run takes.
                onSubmit={() => {
                  if (parsed.valid && !pending && reading === null) {
                    confirm(parsed.input);
                  }
                }}
                submitLabel={confirmText}
                describeDiagnostics={false}
              />
            </Field>
            {standIns !== undefined &&
              (tryingDraft ? (
                <Checkbox
                  checked={useStandIns}
                  onCheckedChange={(checked) =>
                    setUseStandIns(checked === true)
                  }
                  label={t('detail.runSource.standIns')}
                  description={t('detail.runSource.standInsHelp', {
                    nodes: new Intl.ListFormat(locale, {
                      type: 'conjunction',
                    }).format(
                      [
                        ...new Set([
                          ...Object.keys(standIns.mocks ?? {}),
                          ...Object.keys(standIns.failures ?? {}),
                          ...Object.keys(standIns.scenarios ?? {}),
                        ]),
                      ].map(nodeTitle),
                    ),
                  })}
                  disabled={pending}
                />
              ) : (
                <Text as="p" variant="muted" className="text-sm">
                  {t('detail.runSource.standInsDraftOnly')}
                </Text>
              ))}
            {schema !== undefined && (
              <CollapsibleDetails summary={t('detail.runInput.schema')}>
                <SchemaTree
                  schema={schema}
                  density="comfortable"
                  aria-label={t('detail.runInput.schema')}
                  className="mt-2"
                />
              </CollapsibleDetails>
            )}
            <span role="status" className="sr-only">
              {news}
            </span>
          </div>
        )
      )}
      {sources !== undefined && reading !== null && (
        <RunInputLoader
          // A run chosen again reads afresh.
          key={reading.id}
          organizationId={sources.organizationId}
          runId={reading.kind === 'run' ? reading.runId : ''}
          onLoaded={(input) => {
            const from = reading;
            setReading(null);
            startFrom(from, input);
          }}
          onFailed={() => {
            setReading(null);
            setReadFailed(true);
          }}
        />
      )}
    </ConfirmDialog>
  );
}

/** The menu's sections, in order; one without a source is left out. */
const GROUP_KEYS = {
  test: 'detail.runSource.tests',
  run: 'detail.runSource.runs',
  trigger: 'detail.runSource.trigger',
  other: 'detail.runSource.other',
} as const;

function sourceGroups(items: readonly RunInputSource[]): Array<{
  kind: keyof typeof GROUP_KEYS;
  items: RunInputSource[];
}> {
  const byKind = (kind: keyof typeof GROUP_KEYS) =>
    items.filter((item) =>
      kind === 'other'
        ? item.kind === 'empty' || item.kind === 'required'
        : item.kind === kind,
    );
  return (['test', 'run', 'trigger', 'other'] as const)
    .map((kind) => ({ kind, items: byKind(kind) }))
    .filter((group) => group.items.length > 0);
}
