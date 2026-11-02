import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [{
  files: ['src/**/*.{js,jsx}'],
  plugins: { 'react-hooks': reactHooks },
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'no-undef': 'error',
    'no-debugger': 'error',
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unexpected-multiline': 'error'
  }
}];
