/**
 * Operational error with an HTTP status and a stable machine-readable code.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action', code = 'FORBIDDEN') =>
  new AppError(403, code, message);
export const notFound = (what = 'Resource', code = 'NOT_FOUND') =>
  new AppError(404, code, `${what} not found`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
