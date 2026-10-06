export function ok(res, data, message = 'OK', status = 200, meta) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export function created(res, data, message = 'Created') {
  return ok(res, data, message, 201);
}

export function paginationMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
