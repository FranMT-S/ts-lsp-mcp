import type ts from 'typescript';

/**
 * Position in a file using 1-indexed line and column numbers.
 * This is the human/LLM-friendly format.
 */
export interface Position {
  /** 1-indexed line number */
  line: number;
  /** 1-indexed column number (character position, not byte offset) */
  col: number;
}

/**
 * A range in a file with start and end positions.
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Convert 1-indexed line:col position to TypeScript's 0-indexed byte offset.
 */
export function positionToOffset(
  sourceFile: ts.SourceFile,
  position: Position
): number {
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = position.line - 1;

  if (lineIndex < 0 || lineIndex >= lineStarts.length) {
    throw new Error(
      `Line ${position.line} is out of range (file has ${lineStarts.length} lines)`
    );
  }

  const lineStart = lineStarts[lineIndex]!;
  const offset = lineStart + (position.col - 1);

  // Validate offset is within file bounds
  const text = sourceFile.getFullText();
  if (offset > text.length) {
    throw new Error(
      `Column ${position.col} is out of range for line ${position.line}`
    );
  }

  return offset;
}

/**
 * Convert TypeScript's 0-indexed byte offset to 1-indexed line:col position.
 */
export function offsetToPosition(
  sourceFile: ts.SourceFile,
  offset: number
): Position {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
  return {
    line: line + 1,
    col: character + 1,
  };
}

/**
 * Convert a TypeScript TextSpan to a Range with 1-indexed positions.
 */
export function textSpanToRange(
  sourceFile: ts.SourceFile,
  span: ts.TextSpan
): Range {
  return {
    start: offsetToPosition(sourceFile, span.start),
    end: offsetToPosition(sourceFile, span.start + span.length),
  };
}

/**
 * Get a preview of the line at a position, optionally highlighting the column.
 */
export function getLinePreview(
  sourceFile: ts.SourceFile,
  position: Position,
  options: { maxLength?: number; highlightCol?: boolean } = {}
): string {
  const { maxLength = 80, highlightCol = false } = options;
  const text = sourceFile.getFullText();
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = position.line - 1;

  if (lineIndex < 0 || lineIndex >= lineStarts.length) {
    return '';
  }

  const lineStart = lineStarts[lineIndex]!;
  const nextLineStart = lineStarts[lineIndex + 1] ?? text.length;

  let line = text.slice(lineStart, nextLineStart).replace(/\r?\n$/, '');

  if (line.length > maxLength) {
    // Try to keep the column visible
    const colIndex = position.col - 1;
    if (colIndex > maxLength - 10) {
      const start = Math.max(0, colIndex - maxLength / 2);
      line = '...' + line.slice(start, start + maxLength - 6) + '...';
    } else {
      line = line.slice(0, maxLength - 3) + '...';
    }
  }

  return line;
}

/**
 * Validate that a position is within a source file's bounds.
 */
export function isValidPosition(
  sourceFile: ts.SourceFile,
  position: Position
): boolean {
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = position.line - 1;

  if (lineIndex < 0 || lineIndex >= lineStarts.length) {
    return false;
  }

  const lineStart = lineStarts[lineIndex]!;
  const nextLineStart = lineStarts[lineIndex + 1] ?? sourceFile.getFullText().length;
  const lineLength = nextLineStart - lineStart;

  return position.col >= 1 && position.col <= lineLength + 1;
}
