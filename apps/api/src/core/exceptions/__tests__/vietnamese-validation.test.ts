import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerSchema } from '@learn/contracts';
import { requireTrimmedText, vietnameseIssueMessage, zodBody, type ApiError } from '../errors';

describe('vietnameseIssueMessage', () => {
  const messageOf = (schema: z.ZodType, value: unknown) => {
    const result = schema.safeParse(value, { error: vietnameseIssueMessage });
    return result.success ? null : result.error.issues[0]?.message;
  };

  it.each([
    [z.string().min(8), 'abc', 'Cần ít nhất 8 ký tự.'],
    [z.string().min(1), '', 'Không được để trống.'],
    [z.string().max(3), 'abcd', 'Tối đa 3 ký tự.'],
    [z.email(), 'sai', 'Email không hợp lệ.'],
    [z.string(), undefined, 'Không được để trống.'],
    [z.number(), 'x', 'Giá trị không hợp lệ.'],
  ])('dịch lỗi sang tiếng Việt: %#', (schema, value, expected) => {
    expect(messageOf(schema, value)).toBe(expected);
  });
});

describe('zodBody', () => {
  it('trả thông báo tiếng Việt theo từng ô', () => {
    expect.assertions(1);
    try {
      zodBody(registerSchema).transform({ email: 'sai', password: '1', displayName: 'A' });
    } catch (err) {
      expect((err as ApiError).meta).toEqual({
        fields: {
          email: 'Email không hợp lệ.',
          password: 'Cần ít nhất 8 ký tự.',
          displayName: 'Cần ít nhất 2 ký tự.',
        },
      });
    }
  });
});

describe('requireTrimmedText', () => {
  it('bỏ khoảng trắng hai đầu', () => {
    expect(requireTrimmedText('  Mạng máy tính  ', 'title', 1, 'Thiếu tên.')).toBe('Mạng máy tính');
  });

  it.each(['', '   ', '\t\n'])('chỉ có khoảng trắng thì báo lỗi đúng ô: %j', (value) => {
    expect.assertions(2);
    try {
      requireTrimmedText(value, 'title', 1, 'Thiếu tên.');
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).meta).toEqual({ fields: { title: 'Thiếu tên.' } });
    }
  });

  it('kiểm tra độ dài sau khi đã bỏ khoảng trắng', () => {
    expect(() => requireTrimmedText(' A ', 'displayName', 2, 'Tên quá ngắn.')).toThrow();
  });
});
