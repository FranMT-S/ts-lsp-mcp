import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as http from 'node:http';
import { logger } from '../../utils/logger.js';

/**
 * Start the MCP server with HTTP/SSE transport.
 * This allows remote clients to connect via Server-Sent Events.
 */
export async function startHttpServer(
  server: McpServer,
  options: { port?: number; host?: string } = {}
): Promise<http.Server> {
  const port = options.port ?? 3000;
  const host = options.host ?? '127.0.0.1';

  // Track active transports by session
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: transports.size }));
      return;
    }

    // SSE endpoint - client connects here for events
    if (url.pathname === '/sse') {
      logger.info('New SSE connection');

      const transport = new SSEServerTransport('/message', res);
      const sessionId = generateSessionId();

      transports.set(sessionId, transport);

      // Clean up on disconnect
      res.on('close', () => {
        logger.info('SSE connection closed', { sessionId });
        transports.delete(sessionId);
      });

      await server.connect(transport);
      return;
    }

    // Message endpoint - client sends messages here
    if (url.pathname === '/message' && req.method === 'POST') {
      // Find the transport for this session
      // In a real implementation, you'd use session cookies or headers
      // For simplicity, we'll use the most recent transport
      const transport = Array.from(transports.values()).pop();

      if (!transport) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session. Connect to /sse first.' }));
        return;
      }

      // Read the request body
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      try {
        await transport.handlePostMessage(req, res, body);
      } catch (err) {
        logger.error('Error handling message', { error: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      endpoints: {
        '/sse': 'SSE connection endpoint (GET)',
        '/message': 'Message endpoint (POST)',
        '/health': 'Health check (GET)',
      },
    }));
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err) => {
      logger.error('HTTP server error', { error: String(err) });
      reject(err);
    });

    httpServer.listen(port, host, () => {
      logger.info(`HTTP/SSE server listening on http://${host}:${port}`);
      logger.info('Endpoints:');
      logger.info(`  GET  http://${host}:${port}/sse     - SSE connection`);
      logger.info(`  POST http://${host}:${port}/message - Send messages`);
      logger.info(`  GET  http://${host}:${port}/health  - Health check`);
      resolve(httpServer);
    });
  });
}

/**
 * Generate a simple session ID.
 */
function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 15);
}
