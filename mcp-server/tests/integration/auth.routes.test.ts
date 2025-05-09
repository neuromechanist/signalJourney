import request from 'supertest';
import express from 'express'; // Import express type

import { startServer } from '../../src/index'; // Use relative path to src/index
import tokenServiceInstance from '../../src/services/token.service'; // Use relative path to services
// import config from '@/config'; // config seems unused in this file now

// Ensure the server is fully initialized before tests run if it's not already.
// This is a bit of a hack; ideally, app would be a promise or an async getter.
// For now, we rely on the fact that index.ts runs startServer().
// If using a test runner that doesn't execute index.ts first, you might need to call startServer() here.

// Mock the tokenService blacklist for isolated tests of auth routes
// This is to avoid interference between logout tests and validate tests
const mockBlacklist = new Set<string>();

jest.mock('../../src/services/token.service', () => {
  const originalTokenService = jest.requireActual('../../src/services/token.service').default; // Access the singleton instance
  return {
    __esModule: true,
    default: { // Keep the .default structure if that's how the original is exported and used
      ...originalTokenService,
      generateToken: jest.fn(originalTokenService.generateToken),
      verifyToken: jest.fn((token: string) => { 
        const decoded = originalTokenService.verifyToken(token);
        if (decoded && decoded.jti && mockBlacklist.has(decoded.jti)) {
          return null; 
        }
        return decoded;
      }),
      blacklistToken: jest.fn(async (jti: string, exp: number | undefined) => {
        if (jti && exp && exp > Math.floor(Date.now() / 1000)) {
          mockBlacklist.add(jti);
        }
      }),
      isJtiBlacklisted: jest.fn((jti: string) => mockBlacklist.has(jti)), 
    },
  };
});

let app: express.Express; // Variable to hold the app instance

describe('/auth routes', () => {
  let validUserToken = '';
  let validUserJti = '';

  // Use beforeAll to start the server once for the suite
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    try {
      // Start the server and get the app instance
      app = await startServer(); 
      // Now perform login to get token
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'password123' });
      
      if (loginRes.body.accessToken) {
        validUserToken = loginRes.body.accessToken;
        const decoded = tokenServiceInstance.verifyToken(validUserToken); 
        if (decoded && decoded.jti) {
          validUserJti = decoded.jti;
        }
      } else {
        console.error('Test setup failed: Could not log in', loginRes.status, loginRes.body);
        throw new Error('Prerequisite login failed for /auth route tests');
      }
    } catch (error) {
       console.error('Test setup failed: startServer() threw an error:', error);
       throw error; // Fail fast if server doesn't start
    }
  });

  beforeEach(() => {
    mockBlacklist.clear(); // Clear blacklist before each auth test
    // Reset mocks that track calls, if generateToken was also part of the mock above that needs reset for call counts
    (tokenServiceInstance.generateToken as jest.Mock).mockClear();
    (tokenServiceInstance.verifyToken as jest.Mock).mockClear();
    (tokenServiceInstance.blacklistToken as jest.Mock).mockClear();
  });

  describe('POST /auth/login', () => {
    it('should login a valid user and return an accessToken, tokenType, expiresIn, userId, username, and scopes', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'testuser', password: 'password123' });
      
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body).toHaveProperty('expiresIn');
      expect(res.body.sub).toBe('user-123');
      expect(res.body.username).toBe('testuser');
      expect(res.body.scopes).toEqual(expect.arrayContaining(['read:resource', 'write:resource']));
    });

    it('should return 401 for invalid credentials', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: 'wronguser', password: 'wrongpassword' });
      
      expect(res.statusCode).toEqual(401);
      expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('should return 400 for missing username', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ password: 'password123' });
      
      expect(res.statusCode).toEqual(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details[0].path).toEqual(['username']);
    });
  });

  describe('POST /auth/validate-token', () => {
    it('should return valid:true for a valid token', async () => {
      const res = await request(app)
        .post('/auth/validate-token')
        .send({ token: validUserToken });
      
      expect(res.statusCode).toEqual(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.payload.sub).toBe('user-123');
      expect(res.body.payload.jti).toBe(validUserJti);
    });

    it('should return valid:false for an invalid token', async () => {
      const res = await request(app)
        .post('/auth/validate-token')
        .send({ token: 'invalid-token-string' });
      
      expect(res.statusCode).toEqual(401);
      expect(res.body.code).toBe('AUTH_INVALID_TOKEN');
      // expect(res.body.valid).toBe(false); // The McpApplicationError won't have `valid` field
    });

    it('should return valid:false for a blacklisted token', async () => {
        mockBlacklist.clear();
        const loginResponse = await request(app).post('/auth/login').send({ username: 'testuser', password: 'password123' });
        const tokenToBlacklist = loginResponse.body.accessToken;
        const decodedToken = tokenServiceInstance.verifyToken(tokenToBlacklist); // Use instance
        
        expect(decodedToken).not.toBeNull();
        if (!decodedToken || !decodedToken.jti || !decodedToken.exp) throw new Error('Test setup error: could not decode token for blacklisting')

        await tokenServiceInstance.blacklistToken(decodedToken.jti, decodedToken.exp); // Use instance
        expect(mockBlacklist.has(decodedToken.jti)).toBe(true); 

        const res = await request(app)
            .post('/auth/validate-token')
            .send({ token: tokenToBlacklist });

        expect(res.statusCode).toEqual(401);
        expect(res.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });

  describe('POST /auth/logout', () => {
    it('should successfully log out a user by blacklisting their token and return 200', async () => {
      expect(mockBlacklist.has(validUserJti)).toBe(false); // Ensure not blacklisted before logout
      
      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${validUserToken}`);
      
      expect(res.statusCode).toEqual(200);
      expect(res.body.message).toBe('Successfully logged out.');
      expect(mockBlacklist.has(validUserJti)).toBe(true); // Check our mock blacklist
      // (tokenService.default.blacklistToken as jest.Mock).toHaveBeenCalledWith(validUserJti, expect.any(Number));

      // Try to validate the token again, it should now fail (as it's blacklisted by our mock)
      const validateRes = await request(app)
        .post('/auth/validate-token')
        .send({ token: validUserToken });
      expect(validateRes.statusCode).toEqual(401); // Updated from 400 to 401
      expect(validateRes.body.code).toBe('AUTH_INVALID_TOKEN'); // Updated from TOKEN_VALIDATION_FAILED
    });

    it('should return 401 if no token is provided for logout', async () => {
      const res = await request(app).post('/auth/logout');
      expect(res.statusCode).toEqual(401);
      expect(res.body.code).toBe('AUTH_REQUIRED'); // Updated from AUTHENTICATION_REQUIRED
    });
  });
}); 