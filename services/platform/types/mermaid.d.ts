/** Minimal type declarations for mermaid (loaded dynamically at runtime via CDN or lazy chunk). */
declare module 'mermaid' {
  interface MermaidConfig {
    startOnLoad?: boolean;
    theme?: string;
    securityLevel?: string;
    [key: string]: unknown;
  }

  interface RenderResult {
    svg: string;
  }

  interface MermaidAPI {
    initialize: (config: MermaidConfig) => void;
    render: (id: string, code: string) => Promise<RenderResult>;
  }

  const mermaid: MermaidAPI;
  export default mermaid;
}
