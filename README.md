# @franmt-s/ts-lsp-mcp

[![npm version](https://img.shields.io/npm/v/@franmt-s/ts-lsp-mcp.svg)](https://www.npmjs.com/package/@franmt-s/ts-lsp-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@franmt-s/ts-lsp-mcp.svg)](https://www.npmjs.com/package/@franmt-s/ts-lsp-mcp)
[![license](https://img.shields.io/npm/l/@franmt-s/ts-lsp-mcp.svg)](https://github.com/FranMT-S/ts-lsp-mcp/blob/main/LICENSE)

MCP server exposing TypeScript LSP-like functionality to AI agents.

Gives AI agents the same "what's the type at this position?" powers that IDE users have.

---

## Quick Start

### Install into Claude Code or AI Assistants

```bash
# Install to current project (recommended)
npx @franmt-s/ts-lsp-mcp install cc

# Or install globally for all projects
npx @franmt-s/ts-lsp-mcp install cc --global
```

That's it! The MCP server is now available to your AI Assistant.

### Uninstall

```bash
npx @franmt-s/ts-lsp-mcp uninstall cc
```

---

## MCP Configuration Examples

Add `@franmt-s/ts-lsp-mcp` to your MCP configuration file (`mcp_config.json`, `.mcp.json`, `claude_desktop_config.json`, or settings UI in Antigravity IDE, Cursor, Windsurf, Roo Code, Cline, VS Code).

### A. Via NPX (npm registry)

```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@franmt-s/ts-lsp-mcp",
        "serve",
        "--stdio"
      ]
    }
  }
}
```

### B. Directly from GitHub (Without npm)

```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "github:FranMT-S/ts-lsp-mcp",
        "serve",
        "--stdio"
      ]
    }
  }
}
```

### C. Local Development / Testing (Local Relative Path)

If you are developing or testing `ts-lsp-mcp` locally on your machine, point directly to your local built binary using a relative path:

```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "command": "node",
      "args": [
        "./dist/bin/ts-lsp-mcp.js",
        "serve",
        "--stdio"
      ]
    }
  }
}
```

---

## Manual Installation & HTTP / SSE Mode

### Global npm install

```bash
npm install -g @franmt-s/ts-lsp-mcp
ts-lsp-mcp install cc
```

### HTTP / SSE Mode (Local Testing)

For remote clients, web agents, or local debugging:

```bash
# Run local HTTP server on port 3000
node dist/bin/ts-lsp-mcp.js serve --http --port 3000
```

Available SSE endpoints:
- `GET /sse` - SSE connection endpoint
- `POST /message` - Send MCP JSON-RPC messages
- `GET /health` - Health check

MCP SSE Configuration:
```json
{
  "mcpServers": {
    "ts-lsp-mcp": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `getTypeAtPosition` | Get the TypeScript type at a specific file:line:col |
| `getDefinition` | Go to definition |
| `getReferences` | Find all references |
| `getHover` | Get hover documentation |
| `getCompletions` | Get autocomplete suggestions |
| `getDiagnostics` | Get type errors and warnings |
| `traceType` | Trace where a type comes from and how it's composed |
| `runTypeTests` | Run type assertions from `@ts-lsp-mcp` comments |
| `checkInlineCode` | Type-check inline TypeScript without creating files |

---

## Type Test Assertions

Add type assertions directly into your TypeScript code comments:

```typescript
// @ts-lsp-mcp expect-type: string
const name = user.name;

// @ts-lsp-mcp expect-type: User
const user = createUser({ name: 'Alice' });

// @ts-lsp-mcp expect-error: 2322
const bad: number = "oops";  // Should have error TS2322
```

Run assertions via MCP tool:
```json
{
  "tool": "runTypeTests",
  "arguments": {
    "file": "src/types.ts"
  }
}
```

Or via pattern:
```json
{
  "tool": "runTypeTests",
  "arguments": {
    "pattern": "**/*.type-test.ts"
  }
}
```

---

## Example Usage

### 1. Get type at position

Supports unified `file:line:col` format:

```json
{
  "tool": "getTypeAtPosition",
  "arguments": {
    "file": "src/user.ts:10:5"
  }
}
```

Or separate parameters:

```json
{
  "tool": "getTypeAtPosition",
  "arguments": {
    "file": "src/user.ts",
    "line": 10,
    "col": 5
  }
}
```

Response:
```json
{
  "type": "User",
  "expanded": "{ id: number; name: string; email: string }",
  "symbol": "user",
  "kind": "variable"
}
```

### 2. Check for type errors (Diagnostics)

```json
{
  "tool": "getDiagnostics",
  "arguments": {
    "file": "src/user.ts"
  }
}
```

### 3. Type-check inline code

```json
{
  "tool": "checkInlineCode",
  "arguments": {
    "code": "const x: number = 'bad';"
  }
}
```

Response:
```json
{
  "valid": false,
  "diagnostics": [{
    "line": 1,
    "col": 7,
    "code": 2322,
    "message": "Type 'string' is not assignable to type 'number'."
  }]
}
```

---

## Features

- **Multi-client support**: Works with Antigravity IDE, Claude Code, Cursor, Windsurf, VS Code, Roo Code, Cline.
- **Multi-project support**: Works with monorepos with multiple tsconfigs.
- **Auto-discovery**: Finds `tsconfig.json` automatically starting from target files.
- **Smart file resolution**: Accepts absolute, relative, or unique filenames.
- **Virtual files**: Type-check unsaved code with the `content` parameter.
- **Efficient**: Long-lived daemon caches TypeScript projects.

---

## CLI Options

```text
ts-lsp-mcp [command] [options]

Commands:
  serve              Start the MCP server (default)
  install <target>   Install into an AI assistant (cc, claude-code, claude)
  uninstall <target> Uninstall from an AI assistant

Serve options:
  --stdio           Use stdio transport (default)
  --http            Use HTTP/SSE transport
  --port <port>     HTTP server port (default: 3000)
  --host <host>     HTTP server host (default: 127.0.0.1)
  --debug           Enable debug logging

Install options:
  --global          Install globally (user scope) instead of project
  --name <name>     Custom name for the MCP server (default: ts-lsp-mcp)

General:
  -V, --version     Output version number
  -h, --help        Display help
```

---

## License

MIT License - see [LICENSE](file:///d:/Red%20Sadness/Programming/Z%20-%20Proyectos/ts-lsp-mcp/LICENSE) for details.

## Credits & Acknowledgments

This package is a maintained fork of [ts-lsp-mcp](https://github.com/jaenster/ts-lsp-mcp) created by [jaenster](https://github.com/jaenster). Special thanks to the original author for creating the foundation of this TypeScript MCP server.
