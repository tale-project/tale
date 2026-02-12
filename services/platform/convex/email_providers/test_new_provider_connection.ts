import type {
  TestConnectionArgs,
  TestConnectionDeps,
} from './test_connection_types';
import type { TestResult } from './test_existing_provider';

import { testImapConnection } from './test_imap_connection';
import { testSmtpConnection } from './test_smtp_connection';

export async function testNewProviderConnection(
  args: TestConnectionArgs,
  deps: TestConnectionDeps,
): Promise<TestResult> {
  const smtp = await testSmtpConnection(args, deps);
  const imap = await testImapConnection(args, deps);

  return {
    success: smtp.success && imap.success,
    smtp,
    imap,
  };
}
