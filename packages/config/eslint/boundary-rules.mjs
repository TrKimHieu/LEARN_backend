/**
 * Quy tắc ranh giới cho kiến trúc feature-based (HANDBOOK §19 + ADR-005).
 *
 * Hai ranh giới bắt buộc:
 *  1. `apps/api/src/domains/<A>/**` không được import file nội bộ của domain khác
 *     `apps/api/src/domains/<B>/**` (A ≠ B). Ngoại lệ duy nhất là các file được
 *     domain export làm "cổng chính thức": `<name>.module.ts`, `<name>.repository.ts`,
 *     `<name>.service.ts`. DTO/controller/internal phải nằm gọn trong domain.
 *  2. `apps/web/src/features/<A>/**` không được import `features/<B>` (A ≠ B).
 *     Ngoại lệ khai báo qua option `allow` (VD: `shell` là chrome của app nên được
 *     phép đọc `auth`/`settings`; landing `portfolio` tái dùng `LogoMark` ở `shell`).
 *
 * Chiều ngược (package → app, app chéo app) được chặn bằng `no-restricted-imports`
 * cấu hình trong config.mjs, không nằm trong plugin này.
 */
import path from 'node:path';

const MODULE_DIR = 'apps/api/src/domains';
const FEATURE_DIR = 'apps/web/src/features';

/** Tên file đích còn nguyên (chưa nối đuôi) — mẫu cho phép khi vượt ranh giới module. */
const ALLOWED_MODULE_SURFACE = /\.(module|repository|service)(?:\.ts)?$/;

const schema = [
  {
    type: 'object',
    properties: {
      allow: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    additionalProperties: false,
  },
];

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

/** Giải tên module/feature chứa đường dẫn (vị trí đứng trước `/` đầu tiên sau dir). */
function boundaryOf(dir) {
  return new RegExp(`${dir}/([^/]+)/`);
}

function crossBoundaryRule({ kind, dir, allowFileSurface }) {
  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Cấm import chéo giữa các ${kind} (kiến trúc feature-based).`,
        category: 'Best Practices',
      },
      schema,
      messages: {
        cross:
          `Phá vỡ ranh giới ${kind}: "{{self}}" đang import "${dir}" của "{{other}}". ` +
          (allowFileSurface
            ? 'Chỉ được import file export chính thức (*.module.ts, *.repository.ts, *.service.ts).'
            : 'Đưa dùng chung lên components/shared hoặc thêm allowlist có lý do.'),
      },
    },
    create(context) {
      const filename = toPosix(context.filename ?? context.getFilename());
      const rel = toPosix(path.relative(context.cwd, filename));
      const boundary = boundaryOf(dir);
      const self = boundary.exec(rel)?.[1];
      const options = context.options[0] ?? {};
      const allow = options.allow ?? {};

      if (!self) return {};

      function resolveSpecifier(spec) {
        if (spec.startsWith('.')) {
          const base = path.posix.dirname(rel);
          return path.posix.normalize(path.posix.join(base, spec));
        }
        if (spec.startsWith('@/')) {
          return path.posix.normalize(`apps/web/src/${spec.slice(2)}`);
        }
        return null;
      }

      function checkSource(node, spec) {
        const resolved = resolveSpecifier(spec);
        if (!resolved) return;

        const other = boundary.exec(resolved)?.[1];
        if (!other || other === self) return;

        if (allow[self]?.includes(other)) return;
        if (allowFileSurface && ALLOWED_MODULE_SURFACE.test(resolved)) return;

        context.report({
          node,
          messageId: 'cross',
          data: { kind, dir, self, other },
        });
      }

      return {
        ImportDeclaration(node) {
          checkSource(node, node.source.value);
        },
        ExportNamedDeclaration(node) {
          if (node.source) checkSource(node, node.source.value);
        },
        ExportAllDeclaration(node) {
          checkSource(node, node.source.value);
        },
        ImportExpression(node) {
          const source = node.source;
          if (source?.type === 'Literal' && typeof source.value === 'string') {
            checkSource(node, source.value);
          }
        },
      };
    },
  };
}

export default {
  rules: {
    'no-cross-module-import': crossBoundaryRule({
      kind: 'module',
      dir: MODULE_DIR,
      allowFileSurface: true,
    }),
    'no-cross-feature-import': crossBoundaryRule({
      kind: 'feature',
      dir: FEATURE_DIR,
      allowFileSurface: false,
    }),
  },
};
