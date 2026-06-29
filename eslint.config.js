// Flat ESLint config (ESLint v9+). Phase 3.0 toolchain bootstrap — minimal ruleset.
// Lints TypeScript via typescript-eslint. No engine logic depends on this.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules', 'dist'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
