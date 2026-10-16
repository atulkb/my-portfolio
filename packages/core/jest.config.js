/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'Node16', moduleResolution: 'Node16', isolatedModules: true } },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/index.ts',
    '!src/ports.ts',
    '!src/**/types.ts',
  ],
  // LLD §5.4: ≥ 90 % line coverage gate on packages/core.
  coverageThreshold: { global: { lines: 90 } },
};
