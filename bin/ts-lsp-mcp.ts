import { Command } from 'commander';
import { createMcpServer, shutdownServer } from '../src/server/mcp-server.js';
import { startStdioServer } from '../src/server/transports/stdio.js';
import { startHttpServer } from '../src/server/transports/http-sse.js';
import { setLogLevel, logger } from '../src/utils/logger.js';

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

program.parse();
