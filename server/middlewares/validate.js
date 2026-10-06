import mongoose from 'mongoose';
import { AppError, badRequest } from '../utils/AppError.js';

function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Validates and coerces request parts with zod schemas. Parsed values are
 * exposed on req.valid.{body,query,params} (Express 5 makes req.query read-only).
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = formatIssues(result.error);
        const first = details[0];
        const message = first?.field ? `${first.field}: ${first.message}` : first?.message || 'Invalid request';
        return next(new AppError(400, 'VALIDATION_ERROR', message, details));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

export function validateObjectId(...paramNames) {
  return (req, _res, next) => {
    for (const name of paramNames) {
      if (!mongoose.isValidObjectId(req.params[name]) || !/^[a-f\d]{24}$/i.test(req.params[name])) {
        return next(badRequest('INVALID_ID', `Invalid ${name}`));
      }
    }
    next();
  };
}
