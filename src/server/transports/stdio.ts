import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../utils/logger.js';

/**
 * Start the MCP server with stdio transport.
 * This is the primary transport for Claude Code integration.
 */
export async function startStdioServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  logger.info('Starting MCP server with stdio transport');

  await server.connect(transport);

  // Handle process signals
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down');
    process.exit(0);
  });

  logger.info('MCP server running on stdio');
}
