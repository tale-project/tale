/** Convex Tool: resource_check
 *  Check whether a remote resource (image, document, or other file URL) is accessible.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import {
  checkResourcesAccessibleBatch,
  type ResourceCheckBatchResult,
} from './helpers/check_resource_accessible';

export const resourceCheckTool = {
  name: 'resource_check' as const,
  tool: createTool({
    description: `Check whether remote resources (image, document, or other file URLs) are accessible.

Use this tool when you need to verify that URLs the user provided actually work (for example, before embedding images or linking to files in emails).

The tool performs lightweight HTTP HEAD requests in parallel and returns status codes and metadata without downloading content.

Input:
- urls: array of 1-20 HTTP/HTTPS URLs to check

Returns an object with "results" array, each item containing:
- success: whether the check completed successfully (network-level)
- ok: whether the HTTP status indicates success (2xx)
- status: HTTP status code
- url: original URL that was checked
- finalUrl: final URL after redirects
- contentType: Content-Type header if available
- contentLength: Content-Length header (in bytes) if available
- isImage: true if the Content-Type starts with "image/"
- error: error message when success=false

EXAMPLES:
• Single URL: { "urls": ["https://example.com/logo.png"] }
• Multiple URLs: { "urls": ["https://example.com/a.png", "https://example.com/b.pdf"] }
`,
    args: z.object({
      urls: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe('Array of HTTP/HTTPS URLs to check (1-20 URLs)'),
      timeout_ms: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional timeout in milliseconds for each check (default: 10000).',
        ),
    }),
    handler: async (
      _ctx: ToolCtx,
      args,
    ): Promise<ResourceCheckBatchResult> => {
      return checkResourcesAccessibleBatch({
        urls: args.urls,
        timeoutMs: args.timeout_ms,
      });
    },
  }),
} as const satisfies ToolDefinition;
