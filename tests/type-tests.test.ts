import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ts } from '../src/typescript/ts-import.js';

import { getProjectManager, disposeProjectManager } from '../src/typescript/project-manager.js';
import {
  parseTypeTests,
  typesEqual,
  normalizeTypeString,
  findExpressionOnLine,
} from '../src/type-tests/parser.js';
import { runTypeTests } from '../src/type-tests/runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures/sample-project');
const typeTestFile = path.join(fixtureDir, 'src/type-tests.ts');

describe('Type test parser', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should parse expect-type assertions', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(typeTestFile);

    assert.ok(sourceFile);

    const assertions = parseTypeTests(sourceFile);
    const expectTypes = assertions.filter(a => a.kind === 'expect-type');

    assert.ok(expectTypes.length >= 4);
    assert.ok(expectTypes.some(a => a.expected === 'User'));
    assert.ok(expectTypes.some(a => a.expected === 'string'));
    assert.ok(expectTypes.some(a => a.expected === 'number'));
  });

  it('should parse expect-error assertions', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(typeTestFile);

    assert.ok(sourceFile);

    const assertions = parseTypeTests(sourceFile);
    const expectErrors = assertions.filter(a => a.kind === 'expect-error');

    assert.ok(expectErrors.length >= 1);
    assert.ok(expectErrors.some(a => a.expected === '2322'));
  });

  it('should find expression on line', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(typeTestFile);

    assert.ok(sourceFile);

    // Line 9: const user: User = { id: 1, name: 'Alice' };
    const expr = findExpressionOnLine(sourceFile, 9);
    assert.ok(expr);
    assert.ok(expr.col >= 1);
  });
});

describe('Type comparison utilities', () => {
  it('should normalize type strings', () => {
    assert.strictEqual(
      normalizeTypeString('{ a: string;  b: number }'),
      '{ a: string; b: number }'
    );
    assert.strictEqual(
      normalizeTypeString('string|number'),
      'string | number'
    );
  });

  it('should compare equal types', () => {
    assert.ok(typesEqual('string', 'string'));
    assert.ok(typesEqual('{ a: string }', '{a:string}'));
    assert.ok(typesEqual('string | number', 'string|number'));
  });

  it('should handle union type ordering', () => {
    assert.ok(typesEqual('string | number', 'number | string'));
    assert.ok(typesEqual('A | B | C', 'C | A | B'));
  });

  it('should reject unequal types', () => {
    assert.ok(!typesEqual('string', 'number'));
    assert.ok(!typesEqual('{ a: string }', '{ b: string }'));
  });
});

describe('Type test runner', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should run type tests from file', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const results = await runTypeTests(project, { file: typeTestFile });

    assert.ok(results.passed >= 4);
    assert.strictEqual(results.failed, 0);
    assert.strictEqual(results.passed + results.failed, results.results.length);
  });

  it('should pass expect-type assertions', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const results = await runTypeTests(project, { file: typeTestFile });

    const userTest = results.results.find(
      r => r.kind === 'expect-type' && r.expected === 'User'
    );
    assert.ok(userTest);
    assert.ok(userTest.passed);
    assert.strictEqual(userTest.actual, 'User');
  });

  it('should pass expect-error assertions', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const results = await runTypeTests(project, { file: typeTestFile });

    const errorTest = results.results.find(
      r => r.kind === 'expect-error' && r.expected === '2322'
    );
    assert.ok(errorTest);
    assert.ok(errorTest.passed);
  });

  it('should detect failing expect-type', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    // Create a virtual file with a failing assertion
    const virtualPath = path.join(fixtureDir, 'src/failing-test.ts');
    const content = `
// @ts-lsp-mcp expect-type: number
const x: string = 'hello';
`;
    ls.setVirtualFile(virtualPath, content);

    const results = await runTypeTests(project, { file: virtualPath });

    assert.strictEqual(results.failed, 1);
    assert.strictEqual(results.passed, 0);

    const failedTest = results.results[0];
    assert.ok(failedTest);
    assert.ok(!failedTest.passed);
    assert.strictEqual(failedTest.expected, 'number');
    assert.strictEqual(failedTest.actual, 'string');

    ls.removeVirtualFile(virtualPath);
  });
});

describe('Inline code checking', () => {
  it('should validate correct code', () => {
    const result = checkInlineCode(`
      interface User { id: number; name: string; }
      const user: User = { id: 1, name: 'Alice' };
    `);

    assert.ok(result.valid);
    assert.strictEqual(result.diagnostics.length, 0);
  });

  it('should catch type errors', () => {
    const result = checkInlineCode(`
      interface User { id: number; name: string; }
      const user: User = { id: 'bad', name: 'Alice' };
    `);

    assert.ok(!result.valid);
    assert.ok(result.diagnostics.length >= 1);
    assert.ok(result.diagnostics.some(d => d.code === 2322));
  });

  it('should catch syntax errors', () => {
    const result = checkInlineCode(`
      const x = {
    `);

    assert.ok(!result.valid);
    assert.ok(result.diagnostics.length >= 1);
  });
});

/**
 * Helper for inline code checking (mirrors the MCP tool).
 */
function checkInlineCode(code: string): {
  valid: boolean;
  diagnostics: Array<{ code: number; message: string }>;
} {
  const fileName = '__test__.ts';
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.ES2022,
    true
  );

  const defaultHost = ts.createCompilerHost(compilerOptions);
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (name, languageVersion) => {
      if (name === fileName) return sourceFile;
      return defaultHost.getSourceFile(name, languageVersion);
    },
    fileExists: (name) => name === fileName || defaultHost.fileExists(name),
    readFile: (name) => (name === fileName ? code : defaultHost.readFile(name)),
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  const allDiagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  return {
    valid:
      allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
        .length === 0,
    diagnostics: allDiagnostics.map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    })),
  };
}
