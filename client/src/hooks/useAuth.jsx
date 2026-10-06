import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

/**
 * Session state comes from GET /api/auth/me (cookie-based). The role is used
 * only to shape the UI; every permission is enforced again by the API.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  /**
   * Switches the session user. Only the *other* cached queries are removed:
   * queryClient.clear() would also drop the ['auth','me'] query that this
   * provider's useQuery is subscribed to, so the new user would never reach
   * the UI and route guards would bounce back to /login.
   */
  const setSessionUser = useCallback(
    (user) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      queryClient.setQueryData(['auth', 'me'], user);
    },
    [queryClient],
  );

  const { data, isPending } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return (await authApi.me()).user;
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: (count, error) => error?.status !== 401 && count < 2,
  });

  const login = useCallback(
    async (credentials) => {
      const res = await authApi.login(credentials);
      setSessionUser(res.data.user);
      return res.data.user;
    },
    [setSessionUser],
  );

  const register = useCallback(
    async (body) => {
      const res = await authApi.register(body);
      setSessionUser(res.data.user);
      return res.data.user;
    },
    [setSessionUser],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSessionUser(null);
    }
  }, [setSessionUser]);

  const value = useMemo(
    () => ({
      user: data ?? null,
      loading: isPending,
      login,
      register,
      logout,
      hasRole: (...roles) => Boolean(data && roles.includes(data.role)),
    }),
    [data, isPending, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
