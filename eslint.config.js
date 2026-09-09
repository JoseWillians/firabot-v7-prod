import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'auth/**',
      'backups/**',
      'dist/**',
      'documentos/**',
      'logs/**',
      'node_modules/**'
    ]
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.nodeBuiltin
    }
  },
  js.configs.recommended,
  ...tseslint.configs.recommended
)
