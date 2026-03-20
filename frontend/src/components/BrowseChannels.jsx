import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './BrowseChannels.css';

export default function BrowseChannels({ onClose, onJoin }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState(null);

  useEffect(() => {
    api.get('/channels/browse')
      .then(res => setChannels(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const joinChannel = async (channel) => {
    setJoining(channel.id);
    try {
      await api.post(`/channels/${channel.id}/join`);
      onJoin(channel);
    } catch (err) {
      alert(err.response?.data?.error || 'Virhe kanavalle liittymisessä');
    } finally {
      setJoining(null);
    }
  };

  const filtered = channels.filter(c =>
    c.name.includes(search.toLowerCase()) ||
    c.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="browse-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Selaa kanavia</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="search-bar">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Etsi kanavia..."
            autoFocus
          />
        </div>

        {loading ? (
          <div className="spinner"></div>
        ) : (
          <div className="channel-browse-list">
            {filtered.map(ch => (
              <div key={ch.id} className="browse-channel-item">
                <div className="browse-channel-info">
                  <div className="browse-channel-name">
                    <span className="hash">#</span>
                    <strong>{ch.name}</strong>
                    <span className="member-count">{ch.member_count} jäsentä</span>
                  </div>
                  {ch.description && <div className="browse-channel-desc">{ch.description}</div>}
                </div>
                {ch.is_member ? (
                  <span className="member-badge">Jäsen</span>
                ) : (
                  <button
                    className="btn-primary btn-small"
                    onClick={() => joinChannel(ch)}
                    disabled={joining === ch.id}
                  >
                    {joining === ch.id ? 'Liitytään...' : 'Liity'}
                  </button>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state">Ei kanavia löydetty</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
