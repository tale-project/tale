/**
 * High-level helper that runs both SMTP and IMAP tests and returns a combined result.
 */

import type { TestResult } from './test_existing_provider';
import type { TestConnectionArgs, TestConnectionDeps } from './test_connection_types';
import { testSmtpConnectionLogic } from './test_smtp_connection_logic';
import { testImapConnectionLogic } from './test_imap_connection_logic';

export async function testNewProviderConnectionLogic(
  args: TestConnectionArgs,
  deps: TestConnectionDeps,
): Promise<TestResult> {
  const smtp = await testSmtpConnectionLogic(args, deps);
  const imap = await testImapConnectionLogic(args, deps);

  return {
    success: smtp.success && imap.success,
    smtp,
    imap,
  };
}
