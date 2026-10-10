/**
 * External URLs referenced from the marketing site. Centralized here so
 * link swaps (e.g. after re-uploading a terms PDF) touch one file instead
 * of every block that links to it.
 */

export const EXTERNAL_LINKS = {
  uiDocs: 'https://ui.tale.dev',
  softwareTerms: '/files/Service_Agreement_Template.pdf',
  hardwareTerms: '/files/Hardware_Agreement_Template.pdf',
  vatCheck: 'https://www.uid.admin.ch/Detail.aspx?uid_id=CHE186532610',
  github: 'https://github.com/tale-project/tale',
  githubReleases: 'https://github.com/tale-project/tale/releases',
} as const;
