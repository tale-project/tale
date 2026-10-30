import type { Sql } from 'postgres';

import type { IndexHealthReport } from '../../core/knowledge/index_health.ts';
import {
  createBootDatabaseWait,
  type BootDatabaseWait,
} from '../../db/boot-wait.ts';
import {
  describeDatabaseError,
  isDatabaseUnavailable,
  ROUTINE_RESTART_MS,
} from '../../db/unavailable.ts';
import { reportError } from '../../error-reporting.ts';
import {
  verifyDefaultKnowledgeIndexes,
  type IndexHealthEffects,
} from './index-health.ts';
import { ensureDefaultCorpusSchema } from './service.ts';

/**
 * The boot's two steps for the deployment-default knowledge corpus: its
 * schema, on the roles that index (worker and `all`), then, in every role,
 * the verification of its BM25 indexes.
 *
 * The knowledge database is a server of its own (`knowledge-db` in compose,
 * which the backend services do not wait for), so a process that boots while
 * it restarts or is still starting is an ordinary event. Both steps run
 * through a wait of their own (`db/boot-wait.ts`): the app database's wait
 * times the app database's outages, this one the knowledge database's, each
 * from its own first refusal. Two databases that restart together, as a host
 * boots, are each waited out, and a knowledge database that comes back after
 * the app database is not taken for an outage.
 *
 * Neither step fails the boot. An outage that outlasts the wait is reported
 * once, at error level with the boot's tag, as `main.ts` reports the app
 * database's, however many steps it skips, and each step it skips says so in
 * a warning line. The default corpus does not bootstrap again on its first
 * use, as a bring-your-own one does (`core/knowledge/pool.ts`), so a skipped
 * step stays skipped until the process restarts: until then a corrupted
 * index is neither detected nor kept from taking writes.
 */

const WAIT_SECONDS = ROUTINE_RESTART_MS / 1000;

const OUTAGE = `the knowledge database stayed unavailable past the boot's ${WAIT_SECONDS} s wait`;

export interface DefaultKnowledgeBootOptions {
  /** Bring the default corpus's schema up to date first: the worker and
   * `all` roles do, the api role only reads the corpus. */
  readonly bootstrapSchema: boolean;
  /** The knowledge database's wait; one of its own by default. */
  readonly wait?: BootDatabaseWait;
  /** What the index verification does about its report; the production
   * effects by default. */
  readonly effects?: IndexHealthEffects;
}

/** Run the boot's knowledge steps for the default corpus (see the module
 * note). Never throws. */
export async function bootDefaultKnowledge(
  sql: Sql,
  options: DefaultKnowledgeBootOptions,
): Promise<void> {
  const wait = options.wait ?? createBootDatabaseWait();
  let outageReported = false;
  const reportOutage = (error: unknown) => {
    if (outageReported) return;
    outageReported = true;
    reportError(error, { tags: { 'tale.lane': 'boot' } });
  };

  if (options.bootstrapSchema) {
    try {
      await wait(() => ensureDefaultCorpusSchema());
    } catch (error: unknown) {
      // The wait gives up on an unavailable database only past its minute;
      // any other failure it hands back at once.
      if (isDatabaseUnavailable(error, { fromDatabase: true })) {
        console.warn(
          `[backend] default corpus bootstrap skipped: ${OUTAGE} (${describeDatabaseError(error)}); its schema is not brought up to date until this process restarts`,
        );
        reportOutage(error);
      } else {
        console.warn('[backend] default corpus bootstrap failed:', error);
        reportError(error, { tags: { 'tale.lane': 'boot' } });
      }
    }
  }

  let report: IndexHealthReport;
  try {
    report = await verifyDefaultKnowledgeIndexes(sql, options.effects, wait);
  } catch (error: unknown) {
    // The scan reports what the knowledge database answers instead of
    // throwing: what reaches here is a connection string the driver cannot
    // take, or the report's effects failing on the app database.
    console.error('[backend] knowledge index verification failed:', error);
    reportError(error, { tags: { 'tale.lane': 'boot' } });
    return;
  }
  if (report.status === 'unavailable') {
    console.warn(
      `[backend] BM25 index verification of the default corpus skipped: ${OUTAGE}. Until this process restarts, a corrupted index there is neither detected nor kept from taking writes; restart the backend once the knowledge database answers`,
    );
    reportOutage(report.cause);
  }
}
