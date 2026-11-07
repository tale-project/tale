// The fonts the first frame of a page draws with, named in its head as
// preloads, so the browser fetches them with the page rather than once the
// first frame has laid out text in them (@fontsource's faces swap: a heading
// drawn before its weight came changes face a frame later). The Latin subset
// in the weights of the frame: body text (400), the rail's and the tables'
// medium labels (500), headings (600). `@tale/ui/fonts` preloads 400 and 500
// again from the script, and skips a preload that is there already.

/** The weights the first frame of every page draws with. */
export const FIRST_FRAME_WEIGHTS = [400, 500, 600] as const;

/** The built file of the Latin Inter face of each weight, among `assets`. */
export function firstFrameFonts(assets: readonly string[]): string[] {
  return FIRST_FRAME_WEIGHTS.flatMap((weight) => {
    const file = assets.find((name) =>
      new RegExp(`^inter-latin-${weight}-normal-[\\w-]+\\.woff2$`, 'u').test(
        name,
      ),
    );
    return file === undefined ? [] : [file];
  });
}

/**
 * `html` with a preload of each first-frame font in its head, as `@tale/ui`
 * writes one (`crossorigin`: a font's fetch is anonymous CORS, and a preload of
 * another mode is thrown away). A page without a head, or a build without the
 * fonts, is returned as it is.
 */
export function withFontPreloads(
  html: string,
  assets: readonly string[],
): string {
  const links = firstFrameFonts(assets)
    .map(
      (file) =>
        `<link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin>`,
    )
    .join('');
  if (links === '' || !html.includes('</head>')) return html;
  // A function, so a `$&` in a name stays text.
  return html.replace('</head>', () => `${links}</head>`);
}
