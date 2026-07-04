// Flat ESLint config (ESLint v9+). Phase 3.0 toolchain bootstrap — minimal ruleset.
// Lints TypeScript via typescript-eslint. No engine logic depends on this.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `products/` are separate, independently-deployable product workspaces with their own toolchain
    // (own package.json / deps / tests) — not linted as factory internals (mirrors tsconfig's src/tests scope).
    ignores: ['node_modules', 'dist', 'products'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
