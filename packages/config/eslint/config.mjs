import { fileURLToPath } from 'node:url';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import boundary from './boundary-rules.mjs';

/** Root của monorepo — config ở packages/config/eslint/, nên tính lại từ vị trí file. */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Chặn import ngược / chéo tiến trình (kiến trúc feature-based, HANDBOOK §19).
 * Chiều "package → app" và "app ↔ app khác" là vi phạm luôn luôn — không có ngoại lệ.
 * ESLint 9.39+: `no-restricted-imports` nhận `[{ patterns: [{ group, message }] }]`.
 */
const NO_WORKSPACE_CROSS_IMPORT = (groups) => ({
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: groups.map((group) => ({
          group: [group],
          message:
            'Phá vỡ ranh giới workspace: chỉ được import thẳng đứng theo cây phụ thuộc package (xem HANDBOOK §19 và ADR-005).',
        })),
      },
    ],
  },
});

const WEB_WORKSPACE_GROUPS = ['@learn/api', '@learn/worker', '**/apps/api/*', '**/apps/worker/*'];

/** Cấm web import ngược lên tầng cao hơn; cộng thêm nhóm workspace để khỏi bị ghi đè. */
const NO_INWARD_IMPORT = (groups, message) => ({
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          ...WEB_WORKSPACE_GROUPS.map((group) => ({
            group: [group],
            message:
              'Phá vỡ ranh giới workspace: chỉ được import thẳng đứng theo cây phụ thuộc package (xem HANDBOOK §19 và ADR-005).',
          })),
          ...groups.map((group) => ({ group: [group], message })),
        ],
      },
    ],
  },
});

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repoRoot,
      },
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/generated/**',
      '**/next-env.d.ts',
      'apps/web/.next/**',
      'eslint.config.mjs',
      'packages/config/**',
      '**/.prettierrc.*',
      'vitest.config.ts',
      'vitest.int.config.ts',
      '**/*.config.*',
      // Mã vendor Blob Studio — nguồn gốc và bản chép vào app.
      // Xem docs/adr/006-mascot-dong-blob-studio.md
      'CircleMascot/**',
      'apps/web/src/components/shared/mascot/CircleAvatar.tsx',
      'docs/**',
      '.diag-edge.mjs',
      'scripts/**',
      'packages/contracts/scripts/**',
      '.github/**',
      'infra/**',
    ],
  },
  // Chỉ áp cho JSX của web app. Bắt các lỗi a11y tĩnh (thiếu alt, label không
  // gắn control, onClick trên thẻ không tương tác, aria sai) ngay lúc lint thay
  // vì để lọt tới vòng audit thủ công.
  {
    files: ['apps/web/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    plugins: { boundary },
    rules: {
      'boundary/no-cross-module-import': 'error',
      'boundary/no-cross-feature-import': [
        'error',
        {
          allow: {
            // `shell` là chrome của app (AppShell, UserMenu, PlanUsage) nên được đọc hook dữ
            // liệu của feature khác — `useAuth`/`useSubscription` —
            // không phải tái dùng UI nội bộ của chúng.
            shell: ['auth', 'settings'],
          },
        },
      ],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    ...NO_WORKSPACE_CROSS_IMPORT(['@learn/api', '@learn/web', '@learn/worker', '**/apps/*']),
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ...NO_WORKSPACE_CROSS_IMPORT([
      '@learn/web',
      '@learn/worker',
      '**/apps/web/*',
      '**/apps/worker/*',
    ]),
  },
  {
    files: ['apps/worker/src/**/*.ts'],
    ...NO_WORKSPACE_CROSS_IMPORT(['@learn/web', '@learn/api', '**/apps/web/*', '**/apps/api/*']),
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ...NO_WORKSPACE_CROSS_IMPORT(WEB_WORKSPACE_GROUPS),
  },
  // Chiều phụ thuộc trong web (Bulletproof React): lib/components → features → app, chỉ đi một chiều.
  // `no-restricted-imports` của khối sau ghi đè khối trước trên cùng file, nên mỗi vùng phải lặp lại
  // nhóm workspace ở trên.
  {
    files: ['apps/web/src/lib/**/*.{ts,tsx}'],
    ...NO_INWARD_IMPORT(
      ['@/features/*', '@/app/*', '@/components/*'],
      'lib/ là tầng thấp nhất: không import components/, features/ hay app/.',
    ),
  },
  {
    files: ['apps/web/src/components/**/*.{ts,tsx}'],
    ...NO_INWARD_IMPORT(
      ['@/features/*', '@/app/*'],
      'components/ dùng chung cho mọi feature: không import features/ hay app/.',
    ),
  },
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    ...NO_INWARD_IMPORT(
      ['@/app/*'],
      'features/ không import app/ (app/ chỉ ghép các feature lại).',
    ),
  },
);
