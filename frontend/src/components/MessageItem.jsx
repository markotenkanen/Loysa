import React, { useState, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { fi } from 'date-fns/locale';
import EmojiPicker from 'emoji-picker-react';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import './MessageItem.css';

function formatTime(dateStr) {
  try {
    return format(parseISO(dateStr), 'HH:mm', { locale: fi });
  } catch {
    try {
      return format(new Date(dateStr), 'HH:mm', { locale: fi });
    } catch {
      return '';
    }
  }
}

function renderContent(content) {
  if (!content) return '';

  // Kursiivointi _teksti_
  let parts = content.split(/(\*\*.*?\*\*|`.*?`|_.*?_|~.*?~)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('~') && part.endsWith('~')) {
      return <del key={i}>{part.slice(1, -1)}</del>;
    }
    // Linkit
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const subParts = part.split(urlRegex);
    return subParts.map((sp, j) => {
      if (urlRegex.test(sp)) {
        return <a key={`${i}-${j}`} href={sp} target="_blank" rel="noopener noreferrer">{sp}</a>;
      }
      // Maininnat
      return sp.split(/(@\w+)/g).map((mp, k) => {
        if (mp.startsWith('@')) {
          return <span key={`${i}-${j}-${k}`} className="mention">{mp}</span>;
        }
        return mp;
      });
    });
  });
}

export default function MessageItem({ message, currentUser, isGrouped, onOpenThread }) {
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const { socket } = useSocket();

  const isOwn = message.user_id === currentUser?.id;
  const isDeleted = message.is_deleted;

  const handleReaction = (emojiData) => {
    socket?.current?.emit('reaction:toggle', {
      message_id: message.id,
      emoji: emojiData.emoji
    });
    setShowEmojiPicker(false);
  };

  const handleQuickReaction = (emoji) => {
    socket?.current?.emit('reaction:toggle', {
      message_id: message.id,
      emoji
    });
  };

  const handleEdit = () => {
    socket?.current?.emit('message:edit', {
      message_id: message.id,
      content: editContent
    });
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!confirm('Haluatko varmasti poistaa tämän viestin?')) return;
    socket?.current?.emit('message:delete', { message_id: message.id });
  };

  const handleSave = async () => {
    await api.post(`/messages/${message.id}/save`);
  };

  const handlePin = async () => {
    await api.post(`/messages/${message.id}/pin`);
  };

  const quickEmojis = ['👍', '❤️', '😄', '🎉', '🚀', '👀'];

  return (
    <div
      className={`message-item ${isGrouped ? 'grouped' : ''} ${isDeleted ? 'deleted' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
    >
      {!isGrouped && (
        <div className="message-avatar">
          {message.author_avatar
            ? <img src={message.author_avatar} alt="" />
            : <div className="avatar-placeholder">{message.author_name?.[0]?.toUpperCase()}</div>
          }
        </div>
      )}
      {isGrouped && <div className="message-time-grouped">{formatTime(message.created_at)}</div>}

      <div className="message-content-wrapper">
        {!isGrouped && (
          <div className="message-header">
            <span className="message-author">{message.author_name}</span>
            {message.author_status_emoji && (
              <span className="author-status">{message.author_status_emoji}</span>
            )}
            <span className="message-time">{formatTime(message.created_at)}</span>
            {message.is_edited && <span className="edited-badge">(muokattu)</span>}
            {message.is_pinned > 0 && <span className="pin-badge">📌</span>}
          </div>
        )}

        {isEditing ? (
          <div className="edit-form">
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEdit(); }
                if (e.key === 'Escape') setIsEditing(false);
              }}
              autoFocus
            />
            <div className="edit-actions">
              <button className="btn-secondary" onClick={() => setIsEditing(false)}>Peruuta</button>
              <button className="btn-primary" onClick={handleEdit}>Tallenna</button>
            </div>
          </div>
        ) : (
          <div className="message-text">
            {isDeleted
              ? <span className="deleted-text">[Viesti poistettu]</span>
              : <span>{renderContent(message.content)}</span>
            }
          </div>
        )}

        {/* Tiedostot */}
        {message.files?.length > 0 && (
          <div className="message-files">
            {message.files.map(f => (
              <FileAttachment key={f.id} file={f} />
            ))}
          </div>
        )}

        {/* Reaktiot */}
        {message.reactions?.length > 0 && (
          <div className="reactions">
            {message.reactions.map(r => (
              <button
                key={r.emoji}
                className={`reaction-btn ${r.reacted_by_me ? 'reacted' : ''}`}
                onClick={() => handleQuickReaction(r.emoji)}
                title={r.users}
              >
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        )}

        {/* Ketju */}
        {message.reply_count > 0 && (
          <button className="thread-btn" onClick={() => onOpenThread(message)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            {message.reply_count} {message.reply_count === 1 ? 'vastaus' : 'vastausta'}
          </button>
        )}
      </div>

      {/* Toiminnot */}
      {showActions && !isDeleted && (
        <div className="message-actions">
          {quickEmojis.map(e => (
            <button key={e} className="action-btn emoji-quick" onClick={() => handleQuickReaction(e)}>{e}</button>
          ))}
          <button className="action-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Lisää reaktio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 13s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
          <button className="action-btn" onClick={() => onOpenThread(message)} title="Vastaa ketjussa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button className="action-btn" onClick={handleSave} title="Tallenna viesti">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button className="action-btn" onClick={handlePin} title="Pinnaa viesti">📌</button>
          {isOwn && (
            <>
              <button className="action-btn" onClick={() => { setIsEditing(true); setEditContent(message.content); }} title="Muokkaa">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button className="action-btn danger" onClick={handleDelete} title="Poista">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/>
                  <path d="M14 11v6"/>
                </svg>
              </button>
            </>
          )}

          {showEmojiPicker && (
            <div className="emoji-picker-container">
              <EmojiPicker
                onEmojiClick={handleReaction}
                theme="dark"
                height={350}
                searchPlaceholder="Etsi emojia..."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileAttachment({ file }) {
  const isImage = file.mime_type?.startsWith('image/');
  const url = `/api/files/${file.filename}`;

  if (isImage) {
    return (
      <div className="file-image">
        <img src={url} alt={file.original_name} loading="lazy" />
        <a href={url} download={file.original_name} className="file-download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
      </div>
    );
  }

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <a href={url} download={file.original_name} className="file-attachment">
      <div className="file-icon">📄</div>
      <div className="file-info">
        <div className="file-name">{file.original_name}</div>
        <div className="file-size">{formatSize(file.size)}</div>
      </div>
      <div className="file-download-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
    </a>
  );
}
