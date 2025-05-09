// tests/setup.ts
import path from 'path';

import dotenv from 'dotenv';
import { disconnectDB } from '../src/core/db';

// Load environment variables from .env.test or .env.example for tests
// This ensures that tests run with a consistent and isolated environment

// Try to load .env.test first, then .env.example as a fallback
const testEnvPath = path.resolve(process.cwd(), '.env.test');
const exampleEnvPath = path.resolve(process.cwd(), '.env.example');

const envConfig = dotenv.config({ path: testEnvPath });

if (envConfig.error && envConfig.error.message.includes('ENOENT')) {
  // .env.test not found, try .env.example
  console.log('tests/setup.ts: .env.test not found, attempting to load .env.example for test configuration.');
  dotenv.config({ path: exampleEnvPath, override: true }); // Override ensures these values are used if .env was already loaded
} else if (envConfig.error) {
  // Some other error occurred with .env.test
  console.error('tests/setup.ts: Error loading .env.test:', envConfig.error);
} else {
  console.log('tests/setup.ts: Loaded test configuration from .env.test');
}

// Set NODE_ENV to 'test' if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Make sure JWT_SECRET is set for auth tests
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-for-jest';
}

// Example: Mock global Date (if needed for consistent timestamps in tests)
// const MOCK_DATE = '2024-01-01T00:00:00.000Z';
// jest.spyOn(global, 'Date').mockImplementation(() => new Date(MOCK_DATE));

// You can also set up global mocks here, e.g., for external services
// jest.mock('@/services/externalApi', () => ({
//   __esModule: true,
//   default: {
//     fetchData: jest.fn().mockResolvedValue({ data: 'mocked_data' }),
//   },
// }));

// Clean up after tests if needed, though Jest usually handles this well for mocks
afterAll(async () => {
  // jest.restoreAllMocks();
  
  // Ensure MongoDB connections are closed after all tests
  await disconnectDB();
  console.log('Tests cleanup complete. MongoDB connections closed.');
});

console.log('Test setup complete. JWT_SECRET:', process.env.JWT_SECRET ? 'Loaded' : 'NOT LOADED'); 