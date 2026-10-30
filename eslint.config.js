import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Dependency boundary (the most important architectural rule of PHASE 1):
 *  - `core` is the domain layer and MUST stay zero-dependency on the framework,
 *    storage and UI. It may not import react / zustand / idb / @app / @data / @ui.
 *  - This is enforced by `no-restricted-imports` below and is checked in CI via `npm run lint`.
 */
const coreBoundary = {
  files: ['src/core/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          'react',
          'react-dom',
          'react-dom/*',
          'react/*',
          'react-router-dom',
          'zustand',
          'zustand/*',
          'idb',
          'idb/*',
          '^@app$',
          '^@app/.*$',
          '^@data$',
          '^@data/.*$',
          '^@ui$',
          '^@ui/.*$',
          '../data',
          '../data/**',
          '../../data',
          '../../data/**',
          '../app',
          '../app/**',
          '../../app',
          '../../app/**',
          '../ui',
          '../ui/**',
          '../../ui',
          '../../ui/**',
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-ssr',
      'coverage',
      'playwright-report',
      'test-results',
      '.playwright',
      '.pwtmp',
      'node_modules',
      'public',
      '*.config.js',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  coreBoundary,
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
