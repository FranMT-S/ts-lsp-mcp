import ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Virtual file stored in memory (for unsaved/new files).
 */
interface VirtualFile {
  content: string;
  version: number;
}

/**
 * Options for creating a LanguageServiceWrapper.
 */
export interface LanguageServiceOptions {
  tsconfigPath: string;
  /** Optional: Custom compiler options to override tsconfig */
  compilerOptions?: ts.CompilerOptions;
}

/**
 * Wraps TypeScript's LanguageService with conveniences for MCP tools.
 * Handles file versioning, virtual files, and the LanguageServiceHost contract.
 */
export class LanguageServiceWrapper {
  private readonly languageService: ts.LanguageService;
  private readonly program: ts.Program;
  private readonly compilerOptions: ts.CompilerOptions;
  private readonly projectRoot: string;
  private readonly tsconfigPath: string;

  // Track virtual files (unsaved/new)
  private virtualFiles: Map<string, VirtualFile> = new Map();

  // Track file versions by mtime (for disk files)
  private fileVersions: Map<string, string> = new Map();

  // Document registry for efficient SourceFile sharing
  private readonly documentRegistry: ts.DocumentRegistry;

  constructor(options: LanguageServiceOptions) {
    this.tsconfigPath = path.resolve(options.tsconfigPath);
    this.projectRoot = path.dirname(this.tsconfigPath);
    this.documentRegistry = ts.createDocumentRegistry();

    // Parse tsconfig
    const configFile = ts.readConfigFile(this.tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(
        `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
      );
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      this.projectRoot,
      options.compilerOptions
    );

    if (parsed.errors.length > 0) {
      const errors = parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
        .join('\n');
      throw new Error(`Failed to parse tsconfig: ${errors}`);
    }

    this.compilerOptions = parsed.options;

    // Create LanguageServiceHost
    const host = this.createLanguageServiceHost(parsed.fileNames);

    // Create LanguageService
    this.languageService = ts.createLanguageService(host, this.documentRegistry);

    // Get initial program
    const program = this.languageService.getProgram();
    if (!program) {
      throw new Error('Failed to create TypeScript program');
    }
    this.program = program;

    logger.info('LanguageService initialized', {
      tsconfigPath: this.tsconfigPath,
      fileCount: parsed.fileNames.length,
    });
  }

  /**
   * Create the LanguageServiceHost that TypeScript needs.
   */
  private createLanguageServiceHost(
    rootFileNames: string[]
  ): ts.LanguageServiceHost {
    const self = this;

    return {
      getScriptFileNames: () => {
        // Include both disk files and virtual files
        const virtualFileNames = Array.from(self.virtualFiles.keys());
        return [...new Set([...rootFileNames, ...virtualFileNames])];
      },

      getScriptVersion: (fileName: string) => {
        // Virtual files use incremental version
        const virtual = self.virtualFiles.get(fileName);
        if (virtual) {
          return virtual.version.toString();
        }

        // Disk files use mtime
        try {
          const mtime = fs.statSync(fileName).mtimeMs.toString();
          self.fileVersions.set(fileName, mtime);
          return mtime;
        } catch {
          return '0';
        }
      },

      getScriptSnapshot: (fileName: string) => {
        // Check virtual files first
        const virtual = self.virtualFiles.get(fileName);
        if (virtual) {
          return ts.ScriptSnapshot.fromString(virtual.content);
        }

        // Read from disk
        try {
          const content = fs.readFileSync(fileName, 'utf-8');
          return ts.ScriptSnapshot.fromString(content);
        } catch {
          return undefined;
        }
      },

      getCurrentDirectory: () => self.projectRoot,

      getCompilationSettings: () => self.compilerOptions,

      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),

      fileExists: (fileName: string) => {
        if (self.virtualFiles.has(fileName)) {
          return true;
        }
        return ts.sys.fileExists(fileName);
      },

      readFile: (fileName: string) => {
        const virtual = self.virtualFiles.get(fileName);
        if (virtual) {
          return virtual.content;
        }
        return ts.sys.readFile(fileName);
      },

      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,

      // Enable ES module resolution
      resolveModuleNameLiterals: undefined,
      resolveModuleNames: undefined,
    };
  }

  /**
   * Set virtual file content (for unsaved/new files).
   */
  setVirtualFile(fileName: string, content: string): void {
    const resolved = this.resolveFileName(fileName);
    const existing = this.virtualFiles.get(resolved);
    const version = existing ? existing.version + 1 : 1;

    this.virtualFiles.set(resolved, { content, version });
    logger.debug('Set virtual file', { fileName: resolved, version });
  }

  /**
   * Remove a virtual file.
   */
  removeVirtualFile(fileName: string): void {
    const resolved = this.resolveFileName(fileName);
    this.virtualFiles.delete(resolved);
    logger.debug('Removed virtual file', { fileName: resolved });
  }

  /**
   * Check if a file is virtual.
   */
  isVirtualFile(fileName: string): boolean {
    return this.virtualFiles.has(this.resolveFileName(fileName));
  }

  /**
   * Resolve a file name to an absolute path.
   */
  resolveFileName(fileName: string): string {
    return path.resolve(this.projectRoot, fileName).replace(/\\/g, '/');
  }

  /**
   * Get the SourceFile for a given file.
   */
  getSourceFile(fileName: string): ts.SourceFile | undefined {
    const resolved = this.resolveFileName(fileName);
    const program = this.getProgram();
    const sf = program.getSourceFile(resolved);
    if (sf) return sf;

    const normalized = resolved.replace(/\\/g, '/').toLowerCase();
    return program.getSourceFiles().find(
      (f) => f.fileName.replace(/\\/g, '/').toLowerCase() === normalized
    );
  }

  /**
   * Get the underlying LanguageService.
   */
  getLanguageService(): ts.LanguageService {
    return this.languageService;
  }

  /**
   * Get the current program.
   */
  getProgram(): ts.Program {
    return this.languageService.getProgram() ?? this.program;
  }

  /**
   * Get the type checker.
   */
  getTypeChecker(): ts.TypeChecker {
    return this.getProgram().getTypeChecker();
  }

  /**
   * Get compiler options.
   */
  getCompilerOptions(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  /**
   * Get project root directory.
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Get quick info (hover) at a position.
   */
  getQuickInfoAtPosition(
    fileName: string,
    offset: number
  ): ts.QuickInfo | undefined {
    const resolved = this.resolveFileName(fileName);
    return this.languageService.getQuickInfoAtPosition(resolved, offset);
  }

  /**
   * Get definitions at a position.
   */
  getDefinitionAtPosition(
    fileName: string,
    offset: number
  ): readonly ts.DefinitionInfo[] | undefined {
    const resolved = this.resolveFileName(fileName);
    return this.languageService.getDefinitionAtPosition(resolved, offset);
  }

  /**
   * Get references at a position.
   */
  getReferencesAtPosition(
    fileName: string,
    offset: number
  ): ts.ReferenceEntry[] | undefined {
    const resolved = this.resolveFileName(fileName);
    return this.languageService.getReferencesAtPosition(resolved, offset);
  }

  /**
   * Get completions at a position.
   */
  getCompletionsAtPosition(
    fileName: string,
    offset: number,
    options?: ts.GetCompletionsAtPositionOptions
  ): ts.WithMetadata<ts.CompletionInfo> | undefined {
    const resolved = this.resolveFileName(fileName);
    return this.languageService.getCompletionsAtPosition(resolved, offset, options);
  }

  /**
   * Get completion entry details.
   */
  getCompletionEntryDetails(
    fileName: string,
    offset: number,
    entryName: string
  ): ts.CompletionEntryDetails | undefined {
    const resolved = this.resolveFileName(fileName);
    return this.languageService.getCompletionEntryDetails(
      resolved,
      offset,
      entryName,
      undefined,
      undefined,
      undefined,
      undefined
    );
  }

  /**
   * Get all diagnostics for a file.
   */
  getDiagnostics(fileName?: string): ts.Diagnostic[] {
    if (fileName) {
      const resolved = this.resolveFileName(fileName);
      const syntactic = this.languageService.getSyntacticDiagnostics(resolved);
      const semantic = this.languageService.getSemanticDiagnostics(resolved);
      return [...syntactic, ...semantic];
    }

    // Get diagnostics for all files
    const program = this.getProgram();
    const allDiagnostics: ts.Diagnostic[] = [];

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.fileName.includes('node_modules')) continue;
      allDiagnostics.push(
        ...this.languageService.getSyntacticDiagnostics(sourceFile.fileName),
        ...this.languageService.getSemanticDiagnostics(sourceFile.fileName)
      );
    }

    return allDiagnostics;
  }

  /**
   * Get the type at a specific position.
   */
  getTypeAtPosition(
    fileName: string,
    offset: number
  ): { type: ts.Type; symbol: ts.Symbol | undefined; node: ts.Node } | undefined {
    const sourceFile = this.getSourceFile(fileName);
    if (!sourceFile) return undefined;

    // Find the node at the position
    const node = this.findNodeAtPosition(sourceFile, offset);
    if (!node) return undefined;

    const typeChecker = this.getTypeChecker();

    // Get the type of the node
    const type = typeChecker.getTypeAtLocation(node);

    // Get the symbol if available
    const symbol = typeChecker.getSymbolAtLocation(node);

    return { type, symbol, node };
  }

  /**
   * Find the most specific node at a position.
   */
  private findNodeAtPosition(
    sourceFile: ts.SourceFile,
    offset: number
  ): ts.Node | undefined {
    let result: ts.Node | undefined;

    function visit(node: ts.Node): void {
      if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
        result = node;
        ts.forEachChild(node, visit);
      }
    }

    visit(sourceFile);
    return result;
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.languageService.dispose();
    this.virtualFiles.clear();
    this.fileVersions.clear();
    logger.debug('LanguageService disposed', { tsconfigPath: this.tsconfigPath });
  }
}
