import ts from 'typescript';

/**
 * A type test assertion parsed from source code.
 */
export interface TypeTestAssertion {
  /** Line number (1-indexed) where the assertion comment appears */
  line: number;
  /** Type of assertion */
  kind: 'expect-type' | 'expect-error';
  /** Expected type string or error code */
  expected: string;
  /** The line of code being tested (next line after the comment) */
  codeLine: number;
  /** Column to check (usually 1, start of line) */
  codeCol: number;
}

/**
 * Regex patterns for type test comments.
 * Format: // @ts-lsp-mcp expect-type: SomeType
 *         // @ts-lsp-mcp expect-error: 2322
 */
const EXPECT_TYPE_REGEX = /\/\/\s*@ts-lsp-mcp\s+expect-type:\s*(.+)$/;
const EXPECT_ERROR_REGEX = /\/\/\s*@ts-lsp-mcp\s+expect-error:\s*(\d+)$/;

/**
 * Parse type test assertions from a source file.
 */
export function parseTypeTests(sourceFile: ts.SourceFile): TypeTestAssertion[] {
  const assertions: TypeTestAssertion[] = [];
  const text = sourceFile.getFullText();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const lineNumber = i + 1; // 1-indexed

    // Check for expect-type
    const typeMatch = line.match(EXPECT_TYPE_REGEX);
    if (typeMatch) {
      assertions.push({
        line: lineNumber,
        kind: 'expect-type',
        expected: typeMatch[1]!.trim(),
        codeLine: lineNumber + 1,
        codeCol: 1,
      });
      continue;
    }

    // Check for expect-error
    const errorMatch = line.match(EXPECT_ERROR_REGEX);
    if (errorMatch) {
      assertions.push({
        line: lineNumber,
        kind: 'expect-error',
        expected: errorMatch[1]!.trim(),
        codeLine: lineNumber + 1,
        codeCol: 1,
      });
    }
  }

  return assertions;
}

/**
 * Find the first meaningful expression on a line to get its type.
 * Returns the column position of the expression.
 */
export function findExpressionOnLine(
  sourceFile: ts.SourceFile,
  line: number
): { col: number; node: ts.Node } | null {
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = line - 1;

  if (lineIndex < 0 || lineIndex >= lineStarts.length) {
    return null;
  }

  const lineStart = lineStarts[lineIndex]!;
  const lineEnd = lineStarts[lineIndex + 1] ?? sourceFile.getEnd();

  // Find the first meaningful node on this line
  let result: { col: number; node: ts.Node } | null = null;

  function visit(node: ts.Node): void {
    const nodeStart = node.getStart(sourceFile);
    const nodeEnd = node.getEnd();

    // Check if node is on the target line
    if (nodeStart >= lineStart && nodeStart < lineEnd) {
      // We want the first expression or variable declaration
      if (
        ts.isVariableDeclaration(node) ||
        ts.isExpressionStatement(node) ||
        ts.isCallExpression(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isIdentifier(node)
      ) {
        if (!result) {
          const pos = sourceFile.getLineAndCharacterOfPosition(nodeStart);
          result = {
            col: pos.character + 1,
            node,
          };
        }
      }
    }

    // Only recurse if this node overlaps with the target line
    if (nodeEnd > lineStart) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return result;
}

/**
 * Normalize a type string for comparison.
 * Removes extra whitespace, normalizes quotes, etc.
 */
export function normalizeTypeString(typeStr: string): string {
  return typeStr
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

/**
 * Compare two type strings for equality.
 * Handles common variations in type representation.
 */
export function typesEqual(expected: string, actual: string): boolean {
  const normExpected = normalizeTypeString(expected);
  const normActual = normalizeTypeString(actual);

  // Direct match
  if (normExpected === normActual) {
    return true;
  }

  // Handle common variations
  // e.g., "string | undefined" vs "undefined | string"
  if (normExpected.includes('|') && normActual.includes('|')) {
    const expectedParts = normExpected.split(' | ').sort();
    const actualParts = normActual.split(' | ').sort();
    if (expectedParts.length === actualParts.length) {
      return expectedParts.every((p, i) => p === actualParts[i]);
    }
  }

  return false;
}
