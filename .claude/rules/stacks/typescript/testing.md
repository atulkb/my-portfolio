---
description: Testing standards for TypeScript/JavaScript projects. Reusable stack rule.
paths: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/jest.config.*']
---

# TypeScript Testing Standards

- Runner: Jest (`jest-expo` preset for React Native packages, `ts-jest` or babel for pure TS packages). Component tests use `@testing-library/react-native`.
- **No real network calls** in unit tests — not to market-data APIs, LLMs, or Firebase. Mock at the service/interface boundary; use recorded JSON fixtures for API response shapes.
- Pure domain logic (calculations, parsers, rule evaluation, scoring) must have table-driven tests covering edge cases: empty input, insufficient history, NaN/undefined fields, boundary thresholds.
- Numeric assertions use `toBeCloseTo` with an explicit precision; never compare floats with `toBe`.
- LLM-dependent code is tested structurally: assert the output validates against its schema and that invalid outputs are rejected — never assert exact prose.
- Freeze time (`jest.useFakeTimers().setSystemTime(...)`) for anything date-dependent.
- Arrange / Act / Assert layout; one behaviour per test; descriptive `it('returns RED when ...')` names.
