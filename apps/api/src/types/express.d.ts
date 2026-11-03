import type { UserContext } from '../core/security';

declare module 'express' {
  interface Request {
    requestId?: string;
    user?: UserContext;
    rawBody?: Buffer;
  }
}
