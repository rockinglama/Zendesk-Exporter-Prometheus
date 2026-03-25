// Test setup - runs before each test
const client = require('prom-client');

beforeEach(() => {
  // Clear the prom-client registry to avoid "already registered" errors
  client.register.clear();
});