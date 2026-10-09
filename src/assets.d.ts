// Vite `?url` asset imports resolve to the emitted, hashed public path (a
// string). This package does not pull in `vite/client`, so its ambient
// declarations are not in scope — declare the query import we rely on
// (fonts.ts preloads the Inter woff2 subsets by URL). Consumers that import
// fonts.ts extend `tsconfig.vite.json`, whose `vite/client` supplies the same
// `*?url` shape.
declare module '*.woff2?url' {
  const src: string;
  export default src;
}

declare module '@fontsource/inter/files/inter-latin-400-normal.woff2?url' {
  const src: string;
  export default src;
}

declare module '@fontsource/inter/files/inter-latin-500-normal.woff2?url' {
  const src: string;
  export default src;
}
