import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { sameScheduleRule } from '@tale/shared/schemas/schedule-rule';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  defaultTriggerDraft,
  draftFromStored,
  type TriggerDraft,
} from '../lib/trigger-draft';

/**
 * The trigger form's draft, kept in step with the stored trigger without
 * ever erasing an edit in progress.
 *
 * The stored row is the truth; the draft only carries unsaved edits. A row
 * that arrives while the form holds an edit — another session's save, or
 * this form's own — moves every field the author left alone and keeps every
 * field they changed: changed since the form last loaded, or since the save
 * in flight sent it (a change back to the loaded value during a save is an
 * edit too). The load is keyed on what the form shows, not on the row
 * object, so a refetch that only moves the last run loads nothing.
 */

/** How two values of a field are the same; plain equality unless named. */
const SAME_FIELD: {
  [K in keyof TriggerDraft]?: (
    a: TriggerDraft[K],
    b: TriggerDraft[K],
  ) => boolean;
} = { repeat: sameScheduleRule };

function sameField<K extends keyof TriggerDraft>(
  key: K,
  a: TriggerDraft[K],
  b: TriggerDraft[K],
): boolean {
  const same = SAME_FIELD[key];
  return same === undefined ? Object.is(a, b) : same(a, b);
}

/** `pick(key)` for every field, as one draft. */
function eachField(
  pick: <K extends keyof TriggerDraft>(key: K) => TriggerDraft[K],
): TriggerDraft {
  return {
    kind: pick('kind'),
    scheduleFormat: pick('scheduleFormat'),
    repeat: pick('repeat'),
    cron: pick('cron'),
    timezone: pick('timezone'),
    startDate: pick('startDate'),
    catchUp: pick('catchUp'),
    event: pick('event'),
    input: pick('input'),
    enabled: pick('enabled'),
  };
}

/** `sent` with each field it left as `loaded` moved on to `incoming`. */
function keepSentEdits(
  loaded: TriggerDraft,
  sent: TriggerDraft,
  incoming: TriggerDraft,
): TriggerDraft {
  return eachField((key) =>
    sameField(key, sent[key], loaded[key]) ? incoming[key] : sent[key],
  );
}

export interface TriggerDraftState {
  draft: TriggerDraft;
  /** Change fields of the draft. */
  update: (patch: Partial<TriggerDraft>) => void;
  /** Load a stored trigger (none: a new trigger's defaults). With
   * `keepEdits`, the fields the author changed stay as they are. */
  applyStored: (row: TriggerView | undefined, keepEdits?: boolean) => void;
  /** Run a save of the draft as it stands: while it is out, a change to a
   * field is an edit even if it returns to the loaded value; once it
   * settles, the form counts what it sent as loaded, and loads again a row
   * that arrived meanwhile. */
  persist: <T>(write: (sent: TriggerDraft) => Promise<T>) => Promise<T>;
}

export function useTriggerDraft(
  stored: TriggerView | undefined,
  viewerZone: string,
  /** Called whenever a stored trigger (or none) is loaded. */
  onLoad?: () => void,
): TriggerDraftState {
  const fresh = useCallback(
    (row: TriggerView | undefined) =>
      row === undefined
        ? defaultTriggerDraft(viewerZone)
        : draftFromStored(row, viewerZone),
    [viewerZone],
  );
  // A row already read at mount opens at once, so the form never shows a
  // frame of defaults that reads as an edit.
  const [draft, setDraft] = useState<TriggerDraft>(() => fresh(stored));
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // The draft as the form last loaded (or saved) it: what tells an edit
  // from a field the author left alone.
  const loadedRef = useRef<TriggerDraft>(draft);
  // While a save is out, the draft it sent.
  const sentRef = useRef<TriggerDraft | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const applyStored = useCallback(
    (row: TriggerView | undefined, keepEdits = false) => {
      const loaded = loadedRef.current;
      const sent = sentRef.current ?? loaded;
      let next = fresh(row);
      // A form showing a cron keeps showing one while the trigger is still
      // stored as a cron, even one a repeat rule could say: a row that
      // lands mid-edit never switches the field under the author.
      if (
        keepEdits &&
        loaded.scheduleFormat === 'cron' &&
        next.scheduleFormat === 'repeat' &&
        next.cron !== '' &&
        row?.repeat == null
      ) {
        next = { ...next, scheduleFormat: 'cron' };
      }
      loadedRef.current = next;
      // A field the save in flight left as loaded follows the row from now
      // on, as the form does.
      if (sentRef.current !== null) {
        sentRef.current = keepSentEdits(loaded, sentRef.current, next);
      }
      onLoadRef.current?.();
      setDraft((current) =>
        eachField((key) =>
          keepEdits &&
          (!sameField(key, current[key], loaded[key]) ||
            !sameField(key, current[key], sent[key]))
            ? current[key]
            : next[key],
        ),
      );
    },
    [fresh],
  );

  const storedRef = useRef(stored);
  storedRef.current = stored;
  const storedKey = stored === undefined ? null : JSON.stringify(fresh(stored));
  const storedKeyRef = useRef(storedKey);
  storedKeyRef.current = storedKey;
  useEffect(() => {
    if (storedKey === null) return;
    applyStored(storedRef.current, true);
  }, [storedKey, applyStored]);

  const update = useCallback((patch: Partial<TriggerDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const persist = useCallback(
    async <T>(write: (sent: TriggerDraft) => Promise<T>): Promise<T> => {
      const sent = draftRef.current;
      const storedKeyBefore = storedKeyRef.current;
      sentRef.current = sent;
      try {
        const result = await write(sent);
        // The store holds the draft as sent: a field still as sent takes
        // the row it answers with, while an edit made during the save
        // stays.
        loadedRef.current = sentRef.current ?? sent;
        return result;
      } finally {
        sentRef.current = null;
        // A row that arrived while the save was out loaded against the
        // form as it stood before; load it again against what the store
        // holds now.
        if (
          storedKeyRef.current !== null &&
          storedKeyRef.current !== storedKeyBefore
        ) {
          applyStored(storedRef.current, true);
        }
      }
    },
    [applyStored],
  );

  return { draft, update, applyStored, persist };
}
