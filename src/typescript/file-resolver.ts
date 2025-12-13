import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

/**
 * Resolves file paths from various input formats.
 * AI agents often don't know exact paths, so we support:
 * - Absolute paths
 * - Relative paths
 * - Unique filename (if only one match exists in project)
 */
export class FileResolver {
  constructor(private readonly projectRoot: string) {}

  /**
   * Resolve a file input to an absolute path.
   * @throws Error if file not found or ambiguous
   */
  async resolve(input: string): Promise<string> {
    // 1. Try absolute path
    if (path.isAbsolute(input)) {
      if (fs.existsSync(input)) {
        return input;
      }
      throw new Error(`File not found: ${input}`);
    }

    // 2. Try relative to project root
    const relativePath = path.join(this.projectRoot, input);
    if (fs.existsSync(relativePath)) {
      return path.resolve(relativePath);
    }

    // 3. Glob search for unique filename
    return this.searchByFilename(input);
  }

  /**
   * Search for a file by name pattern in the project.
   */
  private async searchByFilename(input: string): Promise<string> {
    // Build pattern - if input has no path separators, search anywhere
    const hasPathSeparator = input.includes('/') || input.includes('\\');
    const pattern = hasPathSeparator ? input : `**/${input}`;

    const matches = await glob(pattern, {
      cwd: this.projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      nodir: true,
      absolute: true,
    });

    if (matches.length === 0) {
      throw new Error(`File not found: ${input}`);
    }

    if (matches.length === 1) {
      return matches[0]!;
    }

    // Ambiguous - list matches to help the user
    const maxShown = 5;
    const shown = matches.slice(0, maxShown);
    const remaining = matches.length - maxShown;

    let message = `Ambiguous filename "${input}". Found ${matches.length} matches:\n`;
    message += shown.map((m) => `  - ${path.relative(this.projectRoot, m)}`).join('\n');
    if (remaining > 0) {
      message += `\n  ... and ${remaining} more`;
    }

    throw new Error(message);
  }

  /**
   * Resolve synchronously (uses sync glob).
   */
  resolveSync(input: string): string {
    // 1. Try absolute path
    if (path.isAbsolute(input)) {
      if (fs.existsSync(input)) {
        return input;
      }
      throw new Error(`File not found: ${input}`);
    }

    // 2. Try relative to project root
    const relativePath = path.join(this.projectRoot, input);
    if (fs.existsSync(relativePath)) {
      return path.resolve(relativePath);
    }

    // 3. Glob search for unique filename
    return this.searchByFilenameSync(input);
  }

  private searchByFilenameSync(input: string): string {
    const hasPathSeparator = input.includes('/') || input.includes('\\');
    const pattern = hasPathSeparator ? input : `**/${input}`;

    // Use sync version
    const matches = glob.sync(pattern, {
      cwd: this.projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      nodir: true,
      absolute: true,
    });

    if (matches.length === 0) {
      throw new Error(`File not found: ${input}`);
    }

    if (matches.length === 1) {
      return matches[0]!;
    }

    const maxShown = 5;
    const shown = matches.slice(0, maxShown);
    const remaining = matches.length - maxShown;

    let message = `Ambiguous filename "${input}". Found ${matches.length} matches:\n`;
    message += shown.map((m) => `  - ${path.relative(this.projectRoot, m)}`).join('\n');
    if (remaining > 0) {
      message += `\n  ... and ${remaining} more`;
    }

    throw new Error(message);
  }

  /**
   * Get a path relative to the project root.
   */
  relativePath(absolutePath: string): string {
    return path.relative(this.projectRoot, absolutePath);
  }

  /**
   * Check if a path is within the project.
   */
  isInProject(absolutePath: string): boolean {
    const relative = path.relative(this.projectRoot, absolutePath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * Check if a path is in node_modules.
   */
  isInNodeModules(absolutePath: string): boolean {
    return absolutePath.includes('node_modules');
  }
}
