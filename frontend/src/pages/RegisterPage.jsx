import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const [form, setForm] = useState({ workspaceSlug: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Salasanan on oltava vähintään 8 merkkiä');
      return;
    }
    setLoading(true);
    try {
      await register(form.workspaceSlug, form.displayName, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Rekisteröityminen epäonnistui');
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
        <h2>Liity workspaceen</h2>
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
            <label>Näyttönimi</label>
            <input
              type="text"
              placeholder="Matti Meikäläinen"
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
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
              placeholder="Vähintään 8 merkkiä"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Rekisteröidään...' : 'Rekisteröidy'}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">Onko sinulla jo tili? Kirjaudu sisään</Link>
          <Link to="/create-workspace">Luo uusi workspace</Link>
        </div>
      </div>
    </div>
  );
}
