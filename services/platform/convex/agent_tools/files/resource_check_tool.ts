/** Convex Tool: resource_check
 *  Check whether a remote resource (image, document, or other file URL) is accessible.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import {
  checkResourceAccessible,
  type ResourceCheckResult,
} from './helpers/check_resource_accessible';

export const resourceCheckTool = {
  name: 'resource_check' as const,
  tool: createTool({
    description: `Check whether a remote resource (image, document, or other file URL) is accessible.

Use this tool when you need to verify that a URL the user provided actually works (for example, before embedding an image or linking to a file in an email).

The tool performs a lightweight HTTP HEAD request and returns status code and basic metadata without downloading the full content.

Returns:
- success: whether the check completed successfully (network-level)
- ok: whether the HTTP status indicates success (2xx)
- status: HTTP status code
- url: original URL that was checked
- finalUrl: final URL after redirects
- contentType: Content-Type header if available
- contentLength: Content-Length header (in bytes) if available
- isImage: true if the Content-Type starts with "image/"
- error: error message when success=false

EXAMPLE USAGE:
• { "url": "https://example.com/logo.png" }
• { "url": "https://example.com/report.pdf" }
`,
    args: z.object({
      url: z
        .string()
        .describe(
          'HTTP or HTTPS URL of the resource (image, document, or other file) to check.',
        ),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional timeout in milliseconds for the check (default: 10000).',
        ),
    }),
    handler: async (
      _ctx: ToolCtx,
      args,
    ): Promise<ResourceCheckResult> => {
      return checkResourceAccessible({
        url: args.url,
        timeoutMs: args.timeout_ms,
      });
    },
  }),
} as const satisfies ToolDefinition;
