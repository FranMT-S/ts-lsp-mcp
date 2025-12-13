import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import ts from 'typescript';
import * as path from 'node:path';
import { getProjectManager } from '../../typescript/project-manager.js';
import { positionToOffset } from '../../typescript/position-utils.js';
import type { Position } from '../../typescript/position-utils.js';

/**
 * Traced type information showing composition and origin.
 */
interface TypeTrace {
  /** The type as a string */
  type: string;
  /** Kind of type composition */
  kind: TypeKind;
  /** Where this type is defined */
  definedAt?: {
    file: string;
    line: number;
    col: number;
  };
  /** For compound types, their components */
  components?: TypeTrace[];
  /** For objects, their properties */
  properties?: PropertyTrace[];
  /** Additional info */
  info?: string;
}

interface PropertyTrace {
  name: string;
  type: string;
  optional: boolean;
}

type TypeKind =
  | 'primitive'
  | 'literal'
  | 'union'
  | 'intersection'
  | 'object'
  | 'interface'
  | 'class'
  | 'type-alias'
  | 'function'
  | 'array'
  | 'tuple'
  | 'generic'
  | 'utility-type'
  | 'mapped-type'
  | 'conditional'
  | 'unknown';

const FilePositionInput = {
  file: z.string().describe('File path (absolute, relative, or unique filename)'),
  line: z.number().int().positive().describe('Line number (1-indexed)'),
  col: z.number().int().positive().describe('Column number (1-indexed)'),
  projectRoot: z.string().optional().describe('Project root directory'),
  content: z.string().optional().describe('File content for virtual/unsaved files'),
};

/**
 * Register the traceType tool.
 */
export function registerTraceType(server: McpServer): void {
  server.tool(
    'traceType',
    'Trace where a type comes from and how it is composed',
    {
      ...FilePositionInput,
      depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(3)
        .describe('How deep to trace type composition'),
    },
    async (params) => {
      try {
        const pm = getProjectManager();
        const lookupPath = params.projectRoot ?? params.file;
        const project = await pm.getProject(lookupPath);

        // Handle virtual file
        let resolvedFile: string;
        if (params.content !== undefined) {
          resolvedFile = path.isAbsolute(params.file)
            ? params.file
            : path.join(project.projectRoot, params.file);
          project.languageService.setVirtualFile(resolvedFile, params.content);
        } else {
          resolvedFile = await project.fileResolver.resolve(params.file);
        }

        const ls = project.languageService;
        const sourceFile = ls.getSourceFile(resolvedFile);
        if (!sourceFile) {
          return errorResponse(`File not found: ${params.file}`);
        }

        const position: Position = { line: params.line, col: params.col };
        const offset = positionToOffset(sourceFile, position);

        // Get type at position
        const typeInfo = ls.getTypeAtPosition(resolvedFile, offset);
        if (!typeInfo) {
          return errorResponse(
            `No type information at ${params.file}:${params.line}:${params.col}`
          );
        }

        const typeChecker = ls.getTypeChecker();
        const trace = traceType(typeInfo.type, typeChecker, params.depth, new Set(), project.projectRoot);

        return successResponse(trace);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/**
 * Recursively trace a type's composition and origin.
 */
function traceType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  depth: number,
  seen: Set<ts.Type>,
  projectRoot: string
): TypeTrace {
  const typeStr = typeChecker.typeToString(type);

  // Base case
  if (depth <= 0 || seen.has(type)) {
    return { type: typeStr, kind: getTypeKind(type) };
  }
  seen.add(type);

  const kind = getTypeKind(type);
  const trace: TypeTrace = { type: typeStr, kind };

  // Get definition location
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol) {
    const declarations = symbol.getDeclarations();
    if (declarations && declarations.length > 0) {
      const decl = declarations[0]!;
      const sourceFile = decl.getSourceFile();
      const pos = sourceFile.getLineAndCharacterOfPosition(decl.getStart());

      // Make path relative if in project
      let filePath = sourceFile.fileName;
      if (!filePath.includes('node_modules')) {
        filePath = path.relative(projectRoot, filePath);
      }

      trace.definedAt = {
        file: filePath,
        line: pos.line + 1,
        col: pos.character + 1,
      };
    }
  }

  // Trace components based on type kind
  if (type.isUnion()) {
    trace.components = type.types.map((t) =>
      traceType(t, typeChecker, depth - 1, seen, projectRoot)
    );
  } else if (type.isIntersection()) {
    trace.components = type.types.map((t) =>
      traceType(t, typeChecker, depth - 1, seen, projectRoot)
    );
  } else if (type.aliasSymbol) {
    // Type alias - trace the aliased type
    const aliasedType = type.aliasTypeArguments?.[0];
    if (aliasedType) {
      trace.components = [traceType(aliasedType, typeChecker, depth - 1, seen, projectRoot)];
    }
  }

  // For object types, trace properties
  if (kind === 'object' || kind === 'interface' || kind === 'class') {
    const properties = type.getProperties();
    if (properties.length > 0 && properties.length <= 20) {
      trace.properties = properties.map((prop) => {
        const propType = typeChecker.getTypeOfSymbolAtLocation(
          prop,
          prop.valueDeclaration ?? prop.declarations?.[0]!
        );
        return {
          name: prop.name,
          type: typeChecker.typeToString(propType),
          optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        };
      });
    } else if (properties.length > 20) {
      trace.info = `Object has ${properties.length} properties (truncated)`;
    }
  }

  // For utility types like Omit, Pick, etc.
  if (type.aliasSymbol) {
    const aliasName = type.aliasSymbol.getName();
    const utilityTypes = ['Omit', 'Pick', 'Partial', 'Required', 'Readonly', 'Record', 'ReturnType', 'Parameters'];
    if (utilityTypes.includes(aliasName)) {
      trace.kind = 'utility-type';
      trace.info = `${aliasName}<${type.aliasTypeArguments?.map(t => typeChecker.typeToString(t)).join(', ')}>`;
    }
  }

  return trace;
}

/**
 * Determine the kind of a type.
 */
function getTypeKind(type: ts.Type): TypeKind {
  const flags = type.flags;

  // Primitives
  if (flags & ts.TypeFlags.String) return 'primitive';
  if (flags & ts.TypeFlags.Number) return 'primitive';
  if (flags & ts.TypeFlags.Boolean) return 'primitive';
  if (flags & ts.TypeFlags.Void) return 'primitive';
  if (flags & ts.TypeFlags.Undefined) return 'primitive';
  if (flags & ts.TypeFlags.Null) return 'primitive';
  if (flags & ts.TypeFlags.Never) return 'primitive';
  if (flags & ts.TypeFlags.Any) return 'primitive';
  if (flags & ts.TypeFlags.Unknown) return 'primitive';

  // Literals
  if (flags & ts.TypeFlags.StringLiteral) return 'literal';
  if (flags & ts.TypeFlags.NumberLiteral) return 'literal';
  if (flags & ts.TypeFlags.BooleanLiteral) return 'literal';

  // Compound types
  if (flags & ts.TypeFlags.Union) return 'union';
  if (flags & ts.TypeFlags.Intersection) return 'intersection';

  // Check for specific object types
  const symbol = type.getSymbol();
  if (symbol) {
    if (symbol.flags & ts.SymbolFlags.Class) return 'class';
    if (symbol.flags & ts.SymbolFlags.Interface) return 'interface';
    if (symbol.flags & ts.SymbolFlags.TypeAlias) return 'type-alias';
  }

  if (type.aliasSymbol) return 'type-alias';

  // Check for function
  if (type.getCallSignatures().length > 0) return 'function';

  // Check for array
  if (type.getNumberIndexType()) return 'array';

  // Generic object
  if (flags & ts.TypeFlags.Object) return 'object';

  return 'unknown';
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
