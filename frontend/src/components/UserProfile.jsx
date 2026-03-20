import React, { useState } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import './UserProfile.css';

export default function UserProfile({ onClose }) {
  const { user, updateUser } = useAuth();
  const [tab, setTab] = useState('profile');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [statusEmoji, setStatusEmoji] = useState(user?.status_emoji || '');
  const [statusText, setStatusText] = useState(user?.status_text || '');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const saveProfile = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await api.patch('/users/me', { display_name: displayName, status_emoji: statusEmoji, status_text: statusText });
      updateUser(res.data);
      setMessage('Profiili tallennettu!');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Virhe tallennuksessa');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage('Salasanat eivät täsmää');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await api.patch('/users/me/password', { current_password: currentPassword, new_password: newPassword });
      setMessage('Salasana vaihdettu!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Virhe salasanan vaihdossa');
    } finally {
      setSaving(false);
    }
  };

  const clearStatus = async () => {
    setStatusEmoji('');
    setStatusText('');
    await api.patch('/users/me', { status_emoji: '', status_text: '' });
    updateUser({ status_emoji: '', status_text: '' });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Profiili</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="profile-tabs">
          <button className={`tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>Profiili</button>
          <button className={`tab ${tab === 'status' ? 'active' : ''}`} onClick={() => setTab('status')}>Tila</button>
          <button className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => setTab('security')}>Turvallisuus</button>
        </div>

        {message && <div className={`feedback-msg ${message.includes('Virhe') || message.includes('eivät') ? 'error' : 'success'}`}>{message}</div>}

        {tab === 'profile' && (
          <div className="profile-content">
            <div className="avatar-section">
              <div className="profile-avatar">
                {user?.avatar
                  ? <img src={user.avatar} alt="" />
                  : <div className="avatar-large">{user?.display_name?.[0]?.toUpperCase()}</div>
                }
              </div>
              <div className="avatar-info">
                <strong>{user?.email}</strong>
                <span className="user-role">{user?.role === 'admin' ? 'Admin' : 'Jäsen'}</span>
              </div>
            </div>

            <div className="form-group">
              <label>Näyttönimi</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Nimesi"
              />
            </div>

            <button className="btn-primary" onClick={saveProfile} disabled={saving}>
              {saving ? 'Tallennetaan...' : 'Tallenna muutokset'}
            </button>
          </div>
        )}

        {tab === 'status' && (
          <div className="status-content">
            <div className="status-preview">
              <span className="status-emoji-large">{statusEmoji || '😊'}</span>
              <span>{statusText || 'Aseta tila...'}</span>
            </div>

            <div className="form-group">
              <label>Tilaemoji</label>
              <div className="emoji-status-row">
                <button className="emoji-trigger" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                  {statusEmoji || '😊'} Valitse emoji
                </button>
                {showEmojiPicker && (
                  <div className="emoji-picker-container">
                    <EmojiPicker
                      onEmojiClick={(e) => { setStatusEmoji(e.emoji); setShowEmojiPicker(false); }}
                      theme="dark"
                      height={350}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Tilateksti</label>
              <input
                value={statusText}
                onChange={e => setStatusText(e.target.value)}
                placeholder="Esim. Palaverissa, Lomalla..."
                maxLength={100}
              />
            </div>

            <div className="quick-statuses">
              {[
                { emoji: '🎯', text: 'Töissä' },
                { emoji: '🌴', text: 'Lomalla' },
                { emoji: '📵', text: 'Älä häiritse' },
                { emoji: '🚗', text: 'Matkalla' },
                { emoji: '🤒', text: 'Sairaana' },
              ].map(s => (
                <button key={s.text} className="quick-status-btn" onClick={() => { setStatusEmoji(s.emoji); setStatusText(s.text); }}>
                  {s.emoji} {s.text}
                </button>
              ))}
            </div>

            <div className="status-actions">
              <button className="btn-secondary" onClick={clearStatus}>Tyhjennä tila</button>
              <button className="btn-primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Tallennetaan...' : 'Tallenna tila'}
              </button>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="security-content">
            <h3>Vaihda salasana</h3>
            <div className="form-group">
              <label>Nykyinen salasana</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Uusi salasana</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Vähintään 8 merkkiä"
              />
            </div>
            <div className="form-group">
              <label>Vahvista uusi salasana</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
            </div>
            <button className="btn-primary" onClick={changePassword} disabled={saving}>
              {saving ? 'Vaihdetaan...' : 'Vaihda salasana'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
