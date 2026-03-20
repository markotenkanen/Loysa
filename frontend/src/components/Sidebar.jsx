import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import './Sidebar.css';

export default function Sidebar({
  workspace, channels, users, activeChannel,
  onSelectChannel, onOpenDM, onShowSearch, onShowBrowse,
  onShowSaved, onShowProfile, onChannelCreated, currentUser,
  unreadCount, getDMPartner
}) {
  const { logout } = useAuth();
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [showDMList, setShowDMList] = useState(true);
  const [showChannelList, setShowChannelList] = useState(true);

  const publicChannels = channels.filter(c => !c.is_dm);
  const dmChannels = channels.filter(c => c.is_dm);

  const createChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    try {
      const res = await api.post('/channels', {
        name: newChannelName.trim(),
        is_private: newChannelPrivate
      });
      onChannelCreated(res.data);
      setNewChannelName('');
      setShowNewChannel(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Virhe kanavan luomisessa');
    }
  };

  const getDMName = (channel) => {
    const partner = getDMPartner(channel);
    return partner?.display_name || 'Suoraviesti';
  };

  const getDMStatus = (channel) => {
    const partner = getDMPartner(channel);
    if (!partner) return '';
    if (partner.is_online) return partner.is_away ? 'away' : 'online';
    return 'offline';
  };

  return (
    <div className="sidebar">
      {/* Workspace header */}
      <div className="sidebar-header">
        <div className="workspace-name">
          <span className="workspace-icon">{workspace?.name?.[0]?.toUpperCase()}</span>
          <span className="workspace-title">{workspace?.name}</span>
        </div>
      </div>

      {/* Haku */}
      <button className="sidebar-search" onClick={onShowSearch}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="6"/>
          <path d="M15 15l3 3"/>
        </svg>
        <span>Hae...</span>
        <kbd>Ctrl+K</kbd>
      </button>

      {/* Navigaatio */}
      <div className="sidebar-nav">
        <button className="nav-item" onClick={onShowSaved}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          Tallennetut viestit
          {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
        </button>
      </div>

      <div className="sidebar-divider" />

      {/* Kanavat */}
      <div className="sidebar-section">
        <div className="section-header" onClick={() => setShowChannelList(!showChannelList)}>
          <svg className={`chevron ${showChannelList ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span>Kanavat</span>
          <button
            className="add-btn"
            onClick={(e) => { e.stopPropagation(); setShowNewChannel(true); }}
            title="Luo kanava"
          >+</button>
        </div>

        {showChannelList && (
          <div className="channel-list">
            {publicChannels.map(ch => (
              <div
                key={ch.id}
                className={`channel-item ${activeChannel?.id === ch.id ? 'active' : ''} ${ch.unread_count > 0 ? 'unread' : ''}`}
                onClick={() => onSelectChannel(ch)}
              >
                <span className="channel-hash">{ch.is_private ? '🔒' : '#'}</span>
                <span className="channel-name">{ch.name}</span>
                {ch.unread_count > 0 && <span className="unread-dot">{ch.unread_count > 99 ? '99+' : ch.unread_count}</span>}
              </div>
            ))}
            <div className="channel-item browse" onClick={onShowBrowse}>
              <span className="channel-hash">+</span>
              <span>Selaa kanavia</span>
            </div>
          </div>
        )}
      </div>

      {/* DM:t */}
      <div className="sidebar-section">
        <div className="section-header" onClick={() => setShowDMList(!showDMList)}>
          <svg className={`chevron ${showDMList ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span>Suoraviestit</span>
        </div>

        {showDMList && (
          <div className="channel-list">
            {dmChannels.map(ch => (
              <div
                key={ch.id}
                className={`channel-item ${activeChannel?.id === ch.id ? 'active' : ''} ${ch.unread_count > 0 ? 'unread' : ''}`}
                onClick={() => onSelectChannel(ch)}
              >
                <span className={`status-dot ${getDMStatus(ch)}`}></span>
                <span className="channel-name">{getDMName(ch)}</span>
                {ch.unread_count > 0 && <span className="unread-dot">{ch.unread_count}</span>}
              </div>
            ))}
            {/* Uusi DM */}
            <DMSelector users={users.filter(u => u.id !== currentUser?.id)} onOpenDM={onOpenDM} />
          </div>
        )}
      </div>

      {/* Käyttäjäinfo */}
      <div className="sidebar-user" onClick={onShowProfile}>
        <div className="user-avatar-small">
          {currentUser?.avatar
            ? <img src={currentUser.avatar} alt="" />
            : <span>{currentUser?.display_name?.[0]?.toUpperCase()}</span>
          }
          <span className={`status-indicator ${currentUser?.is_away ? 'away' : 'online'}`}></span>
        </div>
        <div className="user-info">
          <div className="user-name">{currentUser?.display_name}</div>
          <div className="user-status-text">
            {currentUser?.status_emoji} {currentUser?.status_text || (currentUser?.is_away ? 'Poissa' : 'Aktiivinen')}
          </div>
        </div>
        <button className="logout-btn" onClick={(e) => { e.stopPropagation(); logout(); }} title="Kirjaudu ulos">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>

      {/* Uuden kanavan modal */}
      {showNewChannel && (
        <div className="modal-overlay" onClick={() => setShowNewChannel(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Luo kanava</h3>
            <form onSubmit={createChannel}>
              <div className="form-group">
                <label>Kanavan nimi</label>
                <input
                  type="text"
                  placeholder="esim. projekti-alpha"
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value)}
                  autoFocus
                />
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newChannelPrivate}
                  onChange={e => setNewChannelPrivate(e.target.checked)}
                />
                Yksityinen kanava
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowNewChannel(false)}>Peruuta</button>
                <button type="submit" className="btn-primary">Luo kanava</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DMSelector({ users, onOpenDM }) {
  const [show, setShow] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = users.filter(u =>
    u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (!show) {
    return (
      <div className="channel-item browse" onClick={() => setShow(true)}>
        <span className="channel-hash">+</span>
        <span>Uusi viesti</span>
      </div>
    );
  }

  return (
    <div className="dm-selector">
      <input
        autoFocus
        placeholder="Etsi käyttäjää..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        onBlur={() => { setShow(false); setSearch(''); }}
      />
      <div className="dm-user-list">
        {filtered.map(u => (
          <div key={u.id} className="dm-user-item" onMouseDown={() => { onOpenDM(u.id); setShow(false); }}>
            <span className={`status-dot ${u.is_online ? (u.is_away ? 'away' : 'online') : 'offline'}`}></span>
            <span>{u.display_name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
