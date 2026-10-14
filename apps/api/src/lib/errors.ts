import type { ErrorCode } from '@manxin/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function fail(statusCode: number, code: ErrorCode, message: string, details?: unknown): never {
  throw new AppError(statusCode, code, message, details);
}

export function notFound(what = '找不到'): never {
  return fail(404, 'NOT_FOUND', what);
}
