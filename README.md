# ts-lsp-mcp

MCP server exposing TypeScript LSP-like functionality to AI agents.

Gives AI agents the same "what's the type at this position?" powers that IDE users have.

## Installation

```bash
npm install -g ts-lsp-mcp
```

## Usage

### With Claude Code (stdio)

Add to your Claude Code MCP config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "typescript": {
      "command": "ts-lsp-mcp"
    }
  }
}
```

### HTTP/SSE Mode

For remote clients or debugging:

```bash
ts-lsp-mcp --http --port 3000
```

Endpoints:
- `GET /sse` - SSE connection
- `POST /message` - Send messages
- `GET /health` - Health check

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

## Type Test Assertions

Add type assertions to your code:

```typescript
// @ts-lsp-mcp expect-type: string
const name = user.name;

// @ts-lsp-mcp expect-type: User
const user = createUser({ name: 'Alice' });

// @ts-lsp-mcp expect-error: 2322
const bad: number = "oops";  // Should have error 2322
```

Run tests:
```
runTypeTests({ file: "src/types.ts" })
runTypeTests({ pattern: "**/*.type-test.ts" })
```

## Example Usage

### Get type at position
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

### Check for type errors
```json
{
  "tool": "getDiagnostics",
  "arguments": {
    "file": "src/user.ts"
  }
}
```

### Type-check inline code
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

## Features

- **Multi-project support**: Works with monorepos with multiple tsconfigs
- **Auto-discovery**: Finds tsconfig.json automatically
- **Smart file resolution**: Accepts absolute, relative, or unique filenames
- **Virtual files**: Type-check unsaved code with the `content` parameter
- **Efficient**: Long-lived daemon caches TypeScript projects

## CLI Options

```
ts-lsp-mcp [command] [options]

Commands:
  serve (default)    Start the MCP server

Options:
  --stdio           Use stdio transport (default)
  --http            Use HTTP/SSE transport
  --port <port>     HTTP server port (default: 3000)
  --host <host>     HTTP server host (default: 127.0.0.1)
  --debug           Enable debug logging
  -V, --version     Output version number
  -h, --help        Display help
```

## License

MIT
