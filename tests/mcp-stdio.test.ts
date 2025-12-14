import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixtures/sample-project');
const cliPath = path.join(projectRoot, 'dist/bin/ts-lsp-mcp.js');

/**
 * MCP JSON-RPC client for testing.
 */
class McpTestClient {
  private process: ChildProcess;
  private buffer = '';
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }> = new Map();

  constructor(process: ChildProcess) {
    this.process = process;

    // Handle stdout data
    process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle stderr (for debugging)
    process.stderr!.on('data', (data: Buffer) => {
      // Ignore log output during tests
    });
  }

  private processBuffer(): void {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        // Skip non-JSON lines (like log messages)
      }
    }
  }

  private handleMessage(message: { id?: number; result?: unknown; error?: unknown }): void {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    }
  }

  /**
   * Send a JSON-RPC request and wait for response.
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin!.write(JSON.stringify(message) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  /**
   * Send a notification (no response expected).
   */
  notify(method: string, params?: unknown): void {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.process.stdin!.write(JSON.stringify(message) + '\n');
  }

  /**
   * Initialize the MCP connection.
   */
  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    // Send initialized notification
    this.notify('notifications/initialized');

    return result;
  }

  /**
   * Call an MCP tool.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', {
      name,
      arguments: args,
    });
  }

  /**
   * List available tools.
   */
  async listTools(): Promise<unknown> {
    return this.request('tools/list', {});
  }

  /**
   * Close the connection.
   */
  close(): void {
    this.process.kill('SIGTERM');
  }
}

describe('MCP Server via stdio', () => {
  let serverProcess: ChildProcess;
  let client: McpTestClient;

  before(async () => {
    // Spawn the MCP server process
    serverProcess = spawn('node', [cliPath, 'serve', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Wait a bit for the server to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    client = new McpTestClient(serverProcess);

    // Initialize the MCP connection
    const initResult = await client.initialize();
    assert.ok(initResult, 'Server should initialize successfully');
  });

  after(() => {
    if (client) {
      client.close();
    }
  });

  it('should list available tools', async () => {
    const result = await client.listTools() as { tools: Array<{ name: string }> };

    assert.ok(result.tools, 'Should return tools array');
    assert.ok(result.tools.length > 0, 'Should have at least one tool');

    const toolNames = result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('getTypeAtPosition'), 'Should have getTypeAtPosition tool');
    assert.ok(toolNames.includes('getDiagnostics'), 'Should have getDiagnostics tool');
    assert.ok(toolNames.includes('getDefinition'), 'Should have getDefinition tool');
    assert.ok(toolNames.includes('getReferences'), 'Should have getReferences tool');
    assert.ok(toolNames.includes('traceType'), 'Should have traceType tool');
  });

  it('should get type at position for local types', async () => {
    const testFile = path.join(fixtureDir, 'src/index.ts');

    const result = await client.callTool('getTypeAtPosition', {
      file: `${testFile}:18:7`, // const newUser
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');
    assert.ok(result.content.length > 0, 'Should have content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.type, 'Should have type');
    assert.ok(data.type.includes('User'), `Expected User type, got: ${data.type}`);
  });

  it('should get type for zod schema', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Get type at "UserSchema" (line 5, col 7)
    const result = await client.callTool('getTypeAtPosition', {
      file: `${testFile}:5:7`,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.type, 'Should have type for zod schema');
    // Zod object schemas have complex types
    assert.ok(
      data.type.includes('ZodObject') || data.type.includes('Object'),
      `Expected ZodObject type, got: ${data.type}`
    );
  });

  it('should get type for zod inferred type', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Get type at "user" variable (line 16, col 7)
    const result = await client.callTool('getTypeAtPosition', {
      file: `${testFile}:16:7`,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.type, 'Should have type for zod inferred variable');
    // The inferred type should be an object with id, name, email, age?
    assert.ok(
      data.type.includes('id') && data.type.includes('name') && data.type.includes('email'),
      `Expected object with id, name, email - got: ${data.type}`
    );
  });

  it('should get definition for zod import', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Get definition at "z" import (line 2, col 10)
    const result = await client.callTool('getDefinition', {
      file: `${testFile}:2:10`,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.definitions, 'Should have definitions');
    assert.ok(data.definitions.length >= 1, 'Should find at least one definition');

    // Definition should be in node_modules/zod
    const hasZodDef = data.definitions.some((d: { file: string }) =>
      d.file.includes('node_modules/zod') || d.file.includes('zod')
    );
    assert.ok(hasZodDef, 'Definition should be in zod package');
  });

  it('should get diagnostics for file', async () => {
    const testFile = path.join(fixtureDir, 'src/index.ts');

    const result = await client.callTool('getDiagnostics', {
      file: testFile,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.diagnostics, 'Should have diagnostics array');
    assert.ok(data.summary, 'Should have summary');
    // The index.ts file has a type error on line 25
    assert.ok(data.summary.errors >= 1, 'Should have at least one error');
  });

  it('should get hover info', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Get hover at "parse" method (line 23, col 27 - start of "parse")
    // Line: const parsed = UserSchema.parse(user);
    //       1234567890123456789012345678901234567
    const result = await client.callTool('getHover', {
      file: `${testFile}:23:27`,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.displayString, 'Should have display string');
    // parse is a method on ZodObject
    assert.ok(data.displayString.length > 0, 'Should have non-empty display string');
  });

  it('should get completions', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Get completions after "UserSchema." (line 23, col 27) - right after the dot
    // Line: const parsed = UserSchema.parse(user);
    //       1234567890123456789012345678901234567
    // The dot is at col 26, so col 27 is right after it
    const result = await client.callTool('getCompletions', {
      file: `${testFile}:23:27`,
      maxResults: 50,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.completions, 'Should have completions');
    assert.ok(data.completions.length > 0, 'Should have at least one completion');
  });

  it('should trace type origin', async () => {
    const testFile = path.join(fixtureDir, 'src/zod-example.ts');

    // Trace type at "User" type alias (line 13, col 6)
    const result = await client.callTool('traceType', {
      file: `${testFile}:13:6`,
      depth: 2,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.type, 'Should have type');
    assert.ok(data.kind, 'Should have kind');
  });

  it('should handle virtual file content', async () => {
    const virtualPath = path.join(fixtureDir, 'src/virtual-mcp.ts');
    const content = `
import { z } from 'zod';
const schema = z.string();
const value = schema.parse('hello');
`;

    const result = await client.callTool('getTypeAtPosition', {
      file: `${virtualPath}:4:7`, // "value" variable
      projectRoot: fixtureDir,
      content,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    assert.ok(data.type, 'Should have type');
    assert.strictEqual(data.type, 'string', 'Value should be string type');
  });

  it('should run type tests', async () => {
    const testFile = path.join(fixtureDir, 'src/type-tests.ts');

    const result = await client.callTool('runTypeTests', {
      file: testFile,
      projectRoot: fixtureDir,
    }) as { content: Array<{ text: string }> };

    assert.ok(result.content, 'Should return content');

    const data = JSON.parse(result.content[0]!.text);
    // Return structure is: { passed: number, failed: number, results: [...] }
    assert.ok(typeof data.passed === 'number', 'Should have passed count');
    assert.ok(typeof data.failed === 'number', 'Should have failed count');
    assert.ok(data.results, 'Should have results array');
    assert.ok(data.passed + data.failed > 0, 'Should have run some tests');
    assert.ok(data.passed > 0, 'Should have passed tests');
  });
});
