import * as path from 'node:path';
import { LanguageServiceWrapper, type LanguageServiceOptions } from './language-service.js';
import { FileResolver } from './file-resolver.js';
import { findTsConfig } from '../utils/tsconfig-finder.js';
import { logger } from '../utils/logger.js';

/**
 * A project context containing all the TypeScript tooling for a tsconfig.
 */
export interface ProjectContext {
  tsconfigPath: string;
  projectRoot: string;
  languageService: LanguageServiceWrapper;
  fileResolver: FileResolver;
}

/**
 * Manages multiple TypeScript projects (for monorepos/multi-tsconfig setups).
 * Projects are lazily initialized and cached by tsconfig path.
 */
export class ProjectManager {
  private projects: Map<string, ProjectContext> = new Map();

  /**
   * Get or create a project for a given directory or file.
   * Will walk up to find the nearest tsconfig.json.
   */
  async getProject(pathOrDir: string): Promise<ProjectContext> {
    // Find the tsconfig
    const tsconfigPath = await this.findProjectTsConfig(pathOrDir);

    // Check cache
    const cached = this.projects.get(tsconfigPath);
    if (cached) {
      logger.debug('Using cached project', { tsconfigPath });
      return cached;
    }

    // Create new project
    return this.createProject(tsconfigPath);
  }

  /**
   * Get a project by explicit tsconfig path.
   */
  async getProjectByTsConfig(tsconfigPath: string): Promise<ProjectContext> {
    const resolved = path.resolve(tsconfigPath);

    const cached = this.projects.get(resolved);
    if (cached) {
      return cached;
    }

    return this.createProject(resolved);
  }

  /**
   * Find the tsconfig for a path.
   */
  private async findProjectTsConfig(pathOrDir: string): Promise<string> {
    const resolved = path.resolve(pathOrDir);
    const startDir = path.extname(resolved) ? path.dirname(resolved) : resolved;

    const tsconfigPath = findTsConfig(startDir);
    if (!tsconfigPath) {
      throw new Error(
        `No tsconfig.json found starting from: ${startDir}\n` +
        'Please ensure your project has a tsconfig.json file.'
      );
    }

    return tsconfigPath;
  }

  /**
   * Create a new project.
   */
  private createProject(tsconfigPath: string): ProjectContext {
    logger.info('Creating new project', { tsconfigPath });

    const options: LanguageServiceOptions = { tsconfigPath };
    const languageService = new LanguageServiceWrapper(options);
    const projectRoot = languageService.getProjectRoot();
    const fileResolver = new FileResolver(projectRoot);

    const context: ProjectContext = {
      tsconfigPath,
      projectRoot,
      languageService,
      fileResolver,
    };

    this.projects.set(tsconfigPath, context);
    return context;
  }

  /**
   * Resolve a file within a project context.
   * Handles virtual files and file resolution.
   */
  async resolveFile(
    project: ProjectContext,
    file: string,
    content?: string
  ): Promise<string> {
    // If content provided, set as virtual file
    if (content !== undefined) {
      // Create a virtual file path if needed
      const resolvedPath = path.isAbsolute(file)
        ? file
        : path.join(project.projectRoot, file);

      project.languageService.setVirtualFile(resolvedPath, content);
      return resolvedPath;
    }

    // Otherwise resolve from disk
    return project.fileResolver.resolve(file);
  }

  /**
   * List all loaded projects.
   */
  listProjects(): Array<{ tsconfigPath: string; projectRoot: string }> {
    return Array.from(this.projects.values()).map((p) => ({
      tsconfigPath: p.tsconfigPath,
      projectRoot: p.projectRoot,
    }));
  }

  /**
   * Dispose of a specific project.
   */
  disposeProject(tsconfigPath: string): void {
    const project = this.projects.get(tsconfigPath);
    if (project) {
      project.languageService.dispose();
      this.projects.delete(tsconfigPath);
      logger.info('Disposed project', { tsconfigPath });
    }
  }

  /**
   * Dispose of all projects.
   */
  dispose(): void {
    for (const project of this.projects.values()) {
      project.languageService.dispose();
    }
    this.projects.clear();
    logger.info('Disposed all projects');
  }
}

// Singleton instance for the MCP server
let globalProjectManager: ProjectManager | null = null;

export function getProjectManager(): ProjectManager {
  if (!globalProjectManager) {
    globalProjectManager = new ProjectManager();
  }
  return globalProjectManager;
}

export function disposeProjectManager(): void {
  if (globalProjectManager) {
    globalProjectManager.dispose();
    globalProjectManager = null;
  }
}
