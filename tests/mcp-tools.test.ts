import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getProjectManager, disposeProjectManager } from '../src/typescript/project-manager.js';
import { positionToOffset } from '../src/typescript/position-utils.js';
import { parseFileLocation, parseFileArgs } from '../src/typescript/file-position-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures/sample-project');
const testFile = path.join(fixtureDir, 'src/index.ts');

describe('File position parser', () => {
  it('should parse file without position', () => {
    const result = parseFileLocation('src/user.ts');
    assert.strictEqual(result.file, 'src/user.ts');
    assert.strictEqual(result.position, undefined);
  });

  it('should parse file with line only', () => {
    const result = parseFileLocation('src/user.ts:10');
    assert.strictEqual(result.file, 'src/user.ts');
    assert.deepStrictEqual(result.position, { line: 10, col: 1 });
  });

  it('should parse file with line and column', () => {
    const result = parseFileLocation('src/user.ts:10:5');
    assert.strictEqual(result.file, 'src/user.ts');
    assert.deepStrictEqual(result.position, { line: 10, col: 5 });
  });

  it('should handle Windows paths', () => {
    const result = parseFileLocation('C:\\Users\\test\\file.ts:10:5');
    assert.strictEqual(result.file, 'C:\\Users\\test\\file.ts');
    assert.deepStrictEqual(result.position, { line: 10, col: 5 });
  });

  it('should merge explicit params with parsed position', () => {
    // Explicit params take precedence
    const result = parseFileArgs({
      file: 'src/user.ts:10:5',
      line: 20,
      col: 15,
    });
    assert.strictEqual(result.file, 'src/user.ts');
    assert.deepStrictEqual(result.position, { line: 20, col: 15 });
  });

  it('should use parsed position when no explicit params', () => {
    const result = parseFileArgs({
      file: 'src/user.ts:10:5',
    });
    assert.strictEqual(result.file, 'src/user.ts');
    assert.deepStrictEqual(result.position, { line: 10, col: 5 });
  });

  it('should default to line 1, col 1 when no position', () => {
    const result = parseFileArgs({
      file: 'src/user.ts',
    });
    assert.strictEqual(result.file, 'src/user.ts');
    assert.deepStrictEqual(result.position, { line: 1, col: 1 });
  });
});

describe('Integration: getTypeAtPosition via LanguageService', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should get type using parsed file:line:col', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    // Use unified format
    const { file, position } = parseFileArgs({ file: `${testFile}:18:7` });
    const sourceFile = ls.getSourceFile(file);
    assert.ok(sourceFile);

    const offset = positionToOffset(sourceFile, position);
    const typeInfo = ls.getTypeAtPosition(file, offset);
    assert.ok(typeInfo);

    const typeStr = ls.getTypeChecker().typeToString(typeInfo.type);
    assert.strictEqual(typeStr, 'User');
  });

  it('should get definition using parsed format', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    // createUser call at line 18, col 17
    const { file, position } = parseFileArgs({ file: `${testFile}:18:17` });
    const sourceFile = ls.getSourceFile(file);
    assert.ok(sourceFile);

    const offset = positionToOffset(sourceFile, position);
    const definitions = ls.getDefinitionAtPosition(file, offset);

    assert.ok(definitions);
    assert.ok(definitions.length >= 1);
    assert.strictEqual(definitions[0]!.name, 'createUser');
  });

  it('should get hover using parsed format', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const { file, position } = parseFileArgs({ file: `${testFile}:18:17` });
    const sourceFile = ls.getSourceFile(file);
    assert.ok(sourceFile);

    const offset = positionToOffset(sourceFile, position);
    const quickInfo = ls.getQuickInfoAtPosition(file, offset);

    assert.ok(quickInfo);
    const display = quickInfo.displayParts?.map((p) => p.text).join('') ?? '';
    assert.ok(display.includes('createUser'));
  });
});

describe('Integration: getDiagnostics via LanguageService', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should get diagnostics for file with errors', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const diagnostics = project.languageService.getDiagnostics(testFile);

    assert.ok(diagnostics.length >= 1);
    const hasTypeError = diagnostics.some((d) => d.code === 2322);
    assert.ok(hasTypeError);
  });

  it('should get diagnostics for virtual file', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const virtualPath = path.join(fixtureDir, 'src/virtual-diag.ts');
    const content = `const x: number = 'bad';`;

    ls.setVirtualFile(virtualPath, content);
    const diagnostics = ls.getDiagnostics(virtualPath);

    assert.ok(diagnostics.some((d) => d.code === 2322));

    ls.removeVirtualFile(virtualPath);
  });
});

describe('Integration: getReferences via LanguageService', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should find references', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    // createUser function definition at line 11 (function createUser...)
    // The identifier "createUser" starts at column 10
    const { file, position } = parseFileArgs({ file: `${testFile}:11:10` });
    const sourceFile = ls.getSourceFile(file);
    assert.ok(sourceFile);

    const offset = positionToOffset(sourceFile, position);
    const references = ls.getReferencesAtPosition(file, offset);

    assert.ok(references);
    assert.ok(references.length >= 1);
  });
});

describe('Integration: virtual file support', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should type-check virtual file content', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const virtualPath = path.join(fixtureDir, 'src/virtual-test.ts');
    const content = `const myVar: string = 'hello';`;

    ls.setVirtualFile(virtualPath, content);

    const sourceFile = ls.getSourceFile(virtualPath);
    assert.ok(sourceFile);

    // Get type at "myVar" (col 7)
    const offset = positionToOffset(sourceFile, { line: 1, col: 7 });
    const typeInfo = ls.getTypeAtPosition(virtualPath, offset);
    assert.ok(typeInfo);

    const typeStr = ls.getTypeChecker().typeToString(typeInfo.type);
    assert.strictEqual(typeStr, 'string');

    ls.removeVirtualFile(virtualPath);
  });
});
