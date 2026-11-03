/**
 * @learn/contracts — Zod schemas dùng chung giữa apps/api, apps/worker, apps/web.
 * Một schema duy nhất: validate request ở API, suy ra kiểu ở frontend, validate output LLM ở worker.
 */
export * from './common';
export * from './auth';
export * from './course';
export * from './document';
export * from './document-types';
export * from './lesson';
export * from './exercise';
export * from './progress';
export * from './subscription';
export * from './ai';
export * from './admin';
export * from './meta';
export * from './version';
