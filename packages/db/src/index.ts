import { PrismaClient } from '../generated/client';
import { uuidv7 } from 'uuidv7';
import { hash, verify } from '@node-rs/argon2';

// DATABASE_URL mặc định cho dev (giá trị trùng infra/docker-compose); prod phải set thật.
if (!process.env.DATABASE_URL)
  process.env.DATABASE_URL = 'postgresql://learn:learn@localhost:5432/learn?schema=public';

/**
 * Một thể hiện PrismaClient duy nhất cho toàn bộ tiến trình (api hoặc worker).
 * `newId()` sinh UUID v7 — sắp xếp được theo thời gian, tránh phân mảnh B-tree. `[QĐ]`
 */
export const prisma = new PrismaClient();

export const newId = (): string => uuidv7();

export const hashPassword = (password: string): Promise<string> =>
  // argon2id với tham số HANDBOOK §10.1: memoryCost=19456, timeCost=2, parallelism=1
  hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  verify(hash, password);

export { PrismaClient, Prisma } from '../generated/client';
export * from '../generated/client';
