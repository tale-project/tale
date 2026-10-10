import { z } from 'zod';

export const AUTOMATION_PROTOCOL_LABEL = 'io.tale.automation-writer-protocol';
export const AUTOMATION_PROTOCOL_MIGRATION =
  '0163_automation_legacy_protocol.sql';
export const AUTOMATION_PROTOCOL_SOURCE =
  'services/platform/lib/engine/core/protocol.ts';
export const automationWriterProtocolSchema = z.union([
  z.literal(1),
  z.literal(2),
]);
export type AutomationWriterProtocol = z.infer<
  typeof automationWriterProtocolSchema
>;
