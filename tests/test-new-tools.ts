/**
 * Test the new tools: traceType, runTypeTests, checkInlineCode
 */
import { getProjectManager, disposeProjectManager } from '../src/typescript/project-manager.js';
import { positionToOffset } from '../src/typescript/position-utils.js';
import { runTypeTests } from '../src/type-tests/runner.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🧪 Testing new tools...\n');

  const fixtureDir = path.join(__dirname, 'fixtures/sample-project');

  // Test 1: Type Tests
  console.log('Test 1: runTypeTests');
  const pm = getProjectManager();
  const project = await pm.getProject(fixtureDir);

  const typeTestFile = path.join(fixtureDir, 'src/type-tests.ts');
  const results = await runTypeTests(project, { file: typeTestFile });

  console.log(`  Total: ${results.passed + results.failed} tests`);
  console.log(`  ✓ Passed: ${results.passed}`);
  console.log(`  ✗ Failed: ${results.failed}`);

  for (const r of results.results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`    ${icon} Line ${r.line}: ${r.kind} "${r.expected}" => "${r.actual}"`);
    if (r.message) {
      console.log(`      ${r.message}`);
    }
  }

  // Test 2: checkInlineCode
  console.log('\nTest 2: checkInlineCode');

  // Valid code
  const validCode = `
    interface User { id: number; name: string; }
    const user: User = { id: 1, name: 'Alice' };
  `;

  const validResult = checkInlineCode(validCode);
  console.log(`  Valid code: ${validResult.valid ? '✓ passes' : '✗ fails'}`);

  // Invalid code
  const invalidCode = `
    interface User { id: number; name: string; }
    const user: User = { id: 'bad', name: 'Alice' };
  `;

  const invalidResult = checkInlineCode(invalidCode);
  console.log(`  Invalid code: ${!invalidResult.valid ? '✓ correctly fails' : '✗ should fail'}`);
  if (invalidResult.diagnostics.length > 0) {
    console.log(`    Error: ${invalidResult.diagnostics[0]?.message.slice(0, 60)}...`);
  }

  // Test 3: traceType (manual test via LanguageService)
  console.log('\nTest 3: traceType (basic)');
  const ls = project.languageService;
  const testFile = path.join(fixtureDir, 'src/index.ts');
  const sourceFile = ls.getSourceFile(testFile);

  if (sourceFile) {
    // Line 9: type CreateUserInput = Omit<User, 'id'>
    const offset = positionToOffset(sourceFile, { line: 9, col: 6 });
    const typeInfo = ls.getTypeAtPosition(testFile, offset);

    if (typeInfo) {
      const typeChecker = ls.getTypeChecker();
      const type = typeInfo.type;

      // Check if it's an alias
      const aliasSymbol = type.aliasSymbol;
      if (aliasSymbol) {
        console.log(`  ✓ Found type alias: ${aliasSymbol.getName()}`);
        const aliasArgs = type.aliasTypeArguments;
        if (aliasArgs) {
          console.log(`    Type arguments: ${aliasArgs.map(t => typeChecker.typeToString(t)).join(', ')}`);
        }
      } else {
        console.log(`  Type: ${typeChecker.typeToString(type)}`);
      }
    }
  }

  // Cleanup
  disposeProjectManager();

  console.log('\n✅ All new tool tests completed!');
}

/**
 * Simple inline code checking (synchronous version for testing).
 */
function checkInlineCode(code: string): { valid: boolean; diagnostics: Array<{ message: string }> } {
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
    readFile: (name) => name === fileName ? code : defaultHost.readFile(name),
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  const allDiagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ];

  return {
    valid: allDiagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length === 0,
    diagnostics: allDiagnostics.map(d => ({
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    })),
  };
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
