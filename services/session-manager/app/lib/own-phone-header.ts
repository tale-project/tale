/** The page of one session: `/sessions/<id>`, and an address that is no id as well (it says so itself). */
const SESSION_PAGE = /^\/sessions\/[^/]+\/?$/;

/**
 * Whether the page brings its own header on a phone (the back arrow, the name
 * of the session, its actions: the library's `ThreadHeader`), so that the bar
 * of the frame, which holds the title a page puts in the adaptive header, would
 * only stack an empty row above it. Mirrors `hasOwnPhoneHeader` of the platform
 * (`app/features/home/lib/home-paths.ts`), which its dashboard shell asks for
 * the same reason (`routes/dashboard/$id.tsx`, `threadPage`).
 *
 * A path beneath a session that no route knows is no page of a session: the
 * page that says there is none stands there, and the frame leaves its bar out
 * for it on its own account (see `AppFrame`).
 */
export function hasOwnPhoneHeader(pathname: string): boolean {
  return SESSION_PAGE.test(pathname);
}
