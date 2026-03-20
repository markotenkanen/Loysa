import React, { useState, useEffect, useRef, useCallback } from 'react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import ChannelHeader from './ChannelHeader';
import MembersPanel from './MembersPanel';
import PinsPanel from './PinsPanel';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';
import './ChatArea.css';

export default function ChatArea({
  channel, users, currentUser, onOpenThread,
  onUpdateChannel, onShowMembers, onShowPins, rightPanel, getDMPartner
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const { socket, on, off } = useSocket();
  const typingTimerRef = useRef({});

  useEffect(() => {
    if (!channel) return;
    setMessages([]);
    setLoading(true);
    loadMessages();
  }, [channel?.id]);

  useEffect(() => {
    if (!socket?.current || !channel) return;

    const handleNewMessage = (data) => {
      if (data.channel_id === channel.id) {
        setMessages(prev => [...prev, data.message]);
      }
    };

    const handleEdited = (data) => {
      if (data.channel_id === channel.id) {
        setMessages(prev => prev.map(m =>
          m.id === data.message_id
            ? { ...m, content: data.content, is_edited: true }
            : m
        ));
      }
    };

    const handleDeleted = (data) => {
      if (data.channel_id === channel.id) {
        setMessages(prev => prev.map(m =>
          m.id === data.message_id
            ? { ...m, is_deleted: true, content: '[Viesti poistettu]' }
            : m
        ));
      }
    };

    const handleReaction = (data) => {
      if (data.channel_id === channel.id) {
        setMessages(prev => prev.map(m =>
          m.id === data.message_id
            ? { ...m, reactions: data.reactions }
            : m
        ));
      }
    };

    const handleTypingStart = (data) => {
      if (data.channel_id === channel.id && data.userId !== currentUser?.id) {
        setTypingUsers(prev => {
          if (prev.find(u => u.userId === data.userId)) return prev;
          return [...prev, { userId: data.userId, displayName: data.displayName }];
        });
        if (typingTimerRef.current[data.userId]) {
          clearTimeout(typingTimerRef.current[data.userId]);
        }
        typingTimerRef.current[data.userId] = setTimeout(() => {
          setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
        }, 3000);
      }
    };

    const handleTypingStop = (data) => {
      if (data.channel_id === channel.id) {
        setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
        clearTimeout(typingTimerRef.current[data.userId]);
      }
    };

    const handleNewReply = (data) => {
      if (data.channel_id === channel.id) {
        setMessages(prev => prev.map(m =>
          m.id === data.message.parent_id
            ? { ...m, reply_count: (m.reply_count || 0) + 1 }
            : m
        ));
      }
    };

    on('message:new', handleNewMessage);
    on('message:edited', handleEdited);
    on('message:deleted', handleDeleted);
    on('reaction:updated', handleReaction);
    on('typing:start', handleTypingStart);
    on('typing:stop', handleTypingStop);
    on('message:new_reply', handleNewReply);

    return () => {
      off('message:new', handleNewMessage);
      off('message:edited', handleEdited);
      off('message:deleted', handleDeleted);
      off('reaction:updated', handleReaction);
      off('typing:start', handleTypingStart);
      off('typing:stop', handleTypingStop);
      off('message:new_reply', handleNewReply);
    };
  }, [socket?.current, channel?.id, currentUser?.id]);

  const loadMessages = async (before = null) => {
    try {
      const params = before ? `?before=${before}&limit=50` : '?limit=50';
      const res = await api.get(`/messages/channel/${channel.id}${params}`);
      if (before) {
        setMessages(prev => [...res.data.messages, ...prev]);
      } else {
        setMessages(res.data.messages);
      }
      setHasMore(res.data.hasMore);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (messages.length > 0) {
      loadMessages(messages[0].created_at);
    }
  };

  const sendMessage = useCallback((content, files = []) => {
    if (!socket?.current?.connected) return;
    socket.current.emit('message:send', { channel_id: channel.id, content }, (res) => {
      if (res?.error) console.error(res.error);
    });
  }, [socket, channel?.id]);

  const sendReply = useCallback((content, parentId) => {
    if (!socket?.current?.connected) return;
    socket.current.emit('message:send', { channel_id: channel.id, content, parent_id: parentId });
  }, [socket, channel?.id]);

  const getDMPartnerForChannel = () => {
    if (!channel?.is_dm) return null;
    return getDMPartner(channel);
  };

  return (
    <div className="chat-area">
      <ChannelHeader
        channel={channel}
        dmPartner={getDMPartnerForChannel()}
        onShowMembers={onShowMembers}
        onShowPins={onShowPins}
        onUpdateChannel={onUpdateChannel}
        rightPanel={rightPanel}
      />

      <div className="chat-body">
        <div className="messages-container">
          {loading ? (
            <div className="loading-messages">
              <div className="spinner"></div>
            </div>
          ) : (
            <MessageList
              messages={messages}
              currentUser={currentUser}
              users={users}
              hasMore={hasMore}
              onLoadMore={loadMore}
              onOpenThread={onOpenThread}
              channel={channel}
            />
          )}

          {typingUsers.length > 0 && (
            <div className="typing-indicator">
              <div className="typing-dots">
                <span></span><span></span><span></span>
              </div>
              <span>
                {typingUsers.map(u => u.displayName).join(', ')}
                {typingUsers.length === 1 ? ' kirjoittaa...' : ' kirjoittavat...'}
              </span>
            </div>
          )}
        </div>

        {rightPanel === 'members' && (
          <MembersPanel channel={channel} currentUser={currentUser} onOpenDM={() => {}} />
        )}

        {rightPanel === 'pins' && (
          <PinsPanel channel={channel} />
        )}
      </div>

      <MessageInput
        channel={channel}
        onSendMessage={sendMessage}
        currentUser={currentUser}
        users={users}
      />
    </div>
  );
}
