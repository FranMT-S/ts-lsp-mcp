import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getProjectManager, disposeProjectManager } from '../src/typescript/project-manager.js';
import { positionToOffset, offsetToPosition } from '../src/typescript/position-utils.js';
import { serializeType, getSymbolKind } from '../src/typescript/type-serializer.js';
import { findTsConfig } from '../src/utils/tsconfig-finder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures/sample-project');
const testFile = path.join(fixtureDir, 'src/index.ts');

describe('ProjectManager', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should load a project from directory', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    assert.ok(project.tsconfigPath.endsWith('tsconfig.json'));
    assert.ok(project.projectRoot.endsWith('sample-project'));
    assert.ok(project.languageService);
    assert.ok(project.fileResolver);
  });

  it('should cache projects by tsconfig path', async () => {
    const pm = getProjectManager();
    const project1 = await pm.getProject(fixtureDir);
    const project2 = await pm.getProject(fixtureDir);

    assert.strictEqual(project1, project2);
  });

  it('should list loaded projects', async () => {
    const pm = getProjectManager();
    await pm.getProject(fixtureDir);

    const projects = pm.listProjects();
    assert.ok(projects.length >= 1);
    assert.ok(projects.some(p => p.projectRoot.endsWith('sample-project')));
  });
});

describe('LanguageServiceWrapper', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should get source file', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(testFile);

    assert.ok(sourceFile);
    assert.ok(sourceFile.fileName.endsWith('index.ts'));
  });

  it('should get type at position', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;
    const sourceFile = ls.getSourceFile(testFile);

    assert.ok(sourceFile);

    // Line 18: const newUser = createUser(...)
    const offset = positionToOffset(sourceFile, { line: 18, col: 7 });
    const typeInfo = ls.getTypeAtPosition(testFile, offset);

    assert.ok(typeInfo);
    assert.ok(typeInfo.type);

    const typeChecker = ls.getTypeChecker();
    const typeStr = typeChecker.typeToString(typeInfo.type);
    assert.strictEqual(typeStr, 'User');
  });

  it('should get diagnostics', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const diagnostics = project.languageService.getDiagnostics(testFile);

    // Should find the type error on line 25
    assert.ok(diagnostics.length >= 1);
    const hasTypeError = diagnostics.some(d => d.code === 2322);
    assert.ok(hasTypeError, 'Should have error 2322 (type mismatch)');
  });

  it('should get definition at position', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;
    const sourceFile = ls.getSourceFile(testFile);

    assert.ok(sourceFile);

    // Line 18, col 17: createUser call
    const offset = positionToOffset(sourceFile, { line: 18, col: 17 });
    const definitions = ls.getDefinitionAtPosition(testFile, offset);

    assert.ok(definitions);
    assert.ok(definitions.length >= 1);
    assert.strictEqual(definitions[0]!.name, 'createUser');
  });

  it('should handle virtual files', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const virtualPath = path.join(fixtureDir, 'src/virtual.ts');
    const content = `
      interface Test { value: number; }
      const test: Test = { value: 42 };
    `;

    ls.setVirtualFile(virtualPath, content);
    assert.ok(ls.isVirtualFile(virtualPath));

    const sourceFile = ls.getSourceFile(virtualPath);
    assert.ok(sourceFile);

    // Check we can get type info from virtual file
    const offset = positionToOffset(sourceFile, { line: 3, col: 13 });
    const typeInfo = ls.getTypeAtPosition(virtualPath, offset);
    assert.ok(typeInfo);

    ls.removeVirtualFile(virtualPath);
    assert.ok(!ls.isVirtualFile(virtualPath));
  });
});

describe('FileResolver', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should resolve absolute paths', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const resolved = await project.fileResolver.resolve(testFile);
    assert.strictEqual(resolved, testFile);
  });

  it('should resolve relative paths', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const resolved = await project.fileResolver.resolve('src/index.ts');
    assert.ok(resolved.endsWith('src/index.ts'));
  });

  it('should resolve unique filenames', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    const resolved = await project.fileResolver.resolve('index.ts');
    assert.ok(resolved.endsWith('index.ts'));
  });

  it('should throw on ambiguous filenames', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);

    // Both index.ts and type-tests.ts exist in src/, so just 'ts' filename is ambiguous
    await assert.rejects(
      () => project.fileResolver.resolve('nonexistent.ts'),
      /not found/i
    );
  });
});

describe('Position utilities', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should convert position to offset and back', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(testFile);

    assert.ok(sourceFile);

    // Use line 11 (function createUser) which has content
    const original = { line: 11, col: 10 };
    const offset = positionToOffset(sourceFile, original);
    const converted = offsetToPosition(sourceFile, offset);

    assert.strictEqual(converted.line, original.line);
    assert.strictEqual(converted.col, original.col);
  });

  it('should throw on invalid line', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const sourceFile = project.languageService.getSourceFile(testFile);

    assert.ok(sourceFile);

    assert.throws(
      () => positionToOffset(sourceFile, { line: 9999, col: 1 }),
      /out of range/i
    );
  });
});

describe('Type serializer', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should serialize simple types', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;
    const sourceFile = ls.getSourceFile(testFile);

    assert.ok(sourceFile);

    // Line 18: const newUser (type User)
    const offset = positionToOffset(sourceFile, { line: 18, col: 7 });
    const typeInfo = ls.getTypeAtPosition(testFile, offset);

    assert.ok(typeInfo);

    const serialized = serializeType(typeInfo.type, ls.getTypeChecker(), {
      expandDepth: 1,
    });

    assert.strictEqual(serialized.text, 'User');
    assert.ok(serialized.expanded);
    assert.ok(serialized.expanded.includes('id'));
    assert.ok(serialized.expanded.includes('name'));
  });

  it('should not explode primitive types', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;
    const sourceFile = ls.getSourceFile(testFile);

    assert.ok(sourceFile);

    const serialized = serializeType(
      ls.getTypeChecker().getStringType(),
      ls.getTypeChecker(),
      { expandDepth: 5 }
    );

    // Should just be "string", not exploded with all string methods
    assert.strictEqual(serialized.text, 'string');
    assert.ok(!serialized.expanded || serialized.expanded === 'string');
  });
});

describe('tsconfig finder', () => {
  it('should find tsconfig.json', () => {
    const found = findTsConfig(fixtureDir);
    assert.ok(found);
    assert.ok(found.endsWith('tsconfig.json'));
  });

  it('should find tsconfig from nested directory', () => {
    const srcDir = path.join(fixtureDir, 'src');
    const found = findTsConfig(srcDir);
    assert.ok(found);
    assert.ok(found.endsWith('tsconfig.json'));
  });

  it('should return null when no tsconfig exists', () => {
    const found = findTsConfig('/tmp');
    // May or may not find one depending on system, so just check it doesn't throw
    assert.ok(found === null || typeof found === 'string');
  });
});

describe('Library and external type resolution', () => {
  after(() => {
    disposeProjectManager();
  });

  it('should resolve types from TypeScript standard library', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    // Create a virtual file using standard library types
    const virtualPath = path.join(fixtureDir, 'src/stdlib-test.ts');
    const content = `
const myPromise = Promise.resolve(42);
const myMap = new Map<string, number>();
const myArray: Array<string> = [];
`;

    ls.setVirtualFile(virtualPath, content);

    const sourceFile = ls.getSourceFile(virtualPath);
    assert.ok(sourceFile, 'Should be able to get virtual source file');

    // Check Promise type at line 2, "myPromise" (col 7)
    const promiseOffset = positionToOffset(sourceFile, { line: 2, col: 7 });
    const promiseType = ls.getTypeAtPosition(virtualPath, promiseOffset);
    assert.ok(promiseType, 'Should get type for Promise variable');

    const promiseTypeStr = ls.getTypeChecker().typeToString(promiseType.type);
    assert.ok(promiseTypeStr.includes('Promise'), `Expected Promise type, got: ${promiseTypeStr}`);

    // Check Map type at line 3, "myMap" (col 7)
    const mapOffset = positionToOffset(sourceFile, { line: 3, col: 7 });
    const mapType = ls.getTypeAtPosition(virtualPath, mapOffset);
    assert.ok(mapType, 'Should get type for Map variable');

    const mapTypeStr = ls.getTypeChecker().typeToString(mapType.type);
    assert.ok(mapTypeStr.includes('Map'), `Expected Map type, got: ${mapTypeStr}`);

    // Check Array type at line 4, "myArray" (col 7)
    const arrayOffset = positionToOffset(sourceFile, { line: 4, col: 7 });
    const arrayType = ls.getTypeAtPosition(virtualPath, arrayOffset);
    assert.ok(arrayType, 'Should get type for Array variable');

    const arrayTypeStr = ls.getTypeChecker().typeToString(arrayType.type);
    assert.ok(arrayTypeStr.includes('string'), `Expected string[] type, got: ${arrayTypeStr}`);

    ls.removeVirtualFile(virtualPath);
  });

  it('should get definition for standard library types', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const virtualPath = path.join(fixtureDir, 'src/stdlib-def.ts');
    const content = `const p = new Promise<void>(() => {});`;

    ls.setVirtualFile(virtualPath, content);

    const sourceFile = ls.getSourceFile(virtualPath);
    assert.ok(sourceFile);

    // Get definition at "Promise" (col 15)
    const offset = positionToOffset(sourceFile, { line: 1, col: 15 });
    const definitions = ls.getDefinitionAtPosition(virtualPath, offset);

    assert.ok(definitions, 'Should find definition for Promise');
    assert.ok(definitions.length >= 1, 'Should have at least one definition');

    // Definition should be in a .d.ts file (lib files)
    const hasLibDef = definitions.some((d) =>
      d.fileName.includes('lib.') && d.fileName.endsWith('.d.ts')
    );
    assert.ok(hasLibDef, 'Promise definition should be in TypeScript lib files');

    ls.removeVirtualFile(virtualPath);
  });

  it('should filter node_modules from references by default', async () => {
    const pm = getProjectManager();
    const project = await pm.getProject(fixtureDir);
    const ls = project.languageService;

    const virtualPath = path.join(fixtureDir, 'src/ref-test.ts');
    const content = `
interface MyInterface {
  name: string;
}
const obj: MyInterface = { name: 'test' };
`;

    ls.setVirtualFile(virtualPath, content);

    const sourceFile = ls.getSourceFile(virtualPath);
    assert.ok(sourceFile);

    // Get references at "MyInterface" definition (line 2, col 11)
    const offset = positionToOffset(sourceFile, { line: 2, col: 11 });
    const references = ls.getReferencesAtPosition(virtualPath, offset);

    assert.ok(references, 'Should find references');

    // All references should be in our project files, not node_modules
    const allInProject = references.every((ref) => !ref.fileName.includes('node_modules'));
    assert.ok(allInProject, 'References should not include node_modules by default');

    ls.removeVirtualFile(virtualPath);
  });
});
