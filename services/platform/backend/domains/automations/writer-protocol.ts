import type { TransactionSql } from 'postgres';

import { ENGINE_PROTOCOL } from '../../../lib/engine/core/protocol.ts';

/** Only the reserved transaction connection may carry this admission marker.
 * A session or pool default would lend execution authority to an old writer. */
export async function markAutomationWriterInTx(
  tx: TransactionSql,
): Promise<void> {
  await tx`SELECT set_config('tale.automation_writer_protocol', ${String(ENGINE_PROTOCOL)}, true)`;
}
