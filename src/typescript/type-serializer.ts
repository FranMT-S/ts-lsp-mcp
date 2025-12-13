import ts from 'typescript';

/**
 * Options for serializing types.
 */
export interface SerializeOptions {
  /** How deep to expand nested types (0 = just name) */
  expandDepth?: number;
  /** Maximum output length in characters */
  maxLength?: number;
  /** Include type flags/kind info */
  includeKind?: boolean;
}

const DEFAULT_OPTIONS: Required<SerializeOptions> = {
  expandDepth: 1,
  maxLength: 50000,
  includeKind: false,
};

/**
 * Serialized type information.
 */
export interface TypeInfo {
  /** Type as a string (e.g., "string | number") */
  text: string;
  /** Expanded type with more detail (if expandDepth > 0) */
  expanded?: string;
  /** Type kind/flags info (if includeKind) */
  kind?: string;
  /** Whether output was truncated */
  truncated?: boolean;
}

/**
 * Serialize a TypeScript type to a readable string.
 */
export function serializeType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  options: SerializeOptions = {}
): TypeInfo {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seen = new Set<ts.Type>();

  // Get basic type string
  const text = typeChecker.typeToString(type);

  const result: TypeInfo = { text };

  // Expand if requested
  if (opts.expandDepth > 0) {
    const expanded = expandType(type, typeChecker, opts.expandDepth, seen);
    if (expanded !== text) {
      result.expanded = truncate(expanded, opts.maxLength);
      if (expanded.length > opts.maxLength) {
        result.truncated = true;
      }
    }
  }

  // Include kind if requested
  if (opts.includeKind) {
    result.kind = getTypeKindString(type);
  }

  return result;
}

/**
 * Expand a type with more detail.
 */
function expandType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  depth: number,
  seen: Set<ts.Type>
): string {
  if (depth <= 0 || seen.has(type)) {
    return typeChecker.typeToString(type);
  }

  // Don't expand built-in/primitive types
  if (isBuiltInType(type)) {
    return typeChecker.typeToString(type);
  }

  seen.add(type);

  // Handle union types
  if (type.isUnion()) {
    const parts = type.types.map((t) =>
      expandType(t, typeChecker, depth - 1, seen)
    );
    return parts.join(' | ');
  }

  // Handle intersection types
  if (type.isIntersection()) {
    const parts = type.types.map((t) =>
      expandType(t, typeChecker, depth - 1, seen)
    );
    return parts.join(' & ');
  }

  // Handle array types
  const numberIndexType = type.getNumberIndexType();
  if (numberIndexType) {
    const elementType = expandType(numberIndexType, typeChecker, depth - 1, seen);
    return `${elementType}[]`;
  }

  // Handle function types
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length > 0) {
    const sig = callSignatures[0]!;
    const params = sig.getParameters().map((p) => {
      const paramType = typeChecker.getTypeOfSymbolAtLocation(
        p,
        p.valueDeclaration!
      );
      return `${p.name}: ${typeChecker.typeToString(paramType)}`;
    });
    const returnType = typeChecker.typeToString(sig.getReturnType());
    return `(${params.join(', ')}) => ${returnType}`;
  }

  // Handle object types with properties
  const properties = type.getProperties();
  if (properties.length > 0) {
    const props = properties.slice(0, 20).map((prop) => {
      const propType = typeChecker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration ?? prop.declarations?.[0]!
      );
      // Only expand one level deep for properties to avoid explosion
      const propTypeStr = typeChecker.typeToString(propType);
      const optional = prop.flags & ts.SymbolFlags.Optional ? '?' : '';
      return `${prop.name}${optional}: ${propTypeStr}`;
    });

    if (properties.length > 20) {
      props.push(`... ${properties.length - 20} more properties`);
    }

    return `{ ${props.join('; ')} }`;
  }

  return typeChecker.typeToString(type);
}

/**
 * Check if a type is a built-in type that shouldn't be expanded.
 */
function isBuiltInType(type: ts.Type): boolean {
  // Don't expand primitive types
  const flags = type.flags;
  if (
    flags & ts.TypeFlags.String ||
    flags & ts.TypeFlags.Number ||
    flags & ts.TypeFlags.Boolean ||
    flags & ts.TypeFlags.BigInt ||
    flags & ts.TypeFlags.ESSymbol ||
    flags & ts.TypeFlags.Void ||
    flags & ts.TypeFlags.Undefined ||
    flags & ts.TypeFlags.Null ||
    flags & ts.TypeFlags.Never
  ) {
    return true;
  }

  const symbol = type.getSymbol();
  if (!symbol) return false;

  const name = symbol.getName();
  const builtIns = [
    'Array',
    'Map',
    'Set',
    'Promise',
    'Date',
    'RegExp',
    'Error',
    'String',
    'Number',
    'Boolean',
    'Object',
    'Function',
    'Symbol',
  ];

  return builtIns.includes(name);
}

/**
 * Get a string describing the type kind.
 */
function getTypeKindString(type: ts.Type): string {
  const flags = type.flags;
  const kinds: string[] = [];

  if (flags & ts.TypeFlags.String) kinds.push('string');
  if (flags & ts.TypeFlags.Number) kinds.push('number');
  if (flags & ts.TypeFlags.Boolean) kinds.push('boolean');
  if (flags & ts.TypeFlags.Void) kinds.push('void');
  if (flags & ts.TypeFlags.Undefined) kinds.push('undefined');
  if (flags & ts.TypeFlags.Null) kinds.push('null');
  if (flags & ts.TypeFlags.Never) kinds.push('never');
  if (flags & ts.TypeFlags.Unknown) kinds.push('unknown');
  if (flags & ts.TypeFlags.Any) kinds.push('any');
  if (flags & ts.TypeFlags.StringLiteral) kinds.push('string-literal');
  if (flags & ts.TypeFlags.NumberLiteral) kinds.push('number-literal');
  if (flags & ts.TypeFlags.BooleanLiteral) kinds.push('boolean-literal');
  if (flags & ts.TypeFlags.Union) kinds.push('union');
  if (flags & ts.TypeFlags.Intersection) kinds.push('intersection');
  if (flags & ts.TypeFlags.Object) kinds.push('object');
  if (flags & ts.TypeFlags.TypeParameter) kinds.push('type-parameter');

  return kinds.join(', ') || 'unknown';
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Get the kind of a symbol (variable, function, class, etc).
 */
export function getSymbolKind(symbol: ts.Symbol): string {
  const flags = symbol.flags;

  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type-alias';
  if (flags & ts.SymbolFlags.Enum) return 'enum';
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Method) return 'method';
  if (flags & ts.SymbolFlags.Property) return 'property';
  if (flags & ts.SymbolFlags.FunctionScopedVariable) return 'parameter';
  if (flags & ts.SymbolFlags.Variable) return 'variable';
  if (flags & ts.SymbolFlags.Module) return 'module';
  if (flags & ts.SymbolFlags.Namespace) return 'namespace';

  return 'unknown';
}

/**
 * Format a diagnostic message for display.
 */
export function formatDiagnostic(
  diagnostic: ts.Diagnostic,
  options: { includeFile?: boolean } = {}
): {
  message: string;
  code: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  file?: string;
  line?: number;
  col?: number;
} {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const code = diagnostic.code;

  let severity: 'error' | 'warning' | 'info' | 'hint';
  switch (diagnostic.category) {
    case ts.DiagnosticCategory.Error:
      severity = 'error';
      break;
    case ts.DiagnosticCategory.Warning:
      severity = 'warning';
      break;
    case ts.DiagnosticCategory.Suggestion:
      severity = 'hint';
      break;
    default:
      severity = 'info';
  }

  const result: ReturnType<typeof formatDiagnostic> = {
    message,
    code,
    severity,
  };

  if (options.includeFile && diagnostic.file && diagnostic.start !== undefined) {
    result.file = diagnostic.file.fileName;
    const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    result.line = pos.line + 1;
    result.col = pos.character + 1;
  }

  return result;
}
