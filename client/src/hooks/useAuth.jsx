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
      queryClient.clear();
      queryClient.setQueryData(['auth', 'me'], res.data.user);
      return res.data.user;
    },
    [queryClient],
  );

  const register = useCallback(
    async (body) => {
      const res = await authApi.register(body);
      queryClient.clear();
      queryClient.setQueryData(['auth', 'me'], res.data.user);
      return res.data.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      queryClient.setQueryData(['auth', 'me'], null);
    }
  }, [queryClient]);

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
