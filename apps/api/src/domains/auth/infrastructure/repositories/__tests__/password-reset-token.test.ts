import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  createResetToken,
  hashResetToken,
  isResetTokenUsable,
  resetLink,
} from '../password-reset-token';

describe('createResetToken', () => {
  it('token 256-bit dạng base64url, DB chỉ giữ SHA-256 của nó', () => {
    const { token, tokenHash } = createResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).not.toContain(token);
  });

  it('mỗi lần sinh một token khác', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createResetToken().token));
    expect(tokens.size).toBe(50);
  });

  it('hashResetToken khớp hash lúc tạo', () => {
    const { token, tokenHash } = createResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
  });
});

describe('isResetTokenUsable', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const later = new Date('2026-09-28T10:30:00Z');
  const earlier = new Date('2026-09-28T09:59:59Z');

  it('chưa dùng, còn hạn → dùng được', () => {
    expect(isResetTokenUsable({ usedAt: null, expiresAt: later }, now)).toBe(true);
  });

  it('đã dùng → không dùng lại được', () => {
    expect(isResetTokenUsable({ usedAt: earlier, expiresAt: later }, now)).toBe(false);
  });

  it('hết hạn → không dùng được, kể cả đúng mốc hết hạn', () => {
    expect(isResetTokenUsable({ usedAt: null, expiresAt: earlier }, now)).toBe(false);
    expect(isResetTokenUsable({ usedAt: null, expiresAt: now }, now)).toBe(false);
  });

  it('không có bản ghi → không dùng được', () => {
    expect(isResetTokenUsable(null, now)).toBe(false);
  });
});

describe('resetLink', () => {
  it('token nằm ở fragment (#), không ở query — không lọt vào log máy chủ web hay Referer', () => {
    const link = resetLink('http://localhost:3000', 'abc_-123');
    expect(link).toBe('http://localhost:3000/reset-password#token=abc_-123');
  });

  it('APP_URL có dấu / cuối vẫn ra đường dẫn đúng', () => {
    expect(resetLink('https://learn.ai/', 't')).toBe('https://learn.ai/reset-password#token=t');
  });
});
