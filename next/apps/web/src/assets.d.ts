/** Stylesheet imports are handled by Rsbuild at runtime. */
declare module '*.css' {
  const stylesheet: string;
  export default stylesheet;
}
