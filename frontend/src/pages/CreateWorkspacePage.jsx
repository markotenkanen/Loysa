import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function CreateWorkspacePage() {
  const [form, setForm] = useState({ workspaceName: '', workspaceSlug: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { createWorkspace } = useAuth();
  const navigate = useNavigate();

  const handleNameChange = (e) => {
    const name = e.target.value;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    setForm(f => ({ ...f, workspaceName: name, workspaceSlug: slug }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Salasanan on oltava vähintään 8 merkkiä');
      return;
    }
    setLoading(true);
    try {
      await createWorkspace(form.workspaceName, form.workspaceSlug, form.displayName, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Workspacen luominen epäonnistui');
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
        <h2>Luo uusi workspace</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Workspacen nimi</label>
            <input
              type="text"
              placeholder="Minun Tiimini"
              value={form.workspaceName}
              onChange={handleNameChange}
              required
            />
          </div>
          <div className="form-group">
            <label>Workspace-tunnus (URL)</label>
            <div className="input-prefix">
              <span>loysa.app/</span>
              <input
                type="text"
                placeholder="minun-tiimini"
                value={form.workspaceSlug}
                onChange={e => setForm(f => ({ ...f, workspaceSlug: e.target.value }))}
                pattern="[a-z0-9-]+"
                required
              />
            </div>
            <small>Vain pieniä kirjaimia, numeroita ja viivoja</small>
          </div>
          <div className="form-group">
            <label>Nimesi</label>
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
            {loading ? 'Luodaan...' : 'Luo workspace'}
          </button>
        </form>
        <div className="auth-links">
          <Link to="/login">Kirjaudu olemassa olevaan workspaceen</Link>
        </div>
      </div>
    </div>
  );
}
