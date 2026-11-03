/**
 * What a control of the browser's chrome that has no library component grows
 * to under a finger: a tab, its close button, the rows of a list the page
 * opened. The controls the library draws (buttons, the address field) keep the
 * library's own sizes, as everywhere in the app; these are the ones whose size
 * is this feature's to give, and they take it from this one place.
 */
export const TOUCH_TARGET = 'pointer-coarse:min-h-9 pointer-coarse:min-w-9';

/**
 * The reach of a small control under a finger: an invisible area around it
 * that makes it 44 px in each direction it falls short of, and takes no room
 * from the layout (a pseudo-element of the control itself, as the library does
 * it for its small buttons). A control that is 44 px or more is left alone, and
 * so is every control with a mouse.
 */
export const TOUCH_REACH =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-[min(0px,calc((100%-44px)/2))] pointer-coarse:after:content-['']";
