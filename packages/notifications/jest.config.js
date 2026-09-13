module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'notifications.native.ts', 'notifications.web.ts'],
};
