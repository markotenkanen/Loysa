import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './PinsPanel.css';

export default function PinsPanel({ channel }) {
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!channel?.id) return;
    setLoading(true);
    api.get(`/channels/${channel.id}/pins`)
      .then(res => setPins(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [channel?.id]);

  return (
    <div className="pins-panel">
      <div className="panel-header">
        <h3>📌 Pinnatut viestit</h3>
      </div>

      {loading ? (
        <div className="spinner"></div>
      ) : pins.length === 0 ? (
        <div className="empty-panel">
          <p>Ei pinnattuja viestejä</p>
          <small>Pinnaa tärkeitä viestejä klikkaamalla viestiä ja valitsemalla 📌</small>
        </div>
      ) : (
        <div className="pins-list">
          {pins.map(pin => (
            <div key={pin.id} className="pin-item">
              <div className="pin-author">
                <strong>{pin.author_name}</strong>
                <span className="pin-time">{new Date(pin.message_created_at).toLocaleDateString('fi-FI')}</span>
              </div>
              <div className="pin-content">
                {pin.content.length > 200 ? pin.content.substring(0, 200) + '...' : pin.content}
              </div>
              <div className="pin-meta">Pinnannut: {pin.pinned_by_name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
