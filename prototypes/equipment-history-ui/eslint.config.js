// 장비이력카드 UI 프로토타입 전용 ESLint 설정.
// 루트 설정은 이 폴더를 globalIgnores로 제외하므로, 본앱과 동일한 규칙을 여기서 독립 실행한다.
// 실행: npm run lint --prefix prototypes/equipment-history-ui
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dev-server.log']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    // 프로토타입 셸 전용 파일: 진입점(main.jsx)과 useDialog 셰임(dialog.jsx)은
    // 컴포넌트+훅 혼합 export 구조가 의도된 것이므로 fast-refresh 규칙을 예외 처리한다.
    files: ['src/main.jsx', 'src/dialog.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
