import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import ChatArea from '../components/ChatArea';
import ThreadPanel from '../components/ThreadPanel';
import UserProfile from '../components/UserProfile';
import SearchModal from '../components/SearchModal';
import BrowseChannels from '../components/BrowseChannels';
import SavedMessages from '../components/SavedMessages';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import api from '../utils/api';

export default function WorkspacePage() {
  const { user, workspace } = useAuth();
  const { socket, on, off } = useSocket();
  const navigate = useNavigate();

  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [users, setUsers] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [rightPanel, setRightPanel] = useState(null); // 'thread' | 'members' | 'pins'
  const [threadMessage, setThreadMessage] = useState(null);

  useEffect(() => {
    loadChannels();
    loadUsers();
    loadNotifications();
  }, []);

  useEffect(() => {
    if (!socket?.current) return;

    const handleNewMessage = ({ channel_id }) => {
      setChannels(prev => prev.map(ch =>
        ch.id === channel_id && ch.id !== activeChannel?.id
          ? { ...ch, unread_count: (ch.unread_count || 0) + 1 }
          : ch
      ));
    };

    const handleOnline = ({ userId }) => {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_online: 1 } : u));
    };

    const handleOffline = ({ userId }) => {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_online: 0 } : u));
    };

    const handleNotification = (notif) => {
      setNotifications(prev => [notif, ...prev]);
      setUnreadCount(prev => prev + 1);
    };

    on('message:new', handleNewMessage);
    on('user:online', handleOnline);
    on('user:offline', handleOffline);
    on('notification:new', handleNotification);

    return () => {
      off('message:new', handleNewMessage);
      off('user:online', handleOnline);
      off('user:offline', handleOffline);
      off('notification:new', handleNotification);
    };
  }, [socket?.current, activeChannel]);

  const loadChannels = async () => {
    try {
      const res = await api.get('/channels');
      setChannels(res.data);
      if (!activeChannel && res.data.length > 0) {
        const general = res.data.find(c => c.name === 'general' && !c.is_dm);
        setActiveChannel(general || res.data[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadNotifications = async () => {
    try {
      const res = await api.get('/users/me/notifications');
      const unread = res.data.filter(n => !n.is_read).length;
      setNotifications(res.data);
      setUnreadCount(unread);
    } catch (err) {
      console.error(err);
    }
  };

  const selectChannel = (channel) => {
    setActiveChannel(channel);
    setRightPanel(null);
    setThreadMessage(null);
    // Merkitse luetuksi
    api.post(`/channels/${channel.id}/read`).catch(() => {});
    setChannels(prev => prev.map(ch => ch.id === channel.id ? { ...ch, unread_count: 0 } : ch));
  };

  const openDM = async (userId) => {
    try {
      const res = await api.post(`/channels/dm/${userId}`);
      const channel = res.data;
      if (!channels.find(c => c.id === channel.id)) {
        setChannels(prev => [...prev, channel]);
      }
      selectChannel(channel);
    } catch (err) {
      console.error(err);
    }
  };

  const openThread = (message) => {
    setThreadMessage(message);
    setRightPanel('thread');
  };

  const handleChannelCreated = (channel) => {
    setChannels(prev => [...prev, channel]);
    selectChannel(channel);
    setShowBrowse(false);
  };

  const getDMPartner = (channel) => {
    if (!channel?.is_dm) return null;
    const parts = channel.name.split('-');
    const partnerId = parts[1] == user.id ? parseInt(parts[2]) : parseInt(parts[1]);
    return users.find(u => u.id === partnerId);
  };

  const getChannelDisplayName = (channel) => {
    if (!channel) return '';
    if (channel.is_dm) {
      const partner = getDMPartner(channel);
      return partner?.display_name || 'Suoraviesti';
    }
    return `# ${channel.name}`;
  };

  return (
    <div className="workspace">
      <Sidebar
        workspace={workspace}
        channels={channels}
        users={users}
        activeChannel={activeChannel}
        onSelectChannel={selectChannel}
        onOpenDM={openDM}
        onShowSearch={() => setShowSearch(true)}
        onShowBrowse={() => setShowBrowse(true)}
        onShowSaved={() => setShowSaved(true)}
        onShowProfile={() => setShowProfile(true)}
        onChannelCreated={handleChannelCreated}
        currentUser={user}
        unreadCount={unreadCount}
        getDMPartner={getDMPartner}
      />

      <div className="main-content">
        {activeChannel ? (
          <ChatArea
            channel={activeChannel}
            users={users}
            currentUser={user}
            onOpenThread={openThread}
            onUpdateChannel={(updated) => setChannels(prev => prev.map(ch => ch.id === updated.id ? updated : ch))}
            onShowMembers={() => setRightPanel(rightPanel === 'members' ? null : 'members')}
            onShowPins={() => setRightPanel(rightPanel === 'pins' ? null : 'pins')}
            rightPanel={rightPanel}
            getDMPartner={getDMPartner}
          />
        ) : (
          <div className="no-channel">
            <h2>Valitse kanava aloittaaksesi</h2>
          </div>
        )}
      </div>

      {rightPanel === 'thread' && threadMessage && (
        <div className="right-panel">
          <ThreadPanel
            message={threadMessage}
            onClose={() => setRightPanel(null)}
            currentUser={user}
          />
        </div>
      )}

      {showSearch && <SearchModal onClose={() => setShowSearch(false)} onSelectChannel={selectChannel} />}
      {showProfile && <UserProfile onClose={() => setShowProfile(false)} />}
      {showBrowse && <BrowseChannels onClose={() => setShowBrowse(false)} onJoin={handleChannelCreated} />}
      {showSaved && <SavedMessages onClose={() => setShowSaved(false)} onSelectChannel={selectChannel} />}
    </div>
  );
}
