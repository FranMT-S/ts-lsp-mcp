// Example using zod for third-party type resolution testing
import { z } from 'zod';

// Define a schema
const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

// Infer the type from the schema
type User = z.infer<typeof UserSchema>;

// Create a user
const user: User = {
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
};

// Parse and validate
const parsed = UserSchema.parse(user);

// Safe parse returns a result object
const result = UserSchema.safeParse({ id: 'bad' });

export { UserSchema, User, user, parsed, result };
