import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import './SearchModal.css';

export default function SearchModal({ onClose, onSelectChannel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/messages/search?q=${encodeURIComponent(query)}`);
        setResults(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <svg className="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="6"/>
            <path d="M15 15l3 3"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Hae viestejä, kanavia, käyttäjiä..."
          />
          {loading && <div className="spinner-small"></div>}
          <button className="search-close" onClick={onClose}>Esc</button>
        </div>

        {results.length > 0 && (
          <div className="search-results">
            <div className="results-label">Hakutulokset ({results.length})</div>
            {results.map(msg => (
              <div key={msg.id} className="search-result-item">
                <div className="result-meta">
                  <span className="result-channel">#{msg.channel_name}</span>
                  <span className="result-author">{msg.display_name}</span>
                  <span className="result-time">{new Date(msg.created_at).toLocaleDateString('fi-FI')}</span>
                </div>
                <div className="result-content">
                  {msg.content.length > 150 ? msg.content.substring(0, 150) + '...' : msg.content}
                </div>
              </div>
            ))}
          </div>
        )}

        {query && !loading && results.length === 0 && (
          <div className="no-results">Ei tuloksia haulle "{query}"</div>
        )}

        {!query && (
          <div className="search-hints">
            <div className="hint-title">Hakuvinkkejä:</div>
            <div className="hint">Hae viestejä mistä tahansa kanavasta</div>
            <div className="hint">Käytä <kbd>Ctrl+K</kbd> avataksesi haun</div>
          </div>
        )}
      </div>
    </div>
  );
}
