import ts from 'typescript';
import { glob } from 'glob';
import * as path from 'node:path';
import type { ProjectContext } from '../typescript/project-manager.js';
import { positionToOffset, offsetToPosition } from '../typescript/position-utils.js';
import {
  parseTypeTests,
  findExpressionOnLine,
  typesEqual,
  type TypeTestAssertion,
} from './parser.js';

/**
 * Result of running a single type test.
 */
export interface TypeTestResult {
  file: string;
  line: number;
  kind: 'expect-type' | 'expect-error';
  expected: string;
  actual: string;
  passed: boolean;
  message?: string;
}

/**
 * Summary of type test run.
 */
export interface TypeTestSummary {
  passed: number;
  failed: number;
  results: TypeTestResult[];
}

/**
 * Run type tests for a project.
 */
export async function runTypeTests(
  project: ProjectContext,
  options: {
    file?: string;
    pattern?: string;
  } = {}
): Promise<TypeTestSummary> {
  const results: TypeTestResult[] = [];
  const ls = project.languageService;

  // Get files to test
  let files: string[];

  if (options.file) {
    files = [await project.fileResolver.resolve(options.file)];
  } else if (options.pattern) {
    files = await glob(options.pattern, {
      cwd: project.projectRoot,
      ignore: ['**/node_modules/**', '**/dist/**'],
      absolute: true,
    });
  } else {
    // Default: find all files with @ts-lsp-mcp comments
    files = await findFilesWithTypeTests(project.projectRoot);
  }

  // Run tests for each file
  for (const file of files) {
    const fileResults = await runFileTypeTests(file, project);
    results.push(...fileResults);
  }

  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  };
}

/**
 * Run type tests for a single file.
 */
async function runFileTypeTests(
  filePath: string,
  project: ProjectContext
): Promise<TypeTestResult[]> {
  const results: TypeTestResult[] = [];
  const ls = project.languageService;
  const relativePath = project.fileResolver.relativePath(filePath);

  // Get source file
  const sourceFile = ls.getSourceFile(filePath);
  if (!sourceFile) {
    return [
      {
        file: relativePath,
        line: 0,
        kind: 'expect-type',
        expected: '',
        actual: '',
        passed: false,
        message: 'File not found or not part of project',
      },
    ];
  }

  // Parse assertions
  const assertions = parseTypeTests(sourceFile);
  if (assertions.length === 0) {
    return [];
  }

  const typeChecker = ls.getTypeChecker();

  // Run each assertion
  for (const assertion of assertions) {
    const result = runAssertion(
      assertion,
      sourceFile,
      typeChecker,
      ls,
      filePath,
      relativePath
    );
    results.push(result);
  }

  return results;
}

/**
 * Run a single type test assertion.
 */
function runAssertion(
  assertion: TypeTestAssertion,
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  ls: ReturnType<ProjectContext['languageService']['getLanguageService']> extends infer T ? { getDiagnostics: (file: string) => ts.Diagnostic[] } : never,
  filePath: string,
  relativePath: string
): TypeTestResult {
  const baseResult = {
    file: relativePath,
    line: assertion.line,
    kind: assertion.kind,
    expected: assertion.expected,
  };

  if (assertion.kind === 'expect-type') {
    // Find the expression on the target line
    const expr = findExpressionOnLine(sourceFile, assertion.codeLine);
    if (!expr) {
      return {
        ...baseResult,
        actual: '',
        passed: false,
        message: `No expression found on line ${assertion.codeLine}`,
      };
    }

    // Get the type
    const type = typeChecker.getTypeAtLocation(expr.node);
    const actual = typeChecker.typeToString(type);

    const passed = typesEqual(assertion.expected, actual);

    return {
      ...baseResult,
      actual,
      passed,
      message: passed ? undefined : `Expected "${assertion.expected}", got "${actual}"`,
    };
  } else {
    // expect-error - check for diagnostic on the line
    const diagnostics = (ls as any).getDiagnostics(filePath) as ts.Diagnostic[];
    const expectedCode = parseInt(assertion.expected, 10);

    const matchingDiagnostic = diagnostics.find((d) => {
      if (d.file !== sourceFile || d.start === undefined) return false;
      const pos = sourceFile.getLineAndCharacterOfPosition(d.start);
      return pos.line + 1 === assertion.codeLine && d.code === expectedCode;
    });

    if (matchingDiagnostic) {
      return {
        ...baseResult,
        actual: `Error ${matchingDiagnostic.code}`,
        passed: true,
      };
    }

    // Check if there's any error on the line
    const anyErrorOnLine = diagnostics.find((d) => {
      if (d.file !== sourceFile || d.start === undefined) return false;
      const pos = sourceFile.getLineAndCharacterOfPosition(d.start);
      return pos.line + 1 === assertion.codeLine;
    });

    if (anyErrorOnLine) {
      return {
        ...baseResult,
        actual: `Error ${anyErrorOnLine.code}`,
        passed: false,
        message: `Expected error ${expectedCode}, got error ${anyErrorOnLine.code}`,
      };
    }

    return {
      ...baseResult,
      actual: 'No error',
      passed: false,
      message: `Expected error ${expectedCode} on line ${assertion.codeLine}, but no error found`,
    };
  }
}

/**
 * Find all files in a project that contain @ts-lsp-mcp comments.
 */
async function findFilesWithTypeTests(projectRoot: string): Promise<string[]> {
  // Use glob to find all .ts files
  const allFiles = await glob('**/*.ts', {
    cwd: projectRoot,
    ignore: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    absolute: true,
  });

  // Filter to only files containing @ts-lsp-mcp
  const filesWithTests: string[] = [];
  const fs = await import('node:fs');

  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('@ts-lsp-mcp')) {
        filesWithTests.push(file);
      }
    } catch {
      // Skip files we can't read
    }
  }

  return filesWithTests;
}
