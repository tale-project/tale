/**
 * External URLs referenced from the marketing site. Centralized here so
 * link swaps (e.g. after re-uploading a terms PDF) touch one file instead
 * of every block that links to it.
 */

export const EXTERNAL_LINKS = {
  softwareTerms: '/files/Service_Agreement_Template.pdf',
  hardwareTerms: '/files/Hardware_Agreement_Template.pdf',
  aiTraining:
    'https://app1.edoobox.com/en/Alltron/Network%20and%20server/K%C3%BCnstliche%20Intelligenz',
  vatCheck: 'https://www.uid.admin.ch/Detail.aspx?uid_id=CHE186532610',
  github: 'https://github.com/tale-project/tale',
} as const;
