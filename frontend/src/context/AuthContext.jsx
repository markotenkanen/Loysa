import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('loysa_token');
    if (token) {
      api.get('/auth/me')
        .then(res => {
          setUser(res.data.user);
          setWorkspace(res.data.workspace);
        })
        .catch(() => {
          localStorage.removeItem('loysa_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (workspaceSlug, email, password) => {
    const res = await api.post('/auth/login', { workspaceSlug, email, password });
    localStorage.setItem('loysa_token', res.data.token);
    setUser(res.data.user);
    setWorkspace(res.data.workspace);
    return res.data;
  };

  const register = async (workspaceSlug, displayName, email, password) => {
    const res = await api.post('/auth/register', { workspaceSlug, displayName, email, password });
    localStorage.setItem('loysa_token', res.data.token);
    setUser(res.data.user);
    setWorkspace(res.data.workspace);
    return res.data;
  };

  const createWorkspace = async (workspaceName, workspaceSlug, displayName, email, password) => {
    const res = await api.post('/auth/workspace/create', { workspaceName, workspaceSlug, displayName, email, password });
    localStorage.setItem('loysa_token', res.data.token);
    setUser(res.data.user);
    setWorkspace(res.data.workspace);
    return res.data;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('loysa_token');
    setUser(null);
    setWorkspace(null);
  };

  const updateUser = (updates) => setUser(prev => ({ ...prev, ...updates }));

  return (
    <AuthContext.Provider value={{ user, workspace, loading, login, register, createWorkspace, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
