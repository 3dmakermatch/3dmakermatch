import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, setAccessToken } from '../lib/api';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  printer?: { id: string; isVerified: boolean; averageRating: number } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, role: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const data = await api<User>('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Try to restore session via refresh token
    const init = async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setAccessToken(data.accessToken);
          await fetchUser();
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    };
    init();
  }, [fetchUser]);

  const login = async (email: string, password: string) => {
    const data = await api<{ user: User; accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  };

  const register = async (email: string, password: string, fullName: string, role: string) => {
    const data = await api<{ user: User; accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, fullName, role }),
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
