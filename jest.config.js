module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js', // Exclude main entry file from coverage
    '!src/logger.js', // Exclude logger from coverage
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  // Clear mocks automatically between every test
  clearMocks: true,
  // Restore mocks after every test
  restoreMocks: true,
};