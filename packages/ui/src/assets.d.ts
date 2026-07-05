// Vite `?url` asset imports resolve to the emitted, hashed public path (a
// string). This package pins `compilerOptions.types` (see tsconfig.json), so
// `vite/client`'s ambient declarations aren't in scope — declare the query
// import we rely on (fonts.ts preloads the Inter woff2 subsets by URL).
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
