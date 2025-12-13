import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';
import * as path from 'node:path';
import { getProjectManager } from '../../typescript/project-manager.js';
import { runTypeTests as runTests } from '../../type-tests/runner.js';
import { findTsConfig } from '../../utils/tsconfig-finder.js';

/**
 * Register the runTypeTests tool.
 */
export function registerRunTypeTests(server: McpServer): void {
  server.tool(
    'runTypeTests',
    'Run type test assertions from files with @ts-lsp-mcp expect-type/expect-error comments',
    {
      file: z.string().optional().describe('Specific file to test'),
      pattern: z.string().optional().describe('Glob pattern for test files'),
      projectRoot: z.string().optional().describe('Project root directory'),
    },
    async (params) => {
      try {
        const pm = getProjectManager();
        const lookupPath = params.projectRoot ?? params.file ?? process.cwd();
        const project = await pm.getProject(lookupPath);

        const results = await runTests(project, {
          file: params.file,
          pattern: params.pattern,
        });

        return successResponse(results);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/**
 * Register the checkInlineCode tool.
 */
export function registerCheckInlineCode(server: McpServer): void {
  server.tool(
    'checkInlineCode',
    'Type-check inline TypeScript code without creating a file',
    {
      code: z.string().describe('TypeScript code to type-check'),
      tsconfig: z.string().optional().describe('Path to tsconfig.json for compiler settings'),
      fileName: z.string().optional().default('__inline__.ts').describe('Virtual filename'),
    },
    async (params) => {
      try {
        // Find or use tsconfig
        let compilerOptions: ts.CompilerOptions = {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        };

        if (params.tsconfig) {
          const configFile = ts.readConfigFile(params.tsconfig, ts.sys.readFile);
          if (!configFile.error) {
            const parsed = ts.parseJsonConfigFileContent(
              configFile.config,
              ts.sys,
              path.dirname(params.tsconfig)
            );
            compilerOptions = parsed.options;
          }
        }

        // Create a virtual source file
        const sourceFile = ts.createSourceFile(
          params.fileName,
          params.code,
          compilerOptions.target ?? ts.ScriptTarget.ES2022,
          true
        );

        // Create a minimal program for type-checking
        const host = createInlineHost(params.code, params.fileName, compilerOptions);
        const program = ts.createProgram([params.fileName], compilerOptions, host);

        // Get diagnostics
        const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile);
        const semanticDiagnostics = program.getSemanticDiagnostics(sourceFile);
        const allDiagnostics = [...syntacticDiagnostics, ...semanticDiagnostics];

        const diagnostics = allDiagnostics.map((d) => {
          const pos = d.start !== undefined && d.file
            ? d.file.getLineAndCharacterOfPosition(d.start)
            : null;

          return {
            line: pos ? pos.line + 1 : undefined,
            col: pos ? pos.character + 1 : undefined,
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
            severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
          };
        });

        const valid = allDiagnostics.filter(
          (d) => d.category === ts.DiagnosticCategory.Error
        ).length === 0;

        return successResponse({
          valid,
          diagnostics,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/**
 * Create a compiler host for inline code checking.
 */
function createInlineHost(
  code: string,
  fileName: string,
  options: ts.CompilerOptions
): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost(options);

  return {
    ...defaultHost,
    getSourceFile: (name, languageVersion) => {
      if (name === fileName) {
        return ts.createSourceFile(name, code, languageVersion, true);
      }
      return defaultHost.getSourceFile(name, languageVersion);
    },
    fileExists: (name) => {
      if (name === fileName) return true;
      return defaultHost.fileExists(name);
    },
    readFile: (name) => {
      if (name === fileName) return code;
      return defaultHost.readFile(name);
    },
  };
}

function successResponse(data: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
