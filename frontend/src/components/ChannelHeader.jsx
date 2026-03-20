import React, { useState } from 'react';
import api from '../utils/api';
import './ChannelHeader.css';

export default function ChannelHeader({ channel, dmPartner, onShowMembers, onShowPins, onUpdateChannel, rightPanel }) {
  const [editingTopic, setEditingTopic] = useState(false);
  const [topic, setTopic] = useState(channel?.topic || '');

  const saveTopic = async () => {
    try {
      const res = await api.patch(`/channels/${channel.id}`, { topic });
      onUpdateChannel(res.data);
      setEditingTopic(false);
    } catch (err) {
      console.error(err);
    }
  };

  if (!channel) return null;

  return (
    <div className="channel-header">
      <div className="channel-header-left">
        {channel.is_dm ? (
          <div className="dm-header">
            <span className={`status-dot ${dmPartner?.is_online ? (dmPartner?.is_away ? 'away' : 'online') : 'offline'}`}></span>
            <h2>{dmPartner?.display_name || 'Suoraviesti'}</h2>
            {dmPartner?.status_text && (
              <span className="header-status">{dmPartner.status_emoji} {dmPartner.status_text}</span>
            )}
          </div>
        ) : (
          <div className="channel-name-section">
            <h2>
              <span className="hash">{channel.is_private ? '🔒' : '#'}</span>
              {channel.name}
            </h2>
            {editingTopic ? (
              <div className="topic-edit">
                <input
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTopic(); if (e.key === 'Escape') setEditingTopic(false); }}
                  placeholder="Aseta aihe..."
                  autoFocus
                />
                <button onClick={saveTopic} className="btn-small">Tallenna</button>
                <button onClick={() => setEditingTopic(false)} className="btn-small secondary">Peruuta</button>
              </div>
            ) : (
              <button className="topic-btn" onClick={() => setEditingTopic(true)}>
                {channel.topic || <span className="topic-placeholder">Lisää aihe</span>}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="channel-header-right">
        {!channel.is_dm && (
          <button
            className={`header-btn ${rightPanel === 'pins' ? 'active' : ''}`}
            onClick={onShowPins}
            title="Pinnatut viestit"
          >
            📌
          </button>
        )}
        {!channel.is_dm && (
          <button
            className={`header-btn ${rightPanel === 'members' ? 'active' : ''}`}
            onClick={onShowMembers}
            title="Jäsenet"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
