import type { ArgumentsHost, ExceptionFilter, PipeTransform } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import type { Response } from 'express';
import type { ZodType } from 'zod';
import type { ErrorCode } from '@learn/contracts';
import { requestIdSchema, ERROR_CODES } from '@learn/contracts';

/** Pipe: validate body bằng Zod. Lỗi → VALIDATION_FAILED kèm meta.fields. */
export class ZodBodyPipe<T extends ZodType> implements PipeTransform<unknown, T['_output']> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): T['_output'] {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.issues.map((i) => [i.path.join('.'), i.message]),
      );
      throw new ApiError(400, 'VALIDATION_FAILED', 'Dữ liệu gửi lên không hợp lệ.', { fields });
    }
    return result.data;
  }
}

/** Pipe: validate tham số đường dẫn (id ...) bằng Zod */
export class ZodParamPipe<T extends ZodType> implements PipeTransform<unknown, T['_output']> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): T['_output'] {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Tham số không hợp lệ.');
    }
    return result.data;
  }
}

// Thuận tiện dùng trong decorator: @Body(new zodBody(schema))
export const zodBody = <T extends ZodType>(schema: T): ZodBodyPipe<T> => new ZodBodyPipe(schema);
export const zodParam = <T extends ZodType>(schema: T): ZodParamPipe<T> => new ZodParamPipe(schema);

/** Lỗi nghiệp vụ có `code` ổn định — HANDBOOK §7.3. Không so khớp bằng `detail`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, detail: string, meta?: Record<string, unknown>) {
    super(detail);
    this.status = status;
    this.code = code;
    this.meta = meta;
  }

  static notFound(detail = 'Không tìm thấy tài nguyên.') {
    return new ApiError(404, 'NOT_FOUND', detail);
  }

  static forbidden(detail = 'Không có quyền truy cập tài nguyên này.') {
    return new ApiError(403, 'FORBIDDEN', detail);
  }

  static unauthenticated(detail = 'Chưa đăng nhập hoặc phiên hết hạn.') {
    return new ApiError(401, 'UNAUTHENTICATED', detail);
  }

  static conflict(detail = 'Xung đột trạng thái dữ liệu.') {
    return new ApiError(409, 'CONFLICT', detail);
  }

  static badRequest(detail = 'Yêu cầu không hợp lệ.') {
    return new ApiError(400, 'VALIDATION_FAILED', detail);
  }

  static quota(limit: number, used: number, metric: string) {
    return new ApiError(402, 'QUOTA_EXCEEDED', `Đã vượt hạn mức ${metric}.`, {
      metric,
      limit,
      used,
    });
  }

  static payloadTooLarge(detail = 'Dữ liệu gửi lên vượt giới hạn cho phép.') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', detail);
  }

  static unsupportedFile(reason?: string) {
    return new ApiError(
      415,
      'UNSUPPORTED_FILE_TYPE',
      reason ? `Loại file không được hỗ trợ. ${reason}` : 'Loại file không được hỗ trợ.',
    );
  }
}

export { requestIdSchema };

/**
 * `type` của RFC 7807 là **định danh máy đọc** — client so khớp nó y như `code`.
 * Suy ra từ `code` ở đúng một chỗ để hai nhánh của filter không thể lệch nhau
 * (trước đây nhánh fallback hardcode `internal-error`, nên 401/403/429 đều tự
 * khai sai loại lỗi trong khi `code` lại đúng).
 */
export const problemType = (code: ErrorCode): string =>
  `https://learn.ai/errors/${code.toLowerCase()}`;

/** Mã lỗi Prisma đã biết → (status, code, thông điệp cho người dùng). */
const PRISMA_ERRORS: Record<string, { status: number; code: ErrorCode; detail: string }> = {
  // Vi phạm ràng buộc unique — hai request ghi cùng một khoá trong cùng khoảnh khắc.
  P2002: { status: 409, code: 'CONFLICT', detail: 'Dữ liệu đã tồn tại hoặc vừa bị ghi trùng.' },
  // Cập nhật/xoá một bản ghi không còn tồn tại.
  P2025: { status: 404, code: 'NOT_FOUND', detail: 'Không tìm thấy tài nguyên.' },
  // Khoá ngoại trỏ tới bản ghi không tồn tại.
  P2003: { status: 409, code: 'CONFLICT', detail: 'Tham chiếu tới dữ liệu không tồn tại.' },
  // Transaction tương tác vượt quá thời gian cho phép.
  P2028: { status: 409, code: 'CONFLICT', detail: 'Thao tác quá lâu, vui lòng thử lại.' },
};

/** Kết quả chuẩn hoá của một exception bất kỳ. */
export interface NormalizedError {
  status: number;
  code: ErrorCode;
  detail: string;
  meta?: Record<string, unknown>;
}

/**
 * Mọi loại exception → một hình dạng duy nhất.
 * Hàm thuần, tách khỏi filter để unit-test được mà không cần dựng HTTP context.
 */
export function normalizeException(exception: unknown): NormalizedError {
  if (exception instanceof ApiError) {
    return {
      status: exception.status,
      code: exception.code,
      detail: exception.message,
      meta: exception.meta,
    };
  }

  const prisma = prismaError(exception);
  if (prisma) return prisma;

  const status = httpStatusOf(exception);
  const code = errorCodeOf(exception, status);
  return {
    status,
    code,
    detail:
      status >= 500
        ? 'Có lỗi xảy ra. Vui lòng thử lại sau.'
        : String((exception as Error)?.message ?? 'Yêu cầu không hợp lệ'),
  };
}

/**
 * Lỗi Prisma lọt tới đây trước đây đều thành `500 INTERNAL_ERROR`, vì `code` của chúng
 * (`P2002`…) là chuỗi nhưng không nằm trong `ERROR_CODES`. Hệ quả thật: người dùng bấm
 * "Nộp bài" hai lần thì đụng `@@unique([userId, exerciseId, attemptNo])` và nhận
 * "Có lỗi xảy ra" thay vì 409 — client không phân biệt được để tự thử lại.
 */
function prismaError(exception: unknown): NormalizedError | null {
  if (!exception || typeof exception !== 'object') return null;
  if ((exception as { name?: unknown }).name !== 'PrismaClientKnownRequestError') return null;
  const raw = (exception as { code?: unknown }).code;
  if (typeof raw !== 'string') return null;
  return PRISMA_ERRORS[raw] ?? null;
}

function httpStatusOf(exception: unknown): number {
  if (exception && typeof exception === 'object' && 'status' in exception) {
    const status = (exception as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 600) return status;
  }
  return 500;
}

function errorCodeOf(exception: unknown, status: number): ErrorCode {
  if (exception && typeof exception === 'object' && 'code' in exception) {
    const code = (exception as { code?: unknown }).code;
    if (typeof code === 'string' && ERROR_CODES.includes(code as ErrorCode))
      return code as ErrorCode;
  }
  const byStatus: Record<number, ErrorCode> = {
    400: 'VALIDATION_FAILED',
    401: 'UNAUTHENTICATED',
    402: 'QUOTA_EXCEEDED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_FILE_TYPE',
    429: 'RATE_LIMITED',
  };
  return byStatus[status] ?? 'INTERNAL_ERROR';
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId =
      (host.switchToHttp().getRequest() as { requestId?: string }).requestId ?? 'unknown';

    const { status, code, detail, meta } = normalizeException(exception);

    if (status >= 500) {
      // Stack trace chỉ vào log, không bao giờ ra client.
      console.error(`[${requestId}] ${code}`, exception);
    }

    res.status(status).json({
      type: problemType(code),
      title: 'Lỗi xử lý yêu cầu',
      status,
      code,
      detail,
      requestId,
      ...(meta ? { meta } : {}),
    });
  }
}
