import React, { useState, useRef, useCallback, useEffect } from 'react';
import EmojiPicker from 'emoji-picker-react';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import './MessageInput.css';

export default function MessageInput({ channel, onSendMessage, currentUser, users }) {
  const [content, setContent] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimerRef = useRef(null);
  const { socket } = useSocket();

  useEffect(() => {
    textareaRef.current?.focus();
  }, [channel?.id]);

  const sendTyping = useCallback(() => {
    socket?.current?.emit('typing:start', { channel_id: channel?.id });
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      socket?.current?.emit('typing:stop', { channel_id: channel?.id });
    }, 2000);
  }, [socket, channel?.id]);

  const handleKeyDown = (e) => {
    if (showMentions) {
      if (e.key === 'Escape') { setShowMentions(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setContent(val);
    sendTyping();

    // Maininta-autocompletion
    const cursor = e.target.selectionStart;
    const textBefore = val.slice(0, cursor);
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex !== -1 && (atIndex === 0 || textBefore[atIndex - 1] === ' ')) {
      const search = textBefore.slice(atIndex + 1);
      if (!search.includes(' ')) {
        setMentionSearch(search);
        setMentionStart(atIndex);
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = (user) => {
    const before = content.slice(0, mentionStart);
    const after = content.slice(textareaRef.current.selectionStart);
    const newContent = `${before}@${user.display_name} ${after}`;
    setContent(newContent);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    if (!content.trim() && files.length === 0) return;

    if (content.trim()) {
      onSendMessage(content.trim());
    }

    // Lähetä tiedostot
    for (const file of files) {
      if (!file.uploaded) {
        await uploadFile(file);
      }
    }

    setContent('');
    setFiles([]);
    socket?.current?.emit('typing:stop', { channel_id: channel?.id });
  };

  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file.raw);
    formData.append('channel_id', channel.id);

    try {
      setUploading(true);
      const res = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // Lähetä viesti tiedostolla
      socket?.current?.emit('message:send', {
        channel_id: channel.id,
        content: `📎 ${res.data.original_name}`
      });
    } catch (err) {
      console.error('Tiedoston lähetys epäonnistui:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(prev => [
      ...prev,
      ...selected.map(f => ({ raw: f, name: f.name, size: f.size, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null }))
    ]);
    e.target.value = '';
  };

  const handleEmojiSelect = (emojiData) => {
    const cursor = textareaRef.current?.selectionStart || content.length;
    setContent(prev => prev.slice(0, cursor) + emojiData.emoji + prev.slice(cursor));
    setShowEmoji(false);
    textareaRef.current?.focus();
  };

  const insertFormatting = (before, after = before) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const newContent = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(newContent);
    ta.focus();
    setTimeout(() => {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = end + before.length;
    }, 0);
  };

  const filteredMentions = users?.filter(u =>
    u.id !== currentUser?.id &&
    u.display_name?.toLowerCase().includes(mentionSearch.toLowerCase())
  ).slice(0, 6) || [];

  return (
    <div className="message-input-area">
      {/* Tiedostoesikatselu */}
      {files.length > 0 && (
        <div className="file-preview-list">
          {files.map((f, i) => (
            <div key={i} className="file-preview">
              {f.preview ? <img src={f.preview} alt={f.name} /> : <span className="file-icon">📄</span>}
              <span className="file-name">{f.name}</span>
              <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="remove-file">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Maininta-autocomplete */}
      {showMentions && filteredMentions.length > 0 && (
        <div className="mention-list">
          {filteredMentions.map(u => (
            <div key={u.id} className="mention-item" onMouseDown={() => insertMention(u)}>
              <span className={`status-dot ${u.is_online ? 'online' : 'offline'}`}></span>
              <span>{u.display_name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="input-toolbar">
        <button className="toolbar-btn" onClick={() => insertFormatting('**')} title="Lihavointi">
          <strong>B</strong>
        </button>
        <button className="toolbar-btn" onClick={() => insertFormatting('_')} title="Kursivointi">
          <em>I</em>
        </button>
        <button className="toolbar-btn" onClick={() => insertFormatting('~')} title="Yliviivaus">
          <del>S</del>
        </button>
        <button className="toolbar-btn" onClick={() => insertFormatting('`')} title="Koodi">
          {'</>'}
        </button>
        <div className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => fileInputRef.current?.click()} title="Lisää tiedosto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"
        />
      </div>

      <div className="input-row">
        <div className="textarea-wrapper">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`Kirjoita viesti ${channel?.is_dm ? '' : `kanavalle #${channel?.name}`}`}
            rows={1}
            style={{ height: 'auto' }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }}
          />
        </div>

        <div className="input-actions">
          <button
            className={`action-btn ${showEmoji ? 'active' : ''}`}
            onClick={() => setShowEmoji(!showEmoji)}
            title="Emoji"
          >
            😊
          </button>
          <button
            className={`send-btn ${content.trim() || files.length > 0 ? 'active' : ''}`}
            onClick={handleSend}
            disabled={(!content.trim() && files.length === 0) || uploading}
            title="Lähetä (Enter)"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>

      {showEmoji && (
        <div className="emoji-picker-wrapper">
          <EmojiPicker
            onEmojiClick={handleEmojiSelect}
            theme="dark"
            height={400}
            searchPlaceholder="Etsi emojia..."
          />
        </div>
      )}
    </div>
  );
}
