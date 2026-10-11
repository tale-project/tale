import { useLocale } from '@tale/ui/i18n/locale-provider';
import {
  countTestStatuses,
  type TestCountStatus,
  type TestCounts,
  type TestStatus,
} from '@tale/ui/test-results';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import {
  addTest,
  blankTest,
  duplicateTest,
  removeTest,
  replaceTest,
  testNameOf,
  testsOf,
  unusedTestName,
} from '../lib/automation-tests/test-draft';
import {
  keepResults,
  outcomeOf,
  resultsAfterInsert,
  resultsAfterRemove,
  subjectHashOf,
  testStatusOf,
  type ReportSource,
  type TestOutcome,
} from '../lib/automation-tests/test-results';
import {
  durationText,
  resultReason,
  testBadges,
  type TestTextContext,
} from '../lib/automation-tests/test-text';
import type { RawDocument } from '../lib/draft-document';
import { automationErrorCode, automationErrorIssues } from '../lib/errors';
import { useRunAutomationTests } from './mutations';
import { useAutomationTestReport } from './queries';
import { useKeptTestResults } from './use-test-results';

/** One test as the panel and its inspector show it. */
export interface TestRow {
  /** Its place in the document: what its problems and results name. */
  index: number;
  /** Stable while the test keeps its place. */
  id: string;
  name: string;
  status: TestStatus;
  outcome: TestOutcome;
  /** Its first failure in words; none for a test that passed or waits. */
  reason?: string;
  /** How long its run took. */
  meta?: string;
  badges: readonly string[];
}

/** Why the last run of tests did not finish. */
export interface TestRunFailure {
  title: string;
  description?: string;
  /** A spent budget: Run waits this long. */
  retryAt?: number;
}

export interface AutomationTests {
  /** The tests of the document on screen, as written. */
  tests: readonly unknown[];
  rows: readonly TestRow[];
  counts: TestCounts;
  status: TestCountStatus;
  /** The places running now. */
  running: ReadonlySet<number>;
  failure: TestRunFailure | null;
  /** Where the results come from: "Not run yet", "Run on your draft",
   * "Checked when version 7 was deployed · Today, 14:02". */
  source: string;
  /** Changes once per run that finished, for the announcer. */
  announceKey: number;
  /** Why Run waits, when it does. */
  runDisabledReason: string | undefined;
  runAll: () => void;
  runOne: (index: number) => void;
  /** Runs again what the last run that did not finish asked for. */
  retry: () => void;
  /** Adds a blank test at the end; its place. */
  add: () => number | null;
  /** Copies a test right after itself; the copy's place. */
  duplicate: (index: number) => number | null;
  remove: (index: number) => void;
  replace: (index: number, test: unknown) => void;
}

/** The id of a row: its place, which is what its results are kept by. */
export function testRowId(index: number): string {
  return `test-${index}`;
}

/**
 * The Tests panel's state and verbs for the document on screen: each
 * test's latest result (this session's, or the version's kept report),
 * whether it still holds for the draft, the counts, and running them —
 * the draft's tests on the draft, a saved version's on that version, whose
 * whole suite is then recorded as its verdict. Adding, copying and
 * deleting a test change the draft through `editDraft`, and the results
 * move with their tests.
 */
export function useAutomationTests(args: {
  organizationId: string;
  automationSlug: string;
  draft: RawDocument | null;
  /** The version on screen, as stored. */
  storedRaw: RawDocument | null;
  /** The version on screen. */
  version: number | undefined;
  enabled: boolean;
  editDraft: (edit: (raw: RawDocument) => RawDocument) => void;
  text: Pick<TestTextContext, 'nodeLabel' | 'effectLabel'>;
}): AutomationTests {
  const {
    organizationId,
    automationSlug,
    draft,
    storedRaw,
    version,
    enabled,
    editDraft,
    text,
  } = args;
  const { t } = useT('automations');
  const { locale } = useLocale();
  const { formatDateSmart } = useFormatDate();
  const document = draft ?? storedRaw;
  const tests = useMemo(() => testsOf(document), [document]);
  const { results: kept, update } = useKeptTestResults(
    organizationId,
    automationSlug,
  );
  const reportQuery = useAutomationTestReport(
    organizationId,
    automationSlug,
    version,
    enabled && testsOf(storedRaw).length > 0,
  );
  const report = reportQuery.data ?? null;
  const reportSource = useMemo<ReportSource | null>(
    () =>
      report?.report === null ||
      report?.report === undefined ||
      storedRaw === null
        ? null
        : { report: report.report, document: storedRaw },
    [report, storedRaw],
  );

  const runTests = useRunAutomationTests();
  const [running, setRunning] = useState<ReadonlySet<number>>(() => new Set());
  const [failure, setFailure] = useState<TestRunFailure | null>(null);
  /** The tests the last run left out when its time was up, by name. */
  const [cutShort, setCutShort] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [announceKey, setAnnounceKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // A spent budget: Run waits until the server takes runs again.
  const retryAt = failure?.retryAt;
  useEffect(() => {
    if (retryAt === undefined) return undefined;
    const wait = retryAt - Date.now();
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timer);
  }, [retryAt]);
  const waiting = retryAt !== undefined && retryAt > now;

  const ctx = useMemo<TestTextContext>(
    () => ({ t, locale, ...text }),
    [t, locale, text],
  );
  const subjectHash = useMemo(
    () => (document === null ? '' : subjectHashOf(document)),
    [document],
  );
  const rows = useMemo<TestRow[]>(
    () =>
      tests.map((test, index) => {
        const outcome = outcomeOf({
          index,
          test,
          subjectHash,
          kept: kept[index],
          report: reportSource,
        });
        const status = testStatusOf(outcome, running.has(index));
        // A result changed since keeps its words: its status says it no
        // longer holds. A running test waits for its new one.
        const showResult = outcome.kind !== 'none' && status !== 'running';
        const name =
          testNameOf(test) ?? t('tests.unnamed', { number: index + 1 });
        const reason = showResult
          ? resultReason(outcome.result, ctx)
          : status === 'not-run' && cutShort.has(name)
            ? t('tests.notRunInTime')
            : undefined;
        return {
          index,
          id: testRowId(index),
          name,
          status,
          outcome,
          ...(reason !== undefined && { reason }),
          ...(showResult && {
            meta: durationText(outcome.result.ms, ctx),
          }),
          badges: testBadges(test, ctx),
        };
      }),
    [tests, subjectHash, kept, reportSource, running, cutShort, ctx, t],
  );
  const counts = useMemo(
    () => countTestStatuses(rows.map((row) => row.status)),
    [rows],
  );

  const source = useMemo(() => {
    const ranHere = rows.some((row) => row.outcome.kind === 'run');
    if (draft !== null && ranHere) return t('tests.source.draft');
    if (report !== null && report.testsCheckedAt !== null && version) {
      return t('tests.source.checked', {
        via: report.via ?? 'other',
        version,
        date: formatDateSmart(new Date(report.testsCheckedAt)),
      });
    }
    return ranHere ? t('tests.source.draft') : t('tests.source.notRun');
  }, [rows, draft, report, version, t, formatDateSmart]);

  const busy = running.size > 0 || runTests.isPending;
  const runDisabledReason =
    document === null || tests.length === 0
      ? undefined
      : busy
        ? t('tests.busy')
        : waiting
          ? failure?.title
          : undefined;

  /** What the last run asked for: every test, or these places. */
  const lastAsked = useRef<readonly number[] | undefined>(undefined);
  // The latest values a run reads when it starts, so the verbs stay the
  // same functions while the draft changes under them.
  const latest = useRef({ draft, document, version, tests });
  latest.current = { draft, document, version, tests };

  const run = useCallback(
    async (indices: readonly number[] | undefined) => {
      const {
        draft: sentDraft,
        document: sent,
        version: sentVersion,
      } = latest.current;
      if (sent === null) return;
      if (sentDraft === null && sentVersion === undefined) return;
      lastAsked.current = indices;
      const places = indices ?? latest.current.tests.map((_, at) => at);
      setRunning(new Set(places));
      setFailure(null);
      // One key per run: the announcer says it starts, then what it found.
      setAnnounceKey((key) => key + 1);
      try {
        const answer = await runTests.mutateAsync({
          organizationId,
          name: automationSlug,
          ...(sentDraft !== null
            ? { document: sentDraft }
            : { version: sentVersion }),
          ...(indices !== undefined && { tests: [...indices] }),
        });
        // Never older than the verdict it recorded, whatever the two
        // clocks say: the version's report must not read as newer than the
        // run it came from.
        const at = Math.max(Date.now(), answer.recorded?.checkedAt ?? 0);
        update((previous) => keepResults(previous, answer.report, sent, at));
        setCutShort(new Set(answer.report.notRun ?? []));
      } catch (error) {
        setFailure(runFailureOf(error, t));
      } finally {
        setRunning(new Set());
      }
    },
    [runTests, organizationId, automationSlug, update, t],
  );
  const runAll = useCallback(() => {
    void run(undefined);
  }, [run]);
  const runOne = useCallback(
    (index: number) => {
      void run([index]);
    },
    [run],
  );
  const retry = useCallback(() => {
    void run(lastAsked.current);
  }, [run]);

  const add = useCallback((): number | null => {
    // The draft applies the edit at once, so its place is known on return;
    // -1 while the editor has no document to add to.
    let at = -1;
    editDraft((current) => {
      const next = addTest(
        current,
        blankTest(current, unusedTestName(current, t('tests.newName'))),
      );
      at = next.index;
      return next.document;
    });
    return at < 0 ? null : at;
  }, [editDraft, t]);
  const duplicate = useCallback(
    (index: number): number | null => {
      const raw = latest.current.document;
      if (raw === null) return null;
      const name = unusedTestName(
        raw,
        t('tests.copyName', {
          name:
            testNameOf(testsOf(raw)[index]) ??
            t('tests.unnamed', { number: index + 1 }),
        }),
      );
      const copied = duplicateTest(raw, index, name);
      if (copied === null) return null;
      editDraft(
        (current) => duplicateTest(current, index, name)?.document ?? current,
      );
      update((previous) => resultsAfterInsert(previous, copied.index));
      return copied.index;
    },
    [editDraft, update, t],
  );
  const remove = useCallback(
    (index: number) => {
      editDraft((current) => removeTest(current, index));
      update((previous) => resultsAfterRemove(previous, index));
    },
    [editDraft, update],
  );
  const replace = useCallback(
    (index: number, test: unknown) => {
      editDraft((current) => replaceTest(current, index, test));
    },
    [editDraft],
  );

  return {
    tests,
    rows,
    counts,
    // A run that did not finish, a spent budget included, is no result to
    // count or to say: the panel says why instead.
    status: busy ? 'running' : failure !== null ? 'failed' : 'idle',
    running,
    failure,
    source,
    announceKey,
    runDisabledReason,
    runAll,
    runOne,
    retry,
    add,
    duplicate,
    remove,
    replace,
  };
}

/** What a run of tests that did not finish says: a spent budget names when
 * to try again; a draft the checks refuse points at Problems; anything else
 * says it could not run, with the failure's own words under it. */
function runFailureOf(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): TestRunFailure {
  const code = automationErrorCode(error);
  if (code === 'RATE_LIMITED') {
    const waitMs = retryAfterMsOf(error) ?? 2_000;
    return {
      title: t('tests.rateLimited', { seconds: Math.ceil(waitMs / 1000) }),
      retryAt: Date.now() + waitMs,
    };
  }
  if (code === 'AUTOMATION_INVALID') {
    const issues = automationErrorIssues(error);
    return {
      title: t('tests.invalid', {
        count: Math.max(1, issues?.errors.length ?? 1),
      }),
    };
  }
  const description = failureDetail(error);
  return {
    title: t('tests.runFailed'),
    ...(description !== undefined && { description }),
  };
}

/** How long a spent budget asks to wait, from the refusal's data. */
function retryAfterMsOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object' || !('data' in error)) {
    return undefined;
  }
  const { data } = error;
  if (data === null || typeof data !== 'object' || !('retryAfterMs' in data)) {
    return undefined;
  }
  const { retryAfterMs } = data;
  return typeof retryAfterMs === 'number' && retryAfterMs > 0
    ? retryAfterMs
    : undefined;
}
