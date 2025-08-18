module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error'
  },
  ignorePatterns: [
    'node_modules/',
    'cdk.out/',
    'coverage/',
    '*.min.js'
  ],
  overrides: [
    {
      files: ['tests/**/*.js'],
      rules: {
        'no-console': 'off'
      }
    }
  ]
};