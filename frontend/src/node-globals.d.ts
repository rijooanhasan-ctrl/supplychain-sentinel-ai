declare module 'node:fs' {
  export function readFileSync(path: any, encoding?: string): string;
  export function statSync(path: any): { size: number };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}

declare module 'fs' {
  export function readFileSync(path: any, encoding?: string): string;
  export function statSync(path: any): { size: number };
}

declare module 'path' {
  export function resolve(...paths: string[]): string;
}

declare const __dirname: string;
