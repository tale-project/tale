/**
 * Shared attachment utilities for AI agents.
 */

export * from './types';
export * from './register_files';
export * from './build_multi_modal_content';
export * from './format_markdown';
// `process_attachments.ts` is retired —
// it served the retired chat pipeline (image analysis / file parsing via
// `convex/agent_tools/files/helpers/`) and had no other live importer.
