import type { Position } from './position-utils.js';

/**
 * Parsed file location with optional position.
 */
export interface FileLocation {
  file: string;
  position?: Position;
}

/**
 * Parse a file path that may include line and column numbers.
 *
 * Supported formats:
 * - "src/user.ts" - just file
 * - "src/user.ts:10" - file with line
 * - "src/user.ts:10:5" - file with line and column
 *
 * @param input The file path, optionally with :line:col suffix
 * @returns Parsed file path and optional position
 */
export function parseFileLocation(input: string): FileLocation {
  // Handle Windows paths (C:\...) by checking if the second char is ':'
  const isWindowsPath = /^[a-zA-Z]:/.test(input);

  let searchStart = 0;
  if (isWindowsPath) {
    // Skip the drive letter colon
    searchStart = 2;
  }

  // Find the last occurrence of :number pattern
  // Match :line or :line:col at the end
  const match = input.slice(searchStart).match(/:(\d+)(?::(\d+))?$/);

  if (!match) {
    return { file: input };
  }

  const lineColSuffix = match[0];
  const file = input.slice(0, input.length - lineColSuffix.length);
  const line = parseInt(match[1]!, 10);
  const col = match[2] ? parseInt(match[2], 10) : 1;

  return {
    file,
    position: { line, col },
  };
}

/**
 * Merge explicit position params with parsed position from file string.
 * Explicit params take precedence.
 */
export function resolvePosition(
  parsedLocation: FileLocation,
  explicitLine?: number,
  explicitCol?: number
): { file: string; position: Position } {
  const position: Position = {
    line: explicitLine ?? parsedLocation.position?.line ?? 1,
    col: explicitCol ?? parsedLocation.position?.col ?? 1,
  };

  return {
    file: parsedLocation.file,
    position,
  };
}

/**
 * Parse file and position from tool arguments.
 * Supports both unified format and explicit params.
 */
export function parseFileArgs(args: {
  file: string;
  line?: number;
  col?: number;
}): { file: string; position: Position } {
  const parsed = parseFileLocation(args.file);
  return resolvePosition(parsed, args.line, args.col);
}
