import type { ExecutionContext, CanActivate } from '@nestjs/common';
import {
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { Request } from 'express';
import { RedisService } from '../infra/services';
import { AuditRepository } from '../infra/audit/audit.repository';
import { env } from '../environment';

export interface AccessTokenPayload {
  sub: string;
  role: 'LEARNER' | 'ADMIN';
  email: string;
}

export interface UserContext {
  userId: string;
  role: 'LEARNER' | 'ADMIN';
}

// `env` đã hợp nhất `process.env` với default rồi, nên đọc thẳng từ đó — nhánh
// `isProd ? … : process.env.… ?? …` trước đây cho ra đúng cùng một giá trị ở cả hai vế.
const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

const JWT_ALG = 'HS256' as const;
const ROLES = new Set(['LEARNER', 'ADMIN']);

@Injectable()
export class SecurityService {
  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return new SignJWT({ role: payload.role, email: payload.email })
      .setProtectedHeader({ alg: JWT_ALG })
      .setSubject(payload.sub)
      .setIssuedAt()
      .setExpirationTime(env.JWT_ACCESS_TTL)
      .sign(secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      // Ghim thuật toán: không để header `alg` của token tự chọn cách xác minh.
      const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALG] });
      if (!payload.sub) return null;
      // `role` đến từ payload do client gửi lên. Chữ ký đã đảm bảo không bị sửa, nhưng
      // vẫn phải là một trong hai giá trị hợp lệ — token cũ/dị dạng không được mặc nhiên
      // rơi về 'LEARNER' rồi đi tiếp như một phiên hợp lệ.
      const role = payload.role;
      if (typeof role !== 'string' || !ROLES.has(role)) return null;
      return {
        sub: payload.sub,
        role: role as AccessTokenPayload['role'],
        email: typeof payload.email === 'string' ? payload.email : '',
      };
    } catch {
      return null;
    }
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Array<'LEARNER' | 'ADMIN'>): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);

export const THROTTLE_KEY = 'throttle';
export const Throttle = (limit: number, ttlSeconds: number): MethodDecorator =>
  SetMetadata(THROTTLE_KEY, { limit, ttlSeconds });

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: UserContext }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw SecurityError.unauth();
    const token = header.slice('Bearer '.length);
    const payload = await this.security.verifyAccessToken(token);
    if (!payload) throw SecurityError.unauth();
    req.user = { userId: payload.sub, role: payload.role };
    return true;
  }
}

export class SecurityError extends Error {
  status = 401;
  code = 'UNAUTHENTICATED' as const;
  static unauth(): SecurityError {
    const e = new SecurityError('Chưa đăng nhập hoặc phiên hết hạn.');
    return e;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const required = Reflect.getMetadata(ROLES_KEY, context.getHandler()) as
      Array<'LEARNER' | 'ADMIN'> | undefined;
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest<Request & { user?: UserContext }>().user;
    if (!user) throw SecurityError.unauth();
    if (!required.includes(user.role)) {
      const err = new Error('Không có quyền thực hiện thao tác này.');
      Object.assign(err, { status: 403, code: 'FORBIDDEN' });
      throw err;
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserContext => {
    const user = ctx.switchToHttp().getRequest<Request & { user?: UserContext }>().user;
    if (!user) throw SecurityError.unauth();
    return user;
  },
);

export const Auth = (...roles: Array<'LEARNER' | 'ADMIN'>): MethodDecorator =>
  applyDecorators(UseGuards(AuthGuard, RolesGuard), Roles(...roles));

// ─── Rate limit ────────────────────────────────────────────────────────

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = Reflect.getMetadata(THROTTLE_KEY, context.getHandler()) as
      { limit: number; ttlSeconds: number } | undefined;
    if (!meta) return true;
    const req = context.switchToHttp().getRequest<Request & { user?: UserContext }>();
    const keyBase = req.user?.userId ?? req.ip ?? 'anon';
    const route =
      context.switchToHttp().getRequest<{ route?: { path?: string } }>().route?.path ?? 'x';
    const key = `rl:${keyBase}:${route}`;
    const current = await this.redis.incrWithTtl(key, meta.ttlSeconds);
    if (current > meta.limit) {
      const err = new Error('Quá nhiều yêu cầu. Vui lòng thử lại sau giây lát.');
      Object.assign(err, { status: 429, code: 'RATE_LIMITED' });
      throw err;
    }
    return true;
  }
}

// ─── Audit log ─────────────────────────────────────────────────────────

@Injectable()
export class AuditService {
  // `await import('@learn/db')` nằm trong đường xử lý request là thừa — module đã nằm sẵn trong
  // bộ nhớ từ lúc boot, và việc import động khiến chỗ này là nơi duy nhất trong repo không lấy
  // Prisma qua DI, nên test không thay thế được.
  constructor(private readonly audit: AuditRepository) {}

  async log(input: {
    actorId?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: unknown;
    ipAddress?: string;
  }): Promise<void> {
    await this.audit.create(input);
  }
}

export { RedisService };
