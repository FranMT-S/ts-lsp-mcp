import { Command } from 'commander';
import { execSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer, shutdownServer } from '../src/server/mcp-server.js';
import { startStdioServer } from '../src/server/transports/stdio.js';
import { startHttpServer } from '../src/server/transports/http-sse.js';
import { setLogLevel, logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('ts-lsp-mcp')
  .description('MCP server exposing TypeScript LSP-like functionality to AI agents')
  .version('0.1.0');

program
  .command('serve', { isDefault: true })
  .description('Start the MCP server')
  .option('--stdio', 'Use stdio transport (default)')
  .option('--http', 'Use HTTP/SSE transport')
  .option('--port <port>', 'HTTP server port', '3000')
  .option('--host <host>', 'HTTP server host', '127.0.0.1')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    if (options.debug) {
      setLogLevel('debug');
    }

    const server = createMcpServer();

    // Cleanup on exit
    process.on('exit', () => {
      shutdownServer();
    });

    if (options.http) {
      // HTTP/SSE transport
      const port = parseInt(options.port, 10);
      const httpServer = await startHttpServer(server, {
        port,
        host: options.host,
      });

      // Handle shutdown
      process.on('SIGINT', () => {
        logger.info('Shutting down HTTP server');
        httpServer.close();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        logger.info('Shutting down HTTP server');
        httpServer.close();
        process.exit(0);
      });
    } else {
      // Default: stdio transport
      await startStdioServer(server);
    }
  });

// Install command for Claude Code integration
program
  .command('install <target>')
  .description('Install ts-lsp-mcp into an AI assistant')
  .option('--global', 'Install globally (not project-specific)')
  .option('--name <name>', 'Custom name for the MCP server', 'ts-lsp-mcp')
  .action(async (target: string, options: { global?: boolean; name?: string }) => {
    const validTargets = ['cc', 'claude-code', 'claude'];

    if (!validTargets.includes(target.toLowerCase())) {
      console.error(`Unknown target: ${target}`);
      console.error(`Valid targets: ${validTargets.join(', ')}`);
      process.exit(1);
    }

    // Determine the path to the CLI
    // If installed globally, use the command name
    // If running from source, use the full path
    let mcpCommand: string;

    try {
      // Check if ts-lsp-mcp is in PATH
      execSync('which ts-lsp-mcp', { stdio: 'ignore' });
      mcpCommand = 'ts-lsp-mcp';
    } catch {
      // Use the full path to the current script
      mcpCommand = `node ${path.resolve(__dirname, 'ts-lsp-mcp.js')}`;
    }

    // Build the claude mcp add command
    const scope = options.global ? 'user' : 'project';
    const args = [
      'mcp', 'add',
      '--scope', scope,
      '--transport', 'stdio',
      options.name ?? 'ts-lsp-mcp',
      '--',
      ...mcpCommand.split(' '),
      'serve', '--stdio'
    ];

    console.log(`Installing ts-lsp-mcp into Claude Code...`);
    console.log(`Running: claude ${args.join(' ')}`);

    try {
      const result = spawn('claude', args, {
        stdio: 'inherit',
      });

      result.on('error', (err) => {
        console.error('Failed to run claude command:', err.message);
        console.error('\nMake sure Claude Code CLI is installed.');
        console.error('You can install it with: npm install -g @anthropic-ai/claude-code');
        process.exit(1);
      });

      result.on('close', (code) => {
        if (code === 0) {
          console.log('\nts-lsp-mcp has been added to Claude Code!');
          console.log('The MCP server provides these tools:');
          console.log('  - getTypeAtPosition: Get TypeScript type at file:line:col');
          console.log('  - getDefinition: Go to definition');
          console.log('  - getReferences: Find all references');
          console.log('  - getHover: Get hover documentation');
          console.log('  - getCompletions: Get autocomplete suggestions');
          console.log('  - getDiagnostics: Get type errors and warnings');
          console.log('  - traceType: Trace type composition and origin');
          console.log('  - runTypeTests: Run @ts-lsp-mcp type assertions');
          console.log('  - checkInlineCode: Type-check inline code');
        } else {
          process.exit(code ?? 1);
        }
      });
    } catch (err) {
      console.error('Failed to install:', err);
      process.exit(1);
    }
  });

// Uninstall command
program
  .command('uninstall <target>')
  .description('Uninstall ts-lsp-mcp from an AI assistant')
  .option('--global', 'Uninstall globally')
  .option('--name <name>', 'Name of the MCP server to remove', 'ts-lsp-mcp')
  .action(async (target: string, options: { global?: boolean; name?: string }) => {
    const validTargets = ['cc', 'claude-code', 'claude'];

    if (!validTargets.includes(target.toLowerCase())) {
      console.error(`Unknown target: ${target}`);
      process.exit(1);
    }

    const scope = options.global ? 'user' : 'project';
    const args = ['mcp', 'remove', '--scope', scope, options.name ?? 'ts-lsp-mcp'];

    console.log(`Removing ts-lsp-mcp from Claude Code...`);

    try {
      const result = spawn('claude', args, {
        stdio: 'inherit',
      });

      result.on('close', (code) => {
        if (code === 0) {
          console.log('\nts-lsp-mcp has been removed from Claude Code.');
        } else {
          process.exit(code ?? 1);
        }
      });
    } catch (err) {
      console.error('Failed to uninstall:', err);
      process.exit(1);
    }
  });

program.parse();
