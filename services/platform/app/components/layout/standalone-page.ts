/**
 * The frame of a page OUTSIDE the app shell — sign-in, onboarding, 2FA
 * enrolment, a forced password change, the root 404, the API docs.
 *
 * The platform locks document scroll (`locals.css`: `html`, `body` and
 * `#root` are `overflow: clip`) so the shell owns its scroll regions. A page
 * that is not in the shell must therefore scroll ITSELF: it is exactly the
 * viewport tall and scrolls whatever is taller. `min-h-dvh` only grew such a
 * page past the viewport, where the clipped document showed none of it — on a
 * phone held sideways, a short phone or at 200% zoom the Log in button sat
 * below the fold with no way to reach it.
 */
export const STANDALONE_PAGE = 'h-dvh overflow-y-auto';
