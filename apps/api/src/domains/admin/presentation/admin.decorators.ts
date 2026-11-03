import { applyDecorators, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Auth } from '../../../core/security';

export type AdminContext = { adminId: string };

export const Admin = (): MethodDecorator => applyDecorators(Auth('ADMIN'));

export const AdminContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminContext => {
    const req = ctx.switchToHttp().getRequest<{ user?: { userId: string; role: string } }>();
    return { adminId: req.user?.userId ?? '' };
  },
);
