import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './SavedMessages.css';

export default function SavedMessages({ onClose, onSelectChannel }) {
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/messages/saved')
      .then(res => setSaved(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const unsave = async (messageId) => {
    await api.post(`/messages/${messageId}/save`);
    setSaved(prev => prev.filter(m => m.id !== messageId));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="saved-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Tallennetut viestit</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="spinner"></div>
        ) : saved.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔖</div>
            <h3>Ei tallennettuja viestejä</h3>
            <p>Tallenna tärkeitä viestejä klikkaamalla viestiä ja valitsemalla 🔖</p>
          </div>
        ) : (
          <div className="saved-list">
            {saved.map(msg => (
              <div key={msg.id} className="saved-item">
                <div className="saved-meta">
                  <span className="saved-channel">#{msg.channel_name}</span>
                  <span className="saved-author">{msg.display_name}</span>
                  <span className="saved-time">{new Date(msg.saved_at).toLocaleDateString('fi-FI')}</span>
                </div>
                <div className="saved-content">
                  {msg.content.length > 300 ? msg.content.substring(0, 300) + '...' : msg.content}
                </div>
                <button className="unsave-btn" onClick={() => unsave(msg.id)}>Poista tallennus</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
