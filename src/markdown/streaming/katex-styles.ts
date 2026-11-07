// KaTeX's stylesheet as a module of its own, so the streaming renderer can
// load it together with `rehype-katex` (`lazy-katex.ts`): a side-effect
// import, like `../markdown.tsx`'s, so the bundler rebases the stylesheet's
// webfont `url()`s to hashed build assets.
import 'katex/dist/katex.min.css';
