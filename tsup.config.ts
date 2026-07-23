import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    cjsInterop: true,
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    splitting: false,
    shims: true,
  },
  // CLI binary
  {
    entry: { 'bin/ts-lsp-mcp': 'bin/ts-lsp-mcp.ts' },
    format: ['esm'],
    cjsInterop: true,
    dts: false,
    sourcemap: true,
    target: 'node18',
    splitting: false,
    shims: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
