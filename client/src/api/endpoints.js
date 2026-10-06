import { get, request, send } from './client.js';

const clean = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const authApi = {
  me: () => get('/auth/me'),
  login: (body) => send('post', '/auth/login', body),
  register: (body) => send('post', '/auth/register', body),
  logout: () => send('post', '/auth/logout'),
};

export const resourceApi = {
  list: (params) => request({ url: '/resources', params: clean(params) }),
  locations: () => get('/resources/locations'),
  get: (id) => get(`/resources/${id}`),
  availability: (id, date) => get(`/resources/${id}/availability`, { date }),
  create: (body) => send('post', '/resources', body),
  update: (id, body) => send('patch', `/resources/${id}`, body),
  setStatus: (id, body) => send('patch', `/resources/${id}/status`, body),
  addBlock: (id, body) => send('post', `/resources/${id}/blocks`, body),
  removeBlock: (id, blockId) => send('delete', `/resources/${id}/blocks/${blockId}`),
  checkInToken: (id) => get(`/resources/${id}/check-in-token`),
};

export const bookingApi = {
  create: (body, idempotencyKey) => send('post', '/bookings', body, { 'Idempotency-Key': idempotencyKey }),
  mine: (params) => request({ url: '/bookings', params: clean(params) }),
  get: (id) => get(`/bookings/${id}`),
  pendingApprovals: (params) => request({ url: '/bookings/pending-approvals', params: clean(params) }),
  checkInCandidates: (resource) => get('/bookings/check-in-candidates', { resource }),
  approve: (id, body) => send('post', `/bookings/${id}/approve`, body),
  reject: (id, body) => send('post', `/bookings/${id}/reject`, body),
  cancel: (id, body) => send('post', `/bookings/${id}/cancel`, body),
  checkIn: (id, token) => send('post', `/bookings/${id}/check-in`, { token }),
};

export const waitlistApi = {
  join: (body) => send('post', '/waitlists', body),
  mine: (params) => request({ url: '/waitlists', params: clean(params) }),
  accept: (id) => send('post', `/waitlists/${id}/accept`),
  decline: (id) => send('post', `/waitlists/${id}/decline`),
  leave: (id) => send('delete', `/waitlists/${id}`),
};

export const notificationApi = {
  list: (params) => request({ url: '/notifications', params: clean(params) }),
  unreadCount: () => get('/notifications/unread-count'),
  markRead: (id) => send('patch', `/notifications/${id}/read`),
  markAllRead: () => send('post', '/notifications/read-all'),
};

export const userApi = {
  standing: () => get('/users/me/standing'),
  updateProfile: (body) => send('patch', '/users/me', body),
  approvers: () => get('/users/approvers'),
};

export const adminApi = {
  dashboard: () => get('/admin/dashboard'),
  analytics: (params) => get('/admin/analytics', clean(params)),
  users: (params) => request({ url: '/admin/users', params: clean(params) }),
  user: (id) => get(`/admin/users/${id}`),
  createUser: (body) => send('post', '/admin/users', body),
  updateUser: (id, body) => send('patch', `/admin/users/${id}`, body),
  restrict: (id, body) => send('post', `/admin/users/${id}/restrictions`, body),
  liftRestriction: (id, body) => send('post', `/admin/restrictions/${id}/lift`, body),
  bookings: (params) => request({ url: '/admin/bookings', params: clean(params) }),
  policy: () => get('/admin/policy'),
  savePolicy: (body) => send('put', '/admin/policy', body),
  auditLogs: (params) => request({ url: '/admin/audit-logs', params: clean(params) }),
  runJobs: () => send('post', '/admin/jobs/run'),
};
