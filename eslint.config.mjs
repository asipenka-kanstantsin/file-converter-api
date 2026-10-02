// @ts-check
import eslint from '@eslint/js';
import perfectionist from 'eslint-plugin-perfectionist';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Layer direction: config ← common ← infrastructure ← modules. Other modules are reached only
// through their index.ts (`@/modules/<name>`), never deeper.
const deepModuleImport = {
  group: ['@/modules/*/*'],
  message: 'Import another module only through its public API: @/modules/<name>.',
};
const layer = (forbidden) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        deepModuleImport,
        ...forbidden.map((target) => ({
          group: [`@/${target}`, `@/${target}/*`],
          message: `This layer must not import from ${target}/ (01-architecture).`,
        })),
      ],
    },
  ],
});

export default tseslint.config(
  { ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'src/generated/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      sourceType: 'commonjs',
    },
    plugins: { perfectionist },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true, varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          internalPattern: ['^@/.+'],
          type: 'natural',
        },
      ],
      'perfectionist/sort-interfaces': ['error', { type: 'natural' }],
      'perfectionist/sort-named-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-named-imports': ['error', { type: 'natural' }],
      'perfectionist/sort-object-types': ['error', { type: 'natural' }],
      'perfectionist/sort-objects': ['error', { type: 'natural' }],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // Decorator metadata needs constructor-injected classes as runtime values: keep their
    // imports as values even where they look type-only.
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true } },
  },
  { files: ['src/config/**/*.ts'], rules: layer(['common', 'infrastructure', 'modules']) },
  { files: ['src/common/**/*.ts'], rules: layer(['infrastructure', 'modules']) },
  { files: ['src/infrastructure/**/*.ts'], rules: layer(['modules']) },
  { files: ['src/modules/**/*.ts'], rules: layer([]) },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
