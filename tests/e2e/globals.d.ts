// Shared Window globals set by the e2e fixtures. Each fixture only
// populates the properties it uses; all are optional in TypeScript so
// specs can rely on `?.` and runtime checks.

declare global {
  interface Window {
    __done?: boolean;

    // lifecycle.html
    __ns?: string;
    __seed?: (initial: unknown) => Promise<{
      value?: unknown;
      revision?: number;
      error?: string;
    }>;
    __setTitle?: (title: string) => Promise<{
      value: { title: string; blocks: unknown[] };
      revision: number;
    }>;
    __updateAppend?: (block: unknown) => Promise<{
      value: { title: string; blocks: unknown[] };
      revision: number;
    }>;
    __reset?: () => Promise<{ value: unknown; revision: number }>;
    __destroy?: () => Promise<true>;

    // cross-tab.html
    __ready?: boolean;
    __events?: Array<{ n: number; revision: number; source: string }>;
    __value?: () => { n: number };
    __revision?: () => number;
    __increment?: () => Promise<{
      value?: { n: number };
      revision?: number;
      error?: string;
    }>;

    // unsupported.html
    __result?: {
      threw: boolean;
      code?: string;
      operation?: string;
      message?: string;
      storage?: {
        engine: string;
        evictionRisk: string;
        persistent: boolean;
      };
      storageError?: string;
    };
  }
}

export {};
