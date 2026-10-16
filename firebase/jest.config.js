/** @type {import('jest').Config} Rules tests; run via `npm run test:rules` (starts the Firestore emulator). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testTimeout: 20000,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
