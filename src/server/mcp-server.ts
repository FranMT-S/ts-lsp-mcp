import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProjectManager, disposeProjectManager } from '../typescript/project-manager.js';
import { positionToOffset, offsetToPosition, getLinePreview } from '../typescript/position-utils.js';
import { serializeType, getSymbolKind, formatDiagnostic } from '../typescript/type-serializer.js';
import { logger } from '../utils/logger.js';
import type { Position } from '../typescript/position-utils.js';
import { registerTraceType } from './tools/trace-type.js';
import { registerRunTypeTests, registerCheckInlineCode } from './tools/type-test.js';

/**
 * Create and configure the MCP server with all tools.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'ts-lsp-mcp',
    version: '0.1.0',
  });

  // Register all tools
  registerGetTypeAtPosition(server);
  registerGetDefinition(server);
  registerGetReferences(server);
  registerGetHover(server);
  registerGetCompletions(server);
  registerGetDiagnostics(server);
  registerTraceType(server);
  registerRunTypeTests(server);
  registerCheckInlineCode(server);

  logger.info('MCP server created with tools');
  return server;
}

// Common input schemas
const FilePositionInput = {
  file: z.string().describe('File path (absolute, relative, or unique filename)'),
  line: z.number().int().positive().describe('Line number (1-indexed)'),
  col: z.number().int().positive().describe('Column number (1-indexed)'),
  projectRoot: z.string().optional().describe('Project root directory (auto-detected if omitted)'),
  content: z.string().optional().describe('File content for virtual/unsaved files'),
};

/**
 * Helper to get project and resolve file.
 */
async function resolveFileInProject(params: {
  file: string;
  projectRoot?: string;
  content?: string;
}) {
  const pm = getProjectManager();

  // Get project (use file or projectRoot to find tsconfig)
  const lookupPath = params.projectRoot ?? params.file;
  const project = await pm.getProject(lookupPath);

  // Resolve file (handles virtual files)
  const resolvedFile = await pm.resolveFile(project, params.file, params.content);

  return { project, resolvedFile };
}

// ============================================================================
// Tool: getTypeAtPosition
// ============================================================================

function registerGetTypeAtPosition(server: McpServer): void {
  server.tool(
    'getTypeAtPosition',
    'Get the TypeScript type at a specific position in a file',
    {
      ...FilePositionInput,
      expandDepth: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .default(1)
        .describe('How deep to expand nested types (0=just name, 5=full detail)'),
    },
    async (params) => {
      try {
        const { project, resolvedFile } = await resolveFileInProject(params);
        const ls = project.languageService;

        // Get source file
        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found or not part of project: ${params.file}`);
        }

        // Convert position to offset
        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        // Get type info
        const typeInfo = ls.getTypeAtPosition(resolvedFile, offset);
        if (!typeInfo) {
          return errorResponse(`No type information at ${params.file}:${params.line}:${params.col}`);
        }

        const typeChecker = ls.getTypeChecker();
        const serialized = serializeType(typeInfo.type, typeChecker, {
          expandDepth: params.expandDepth,
        });

        const result = {
          type: serialized.text,
          expanded: serialized.expanded,
          symbol: typeInfo.symbol?.getName(),
          kind: typeInfo.symbol ? getSymbolKind(typeInfo.symbol) : undefined,
          file: project.fileResolver.relativePath(resolvedFile),
          location: position,
          preview: getLinePreview(sourceFile, position),
        };

        return successResponse(result);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Tool: getDefinition
// ============================================================================

function registerGetDefinition(server: McpServer): void {
  server.tool(
    'getDefinition',
    'Get the definition location(s) for a symbol at a position (go-to-definition)',
    FilePositionInput,
    async (params) => {
      try {
        const { project, resolvedFile } = await resolveFileInProject(params);
        const ls = project.languageService;

        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found: ${params.file}`);
        }

        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        const definitions = ls.getDefinitionAtPosition(resolvedFile, offset);
        if (!definitions || definitions.length === 0) {
          return errorResponse(`No definition found at ${params.file}:${params.line}:${params.col}`);
        }

        const result = definitions.map((def) => {
          const defSourceFile = ls.getSourceFile(def.fileName);
          const defPosition = defSourceFile
            ? offsetToPosition(defSourceFile, def.textSpan.start)
            : { line: 0, col: 0 };

          return {
            file: project.fileResolver.isInProject(def.fileName)
              ? project.fileResolver.relativePath(def.fileName)
              : def.fileName,
            line: defPosition.line,
            col: defPosition.col,
            name: def.name,
            kind: def.kind,
            preview: defSourceFile ? getLinePreview(defSourceFile, defPosition) : undefined,
          };
        });

        return successResponse({ definitions: result });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Tool: getReferences
// ============================================================================

function registerGetReferences(server: McpServer): void {
  server.tool(
    'getReferences',
    'Find all references to a symbol at a position',
    {
      ...FilePositionInput,
      maxResults: z.number().int().positive().optional().default(50).describe('Maximum number of results'),
      includeNodeModules: z.boolean().optional().default(false).describe('Include references in node_modules'),
    },
    async (params) => {
      try {
        const { project, resolvedFile } = await resolveFileInProject(params);
        const ls = project.languageService;

        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found: ${params.file}`);
        }

        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        let references = ls.getReferencesAtPosition(resolvedFile, offset);
        if (!references || references.length === 0) {
          return errorResponse(`No references found at ${params.file}:${params.line}:${params.col}`);
        }

        // Filter node_modules if requested
        if (!params.includeNodeModules) {
          references = references.filter((ref) => !ref.fileName.includes('node_modules'));
        }

        const totalCount = references.length;
        const truncated = totalCount > params.maxResults;

        const result = references.slice(0, params.maxResults).map((ref) => {
          const refSourceFile = ls.getSourceFile(ref.fileName);
          const refPosition = refSourceFile
            ? offsetToPosition(refSourceFile, ref.textSpan.start)
            : { line: 0, col: 0 };

          return {
            file: project.fileResolver.isInProject(ref.fileName)
              ? project.fileResolver.relativePath(ref.fileName)
              : ref.fileName,
            line: refPosition.line,
            col: refPosition.col,
            isWriteAccess: ref.isWriteAccess,
            preview: refSourceFile ? getLinePreview(refSourceFile, refPosition) : undefined,
          };
        });

        return successResponse({
          totalCount,
          references: result,
          truncated,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Tool: getHover
// ============================================================================

function registerGetHover(server: McpServer): void {
  server.tool(
    'getHover',
    'Get hover information (documentation, type signature) at a position',
    FilePositionInput,
    async (params) => {
      try {
        const { project, resolvedFile } = await resolveFileInProject(params);
        const ls = project.languageService;

        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found: ${params.file}`);
        }

        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        const quickInfo = ls.getQuickInfoAtPosition(resolvedFile, offset);
        if (!quickInfo) {
          return errorResponse(`No hover information at ${params.file}:${params.line}:${params.col}`);
        }

        const displayParts = quickInfo.displayParts?.map((p) => p.text).join('') ?? '';
        const documentation = quickInfo.documentation?.map((d) => d.text).join('\n') ?? '';

        const tags = quickInfo.tags?.map((tag) => ({
          name: tag.name,
          text: tag.text?.map((t) => t.text).join('') ?? '',
        }));

        return successResponse({
          displayString: displayParts,
          documentation: documentation || undefined,
          tags: tags?.length ? tags : undefined,
          kind: quickInfo.kind,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Tool: getCompletions
// ============================================================================

function registerGetCompletions(server: McpServer): void {
  server.tool(
    'getCompletions',
    'Get autocomplete suggestions at a position',
    {
      ...FilePositionInput,
      prefix: z.string().optional().describe('Filter completions starting with this prefix'),
      maxResults: z.number().int().positive().optional().default(30).describe('Maximum number of results'),
    },
    async (params) => {
      try {
        const { project, resolvedFile } = await resolveFileInProject(params);
        const ls = project.languageService;

        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found: ${params.file}`);
        }

        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        const completions = ls.getCompletionsAtPosition(resolvedFile, offset);
        if (!completions || completions.entries.length === 0) {
          return successResponse({ completions: [], isIncomplete: false });
        }

        let entries = completions.entries;

        // Filter by prefix if provided
        if (params.prefix) {
          const prefix = params.prefix.toLowerCase();
          entries = entries.filter((e) => e.name.toLowerCase().startsWith(prefix));
        }

        const totalCount = entries.length;
        const isIncomplete = totalCount > params.maxResults;

        const result = entries.slice(0, params.maxResults).map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          sortText: entry.sortText,
          isRecommended: entry.isRecommended,
        }));

        return successResponse({
          completions: result,
          isIncomplete,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Tool: getDiagnostics
// ============================================================================

function registerGetDiagnostics(server: McpServer): void {
  server.tool(
    'getDiagnostics',
    'Get TypeScript diagnostics (errors, warnings) for a file or project',
    {
      file: z.string().optional().describe('File to check (omit for all project files)'),
      projectRoot: z.string().optional().describe('Project root directory'),
      content: z.string().optional().describe('File content for virtual/unsaved files'),
      severity: z
        .enum(['error', 'warning', 'all'])
        .optional()
        .default('all')
        .describe('Filter by severity'),
    },
    async (params) => {
      try {
        const pm = getProjectManager();

        // Get project
        const lookupPath = params.projectRoot ?? params.file ?? process.cwd();
        const project = await pm.getProject(lookupPath);

        // Handle virtual file if content provided
        if (params.file && params.content !== undefined) {
          await pm.resolveFile(project, params.file, params.content);
        }

        // Get diagnostics
        const ls = project.languageService;
        let diagnostics = params.file
          ? ls.getDiagnostics(await project.fileResolver.resolve(params.file))
          : ls.getDiagnostics();

        // Filter by severity
        if (params.severity === 'error') {
          diagnostics = diagnostics.filter(
            (d) => d.category === 1 // ts.DiagnosticCategory.Error
          );
        } else if (params.severity === 'warning') {
          diagnostics = diagnostics.filter(
            (d) => d.category === 0 // ts.DiagnosticCategory.Warning
          );
        }

        const formatted = diagnostics.map((d) => formatDiagnostic(d, { includeFile: true }));

        const summary = {
          errors: formatted.filter((d) => d.severity === 'error').length,
          warnings: formatted.filter((d) => d.severity === 'warning').length,
        };

        return successResponse({
          diagnostics: formatted.map((d) => ({
            ...d,
            file: d.file ? project.fileResolver.relativePath(d.file) : undefined,
          })),
          summary,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

// ============================================================================
// Response helpers
// ============================================================================

function successResponse(data: object) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResponse(message: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Cleanup on server shutdown.
 */
export function shutdownServer(): void {
  disposeProjectManager();
  logger.info('MCP server shutdown complete');
}
