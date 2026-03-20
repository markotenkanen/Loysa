import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import './MembersPanel.css';

export default function MembersPanel({ channel, currentUser, onOpenDM }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!channel?.id) return;
    setLoading(true);
    api.get(`/channels/${channel.id}/members`)
      .then(res => setMembers(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [channel?.id]);

  const online = members.filter(m => m.is_online && !m.is_away);
  const away = members.filter(m => m.is_online && m.is_away);
  const offline = members.filter(m => !m.is_online);

  const MemberItem = ({ member }) => (
    <div className="member-item" onClick={() => member.id !== currentUser?.id && onOpenDM(member.id)}>
      <div className="member-avatar">
        {member.avatar
          ? <img src={member.avatar} alt="" />
          : <div className="avatar-placeholder">{member.display_name?.[0]?.toUpperCase()}</div>
        }
        <span className={`status-indicator ${member.is_online ? (member.is_away ? 'away' : 'online') : 'offline'}`}></span>
      </div>
      <div className="member-info">
        <span className="member-name">{member.display_name} {member.id === currentUser?.id && '(sinä)'}</span>
        {member.status_text && (
          <span className="member-status">{member.status_emoji} {member.status_text}</span>
        )}
      </div>
      {member.is_admin && <span className="admin-badge">Admin</span>}
    </div>
  );

  return (
    <div className="members-panel">
      <div className="panel-header">
        <h3>Jäsenet ({members.length})</h3>
      </div>

      {loading ? (
        <div className="spinner"></div>
      ) : (
        <div className="members-list">
          {online.length > 0 && (
            <div className="member-group">
              <div className="group-label">Paikalla — {online.length}</div>
              {online.map(m => <MemberItem key={m.id} member={m} />)}
            </div>
          )}
          {away.length > 0 && (
            <div className="member-group">
              <div className="group-label">Poissa — {away.length}</div>
              {away.map(m => <MemberItem key={m.id} member={m} />)}
            </div>
          )}
          {offline.length > 0 && (
            <div className="member-group">
              <div className="group-label">Offline — {offline.length}</div>
              {offline.map(m => <MemberItem key={m.id} member={m} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
