import React, { useEffect, useRef, useState } from 'react';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { fi } from 'date-fns/locale';
import MessageItem from './MessageItem';
import './MessageList.css';

function formatDate(dateStr) {
  try {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Tänään';
    if (isYesterday(date)) return 'Eilen';
    return format(date, 'd. MMMM yyyy', { locale: fi });
  } catch {
    return dateStr;
  }
}

function groupMessagesByDate(messages) {
  const groups = [];
  let currentDate = null;

  for (const msg of messages) {
    const dateStr = msg.created_at?.split('T')[0] || msg.created_at?.split(' ')[0];
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groups.push({ type: 'date', date: msg.created_at });
    }
    groups.push({ type: 'message', message: msg });
  }
  return groups;
}

export default function MessageList({ messages, currentUser, users, hasMore, onLoadMore, onOpenThread, channel }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const prevScrollHeight = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [channel?.id]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setIsAtBottom(atBottom);

    if (el.scrollTop < 50 && hasMore) {
      prevScrollHeight.current = el.scrollHeight;
      onLoadMore();
    }
  };

  // Säilytä scroll-positio ladattaessa lisää
  useEffect(() => {
    const el = containerRef.current;
    if (el && prevScrollHeight.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = 0;
    }
  }, [messages.length]);

  const items = groupMessagesByDate(messages);

  return (
    <div className="message-list" ref={containerRef} onScroll={handleScroll}>
      {hasMore && (
        <button className="load-more-btn" onClick={onLoadMore}>
          Lataa lisää viestejä
        </button>
      )}

      {messages.length === 0 && (
        <div className="channel-welcome">
          <div className="welcome-icon">{channel?.is_dm ? '💬' : '#'}</div>
          <h3>
            {channel?.is_dm
              ? 'Aloita keskustelu'
              : `Tervetuloa kanavalle #${channel?.name}`}
          </h3>
          <p>
            {channel?.is_dm
              ? 'Tämä on alkua suoraviestikeskustelustasi.'
              : channel?.description || 'Tämä on kanavan alku.'}
          </p>
        </div>
      )}

      {items.map((item, idx) => {
        if (item.type === 'date') {
          return (
            <div key={`date-${idx}`} className="date-separator">
              <span>{formatDate(item.date)}</span>
            </div>
          );
        }

        const msg = item.message;
        const prevMsg = idx > 1 ? items[idx - 1]?.message : null;
        const isGrouped = prevMsg &&
          prevMsg.user_id === msg.user_id &&
          new Date(msg.created_at) - new Date(prevMsg.created_at) < 5 * 60 * 1000;

        return (
          <MessageItem
            key={msg.id}
            message={msg}
            currentUser={currentUser}
            isGrouped={isGrouped}
            onOpenThread={onOpenThread}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
