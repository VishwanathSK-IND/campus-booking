import axios from 'axios';

const baseURL = `${import.meta.env.VITE_API_URL || ''}/api`;

/** Axios instance: cookies (HttpOnly JWT) are sent automatically; tokens never touch JS. */
export const http = axios.create({ baseURL, withCredentials: true, timeout: 20000 });

/** Normalised error thrown by every API call: { status, code, message, details }. */
export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      return Promise.reject(
        new ApiError({
          status,
          code: data?.code || 'HTTP_ERROR',
          message: data?.message || `Request failed (${status})`,
          details: data?.details,
        }),
      );
    }
    return Promise.reject(
      new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Cannot reach the server. Check your connection and try again.',
      }),
    );
  },
);

/** Returns the full envelope { data, meta, message } for paginated endpoints. */
export async function request(config) {
  const { data } = await http.request(config);
  return data;
}

/** Returns only the `data` field. */
export async function get(url, params) {
  return (await request({ method: 'get', url, params })).data;
}

export async function send(method, url, body, headers) {
  return request({ method, url, data: body, headers });
}
