import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Config files (drizzle.config.ts etc.) often live outside the
          // package's `src/` rootDir and aren't picked up by the project
          // service. Let the parser fall back to the default project for
          // these. They get type-aware lint via that default project.
          // typescript-eslint forbids `**` here. List the depth levels we
          // actually use (root + one workspace level).
          allowDefaultProject: [
            '*.config.ts',
            '*.config.js',
            '*.config.mjs',
            'packages/*/*.config.ts',
            'packages/*/*.config.js',
            'apps/*/*.config.ts',
            'apps/*/*.config.js',
            'apps/*/scripts/*.ts',
            'apps/*/scripts/*.js',
            'packages/*/scripts/*.ts',
            'packages/*/scripts/*.js',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Config files often live outside their package's `src/` rootDir and
  // therefore aren't in the project service's program. Disable type-aware
  // rules for them; they're build-time scripts, not runtime code.
  {
    files: ['**/*.config.{js,ts,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/scripts/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['**/next-env.d.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  prettier,
);
