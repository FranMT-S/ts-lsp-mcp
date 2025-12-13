/**
 * Smoke test - verifies core functionality works
 */
import { getProjectManager } from '../src/typescript/project-manager.js';
import { positionToOffset, offsetToPosition } from '../src/typescript/position-utils.js';
import { serializeType } from '../src/typescript/type-serializer.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🧪 Running smoke tests...\n');

  const fixtureDir = path.join(__dirname, 'fixtures/sample-project');
  const testFile = path.join(fixtureDir, 'src/index.ts');

  // Test 1: Project Manager
  console.log('Test 1: ProjectManager - loading project');
  const pm = getProjectManager();
  const project = await pm.getProject(fixtureDir);
  console.log(`  ✓ Loaded project: ${project.projectRoot}`);
  console.log(`  ✓ tsconfig: ${project.tsconfigPath}`);

  // Test 2: Get type at position
  console.log('\nTest 2: Get type at position');
  const ls = project.languageService;
  const sourceFile = ls.getSourceFile(testFile);
  if (!sourceFile) throw new Error('Failed to get source file');

  // Line 18: const newUser = createUser(...)
  // The type of newUser should be User
  const newUserPosition = { line: 18, col: 7 }; // 'newUser'
  const offset = positionToOffset(sourceFile, newUserPosition);
  console.log(`  Position ${newUserPosition.line}:${newUserPosition.col} => offset ${offset}`);

  const typeInfo = ls.getTypeAtPosition(testFile, offset);
  if (!typeInfo) throw new Error('Failed to get type info');

  const typeChecker = ls.getTypeChecker();
  const serialized = serializeType(typeInfo.type, typeChecker, { expandDepth: 2 });
  console.log(`  ✓ Type: ${serialized.text}`);
  if (serialized.expanded) {
    console.log(`  ✓ Expanded: ${serialized.expanded}`);
  }

  // Test 3: Get diagnostics
  console.log('\nTest 3: Get diagnostics');
  const diagnostics = ls.getDiagnostics(testFile);
  console.log(`  ✓ Found ${diagnostics.length} diagnostic(s)`);
  for (const d of diagnostics.slice(0, 3)) {
    const pos = d.file && d.start !== undefined
      ? offsetToPosition(d.file, d.start)
      : null;
    const locStr = pos ? `${pos.line}:${pos.col}` : 'unknown';
    const msg = typeof d.messageText === 'string'
      ? d.messageText
      : d.messageText.messageText;
    console.log(`    - [${locStr}] ${msg.slice(0, 80)}`);
  }

  // Test 4: Get definition
  console.log('\nTest 4: Get definition');
  const createUserPosition = { line: 18, col: 17 }; // 'createUser' call
  const defOffset = positionToOffset(sourceFile, createUserPosition);
  const definitions = ls.getDefinitionAtPosition(testFile, defOffset);
  if (!definitions || definitions.length === 0) {
    console.log('  ⚠️ No definitions found');
  } else {
    console.log(`  ✓ Found ${definitions.length} definition(s)`);
    for (const def of definitions) {
      console.log(`    - ${def.fileName}:${def.kind} "${def.name}"`);
    }
  }

  // Test 5: Get completions
  console.log('\nTest 5: Get completions');
  // After 'newUser.' we should get completions for User properties
  const completionPosition = { line: 18, col: 15 };
  const compOffset = positionToOffset(sourceFile, completionPosition);
  const completions = ls.getCompletionsAtPosition(testFile, compOffset);
  if (!completions) {
    console.log('  ⚠️ No completions found');
  } else {
    console.log(`  ✓ Found ${completions.entries.length} completion(s)`);
    const first5 = completions.entries.slice(0, 5).map(e => e.name);
    console.log(`    First 5: ${first5.join(', ')}`);
  }

  // Cleanup
  pm.dispose();

  console.log('\n✅ All smoke tests passed!');
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
