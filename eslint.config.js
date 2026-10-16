// Flat ESLint config for the whole monorepo. https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/.expo/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // core must stay framework-free (CLAUDE.md: Coding Guidelines)
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*'],
              message: '@portfolio/core must not depend on React/Expo.',
            },
            {
              group: ['firebase', 'firebase/*', '@react-native-firebase/*'],
              message: '@portfolio/core must not depend on Firebase.',
            },
          ],
        },
      ],
    },
  },
]);
