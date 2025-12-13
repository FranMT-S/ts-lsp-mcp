import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Find the nearest tsconfig.json starting from a directory and walking up.
 * Returns null if no tsconfig.json is found before reaching the filesystem root.
 */
export function findTsConfig(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const tsconfigPath = path.join(currentDir, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory as well
  const rootTsconfig = path.join(root, 'tsconfig.json');
  if (fs.existsSync(rootTsconfig)) {
    return rootTsconfig;
  }

  return null;
}

/**
 * Find all tsconfig.json files in a directory tree (useful for monorepos).
 * Excludes node_modules by default.
 */
export function findAllTsConfigs(
  rootDir: string,
  options: { excludeNodeModules?: boolean } = {}
): string[] {
  const { excludeNodeModules = true } = options;
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (excludeNodeModules && entry.name === 'node_modules') {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'tsconfig.json') {
        results.push(fullPath);
      }
    }
  }

  walk(path.resolve(rootDir));
  return results;
}

/**
 * Get the project root directory from a tsconfig path.
 */
export function getProjectRoot(tsconfigPath: string): string {
  return path.dirname(path.resolve(tsconfigPath));
}
