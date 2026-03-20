import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [form, setForm] = useState({ workspaceSlug: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.workspaceSlug, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Kirjautuminen epäonnistui');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon">L</div>
          <h1>Loysa</h1>
        </div>
        <h2>Kirjaudu sisään</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Workspace-tunnus</label>
            <input
              type="text"
              placeholder="esim. tiimini"
              value={form.workspaceSlug}
              onChange={e => setForm(f => ({ ...f, workspaceSlug: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label>Sähköposti</label>
            <input
              type="email"
              placeholder="sinä@esimerkki.fi"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label>Salasana</label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Kirjaudutaan...' : 'Kirjaudu sisään'}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/register">Liity olemassa olevaan workspaceen</Link>
          <Link to="/create-workspace">Luo uusi workspace</Link>
        </div>
      </div>
    </div>
  );
}
