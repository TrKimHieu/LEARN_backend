import { fileURLToPath } from 'node:url';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundary from './boundary-rules.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      'artifacts/**',
      '.local/**',
      'docs/**',
      'scripts/**',
      'infra/**',
      '**/*.config.*',
      'eslint.config.mjs',
      '.prettierrc.*',
      'packages/config/**',
      'packages/contracts/scripts/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: repoRoot } },
    plugins: { boundary },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'boundary/no-cross-module-import': 'error',
    },
  },
);
