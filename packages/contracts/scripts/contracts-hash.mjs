/**
 * Dấu vân tay của `@learn/contracts` → `src/version.ts` (`CONTRACTS_HASH`).
 *
 * API trả hash này ở `GET /api/v1/meta`; app mobile (repo riêng, chép contracts bằng
 * `npm run sync:contracts`) mang theo hash lúc chép — hai số khác nhau nghĩa là app đang dùng
 * schema cũ hơn máy chủ. Test `version.test.ts` gọi `--check` để CI bắt quên chạy lại script.
 *
 *   node packages/contracts/scripts/contracts-hash.mjs          # ghi lại version.ts
 *   node packages/contracts/scripts/contracts-hash.mjs --check  # lệch thì exit 1
 *
 * Chuẩn hoá xuống dòng về LF trước khi băm: checkout Windows (CRLF) và CI Linux phải ra cùng số.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const VERSION_FILE = 'version.ts';

export function contractsHash() {
  const hash = createHash('sha256');
  const files = readdirSync(src)
    .filter((f) => f.endsWith('.ts') && f !== VERSION_FILE)
    .sort();
  for (const f of files) {
    hash.update(f);
    hash.update('\0');
    hash.update(readFileSync(join(src, f), 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

const body = (h) =>
  `/**\n * Dấu vân tay nội dung contracts — SINH bởi \`scripts/contracts-hash.mjs\`, không sửa tay.\n` +
  ` * Đổi bất kỳ file nào trong \`src/\` thì chạy lại script (test \`version.test.ts\` sẽ nhắc).\n */\n` +
  `export const CONTRACTS_HASH = '${h}';\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const h = contractsHash();
  const file = join(src, VERSION_FILE);
  let current = '';
  try {
    current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // chưa có file
  }
  if (process.argv.includes('--check')) {
    if (current !== body(h)) {
      console.error(
        `[contracts] version.ts lệch (hash hiện tại ${h}). Chạy: npm run contracts:hash`,
      );
      process.exit(1);
    }
    console.log(`[contracts] hash ${h} khớp.`);
  } else {
    writeFileSync(file, body(h));
    console.log(`[contracts] CONTRACTS_HASH = ${h}`);
  }
}
