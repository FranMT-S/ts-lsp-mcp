// Type test file for ts-lsp-mcp

interface User {
  id: number;
  name: string;
}

// @ts-lsp-mcp expect-type: User
const user: User = { id: 1, name: 'Alice' };

// @ts-lsp-mcp expect-type: string
const name = user.name;

// @ts-lsp-mcp expect-type: number
const id = user.id;

// @ts-lsp-mcp expect-type: string | undefined
const maybeName: string | undefined = Math.random() > 0.5 ? 'Bob' : undefined;

// @ts-lsp-mcp expect-error: 2322
const badId: number = 'not a number';

export { user };
