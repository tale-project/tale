/**
 * The focus ring of the summary of a `CollapsibleDetails`. The library leaves it
 * to the browser's own ring (`outline: auto`), which each platform draws in its
 * own colours: the one of a Mac is the accent colour, the one of Windows and
 * Linux a two-tone ring whose computed colour is a dark grey, so what a script
 * can read from it (and a person with a screen magnifier in the dark theme can
 * see of it) is not what every other control of the app shows. This is the ring
 * of the app's own tokens, inside the row so that a card that clips what
 * overflows does not cut it.
 */
export const SUMMARY_FOCUS_CLASS =
  '[&>summary:focus-visible]:outline-2 [&>summary:focus-visible]:-outline-offset-2 [&>summary:focus-visible]:outline-ring';
