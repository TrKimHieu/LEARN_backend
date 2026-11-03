import { createHash, randomBytes } from 'crypto';

/**
 * Token ─æß║╖t lß║íi mß║¡t khß║⌐u ΓÇö FR-AUTH-07. H├ám thuß║ºn, test ─æ╞░ß╗úc kh├┤ng cß║ºn DB.
 *
 * C├╣ng m├┤ h├¼nh vß╗¢i refresh token (NFR-SEC-03): 256-bit ngß║½u nhi├¬n, DB chß╗ë giß╗» SHA-256. Lß╗Ö bß║úng
 * `PasswordResetToken` kh├┤ng cho ai ─æß║╖t lß║íi ─æ╞░ß╗úc mß║¡t khß║⌐u cß╗ºa ng╞░ß╗¥i kh├íc.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function isResetTokenUsable(
  record: { usedAt: Date | null; expiresAt: Date } | null,
  now: Date = new Date(),
): boolean {
  return record !== null && record.usedAt === null && record.expiresAt.getTime() > now.getTime();
}

/**
 * ─É╞░ß╗¥ng dß║½n trong th╞░. Token ─æß║╖t ß╗ƒ **fragment** (`#token=`) chß╗⌐ kh├┤ng ß╗ƒ query: fragment kh├┤ng
 * bao giß╗¥ ─æ╞░ß╗úc tr├¼nh duyß╗çt gß╗¡i l├¬n m├íy chß╗º, n├¬n kh├┤ng lß╗ìt v├áo access log cß╗ºa web server, proxy
 * hay header `Referer` khi trang ─æß║╖t lß║íi mß║¡t khß║⌐u tß║úi t├ái nguy├¬n b├¬n ngo├ái.
 */
export function resetLink(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/reset-password#token=${token}`;
}
