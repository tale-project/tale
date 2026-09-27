/**
 * The keys an automation's editors report their drafts under — what the
 * detail strip intersects with a tab's `dirtyKeys` to light that tab's
 * unsaved dot. One module, so the tabs and the editors cannot drift apart.
 */

/** The Editor tab's draft: the automation's document. */
export const DOCUMENT_DIRTY_KEY = 'document';

/** The General tab's sections: the trigger binding and the project set. */
export const TRIGGER_DIRTY_KEY = 'trigger';
export const PROJECTS_DIRTY_KEY = 'projects';
