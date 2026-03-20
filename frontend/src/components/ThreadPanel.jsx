import React, { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { fi } from 'date-fns/locale';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import './ThreadPanel.css';

export default function ThreadPanel({ message, onClose, currentUser }) {
  const [replies, setReplies] = useState([]);
  const [replyContent, setReplyContent] = useState('');
  const [loading, setLoading] = useState(true);
  const { socket, on, off } = useSocket();
  const bottomRef = useRef(null);

  useEffect(() => {
    loadThread();
  }, [message?.id]);

  useEffect(() => {
    if (!socket?.current) return;

    const handleReply = (data) => {
      if (data.message.parent_id === message.id) {
        setReplies(prev => [...prev, data.message]);
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    };

    on('message:new_reply', handleReply);
    return () => off('message:new_reply', handleReply);
  }, [socket?.current, message?.id]);

  const loadThread = async () => {
    try {
      const res = await api.get(`/messages/${message.id}/thread`);
      setReplies(res.data.replies);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const sendReply = () => {
    if (!replyContent.trim()) return;
    socket?.current?.emit('message:send', {
      channel_id: message.channel_id,
      content: replyContent.trim(),
      parent_id: message.id
    });
    setReplyContent('');
  };

  const formatTime = (dateStr) => {
    try {
      return format(parseISO(dateStr), 'HH:mm d.M.', { locale: fi });
    } catch {
      return '';
    }
  };

  return (
    <div className="thread-panel">
      <div className="thread-header">
        <h3>Ketju</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="thread-parent">
        <div className="thread-message">
          <div className="message-avatar-small">
            {message.author_avatar
              ? <img src={message.author_avatar} alt="" />
              : <div className="avatar-placeholder">{message.author_name?.[0]?.toUpperCase()}</div>
            }
          </div>
          <div>
            <div className="message-header">
              <span className="message-author">{message.author_name}</span>
              <span className="message-time">{formatTime(message.created_at)}</span>
            </div>
            <div className="message-text">{message.content}</div>
          </div>
        </div>
      </div>

      <div className="thread-replies">
        <div className="replies-label">
          {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'vastaus' : 'vastausta'}` : 'Ei vielä vastauksia'}
        </div>

        {loading ? (
          <div className="spinner"></div>
        ) : (
          replies.map(reply => (
            <div key={reply.id} className="thread-reply">
              <div className="message-avatar-small">
                {reply.author_avatar
                  ? <img src={reply.author_avatar} alt="" />
                  : <div className="avatar-placeholder">{reply.author_name?.[0]?.toUpperCase()}</div>
                }
              </div>
              <div>
                <div className="message-header">
                  <span className="message-author">{reply.author_name}</span>
                  <span className="message-time">{formatTime(reply.created_at)}</span>
                </div>
                <div className="message-text">{reply.content}</div>
                {reply.reactions?.length > 0 && (
                  <div className="reactions">
                    {reply.reactions.map(r => (
                      <span key={r.emoji} className="reaction-btn">{r.emoji} {r.count}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="thread-input">
        <textarea
          value={replyContent}
          onChange={e => setReplyContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          placeholder="Vastaa ketjuun..."
          rows={2}
        />
        <button className="send-btn active" onClick={sendReply} disabled={!replyContent.trim()}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
