// Sample TypeScript file for testing ts-lsp-mcp

interface User {
  id: number;
  name: string;
  email: string;
}

type CreateUserInput = Omit<User, 'id'>;

function createUser(input: CreateUserInput): User {
  return {
    id: Math.floor(Math.random() * 1000),
    ...input,
  };
}

const newUser = createUser({
  name: 'Alice',
  email: 'alice@example.com',
});

// This should have a type error
const badUser: User = {
  id: 'not-a-number', // Error: string not assignable to number
  name: 'Bob',
  email: 'bob@example.com',
};

export { User, CreateUserInput, createUser, newUser };
