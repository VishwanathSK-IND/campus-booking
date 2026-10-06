import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (!(error instanceof AppError)) {
    if (err?.type === 'entity.too.large') {
      error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else if (err?.type === 'entity.parse.failed') {
      error = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    } else if (err?.name === 'CastError') {
      error = new AppError(400, 'INVALID_ID', `Invalid value for ${err.path}`);
    } else if (err?.name === 'ValidationError') {
      const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
      error = new AppError(400, 'VALIDATION_ERROR', details[0]?.message || 'Invalid data', details);
    } else if (err?.code === 11000) {
      error = new AppError(409, 'DUPLICATE', 'A record with these details already exists');
    } else {
      logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
      error = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
    }
  }

  const body = { success: false, message: error.message, code: error.code };
  if (error.details) body.details = error.details;
  res.status(error.status).json(body);
}
