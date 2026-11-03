import { z } from 'zod';

export const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(72),
  displayName: z.string().min(2).max(100),
  locale: z.enum(['vi', 'en']).default('vi'),
});

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(72),
});

export const patchMeSchema = z
  .object({
    displayName: z.string().min(2).max(100).optional(),
    locale: z.enum(['vi', 'en']).optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: z.string().min(8).max(72),
  })
  .strict();

/** FR-AUTH-07 — bước 1: xin thư đặt lại mật khẩu. Luôn trả 200, không lộ email có tồn tại. */
export const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  })
  .strict();

/** FR-AUTH-07 — bước 2: đặt mật khẩu mới bằng token trong thư. */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    newPassword: z.string().min(8).max(72),
  })
  .strict();

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(['LEARNER', 'ADMIN']),
  locale: z.enum(['vi', 'en']),
  emailVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const authResponseSchema = z.object({
  user: userPublicSchema,
  accessToken: z.string(),
});

export const meResponseSchema = z.object({
  user: userPublicSchema,
  plan: z.object({ code: z.string(), name: z.string() }),
  usage: z.record(z.string(), z.unknown()),
});

/**
 * Client native (app mobile — ADR 016). Không có cookie httpOnly, nên refresh token đi qua body
 * và client tự cất vào kho khoá của hệ điều hành (Keychain/Keystore). Chỉ bật khi request mang
 * header này; ở chế độ native server **không bao giờ đọc cookie**, nên một script trên trang web
 * đặt header này cũng không đổi được cookie của trình duyệt thành refresh token đọc được.
 */
export const CLIENT_HEADER = 'x-learn-client';
export const NATIVE_CLIENT = 'native';

/** Body của `/auth/refresh` và `/auth/logout` ở chế độ native. */
export const nativeRefreshSchema = z
  .object({
    refreshToken: z.string().min(20).max(200),
  })
  .strict();

export const nativeAuthResponseSchema = authResponseSchema.extend({
  refreshToken: z.string(),
});

export type NativeRefreshInput = z.infer<typeof nativeRefreshSchema>;
export type NativeAuthResponse = z.infer<typeof nativeAuthResponseSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PatchMeInput = z.infer<typeof patchMeSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
