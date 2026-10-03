/** Discovery paths are real documentation pages; their localized frontmatter
 * supplies card titles/descriptions to keep the entry points current. */
export const HOME_GUIDES = {
  featured: 'get-started/editors',
  paths: [
    'get-started/members',
    'get-started/admins',
    'get-started/developers',
  ],
  tutorials: [
    'tutorials/member/use-projects',
    'tutorials/editor/first-agent-end-to-end',
    'tutorials/editor/workflow-with-approvals',
  ],
  reference: ['platform', 'develop/api-reference', 'self-hosted', 'cloud'],
} as const;
