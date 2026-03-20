import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('loysa_token');
    if (!user || !token) return;

    const socket = io(import.meta.env.VITE_API_URL || '/', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user]);

  const emit = (event, data, callback) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data, callback);
    }
  };

  const on = (event, handler) => {
    socketRef.current?.on(event, handler);
  };

  const off = (event, handler) => {
    socketRef.current?.off(event, handler);
  };

  return (
    <SocketContext.Provider value={{ socket: socketRef, connected, emit, on, off }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
