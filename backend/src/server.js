require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db/database');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'loysa-secret-key-change-in-production';
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Reittit
app.use('/api/auth', require('./routes/auth'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/users', require('./routes/users'));
app.use('/api/files', require('./routes/files'));

// Slash-komennot
app.post('/api/commands', require('./middleware/auth').authenticateToken, (req, res) => {
  const { command, text, channel_id } = req.body;
  switch (command) {
    case '/me':
      res.json({ type: 'me_action', text: text || '' });
      break;
    case '/away':
      db.prepare('UPDATE users SET is_away = 1 WHERE id = ?').run(req.user.id);
      res.json({ type: 'status', text: 'Olet nyt poissa' });
      break;
    case '/active':
      db.prepare('UPDATE users SET is_away = 0 WHERE id = ?').run(req.user.id);
      res.json({ type: 'status', text: 'Olet nyt aktiivinen' });
      break;
    case '/topic':
      if (channel_id && text) {
        db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(text, channel_id);
        res.json({ type: 'topic', text });
      } else {
        res.json({ type: 'error', text: 'Käyttö: /topic <aihe>' });
      }
      break;
    case '/help':
      res.json({
        type: 'help',
        text: `Käytettävissä olevat komennot:
• /me <teksti> - Toiminta-viesti
• /away - Aseta poissa-tila
• /active - Aseta aktiivinen tila
• /topic <aihe> - Aseta kanavan aihe
• /help - Näytä tämä ohje`
      });
      break;
    default:
      res.json({ type: 'error', text: `Tuntematon komento: ${command}` });
  }
});

// Socket.io - reaaliaikainen viestintä
const userSockets = new Map(); // userId -> Set of socket ids
const socketUsers = new Map(); // socketId -> userId

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Autentikaatio vaaditaan'));

  try {
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Virheellinen token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  const workspaceId = socket.user.workspace_id;

  // Rekisteröi socket
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);
  socketUsers.set(socket.id, userId);

  // Merkitse online
  db.prepare('UPDATE users SET is_online = 1 WHERE id = ?').run(userId);
  socket.to(`workspace:${workspaceId}`).emit('user:online', { userId });

  // Liity workspace-huoneeseen
  socket.join(`workspace:${workspaceId}`);

  // Liity kanaviin
  const channels = db.prepare('SELECT channel_id FROM channel_members WHERE user_id = ?').all(userId);
  for (const { channel_id } of channels) {
    socket.join(`channel:${channel_id}`);
  }

  console.log(`Käyttäjä ${userId} yhdistyi (socket: ${socket.id})`);

  // Lähetä viesti
  socket.on('message:send', async (data, callback) => {
    const { channel_id, content, parent_id } = data;

    if (!content?.trim() || !channel_id) {
      return callback?.({ error: 'Kanava ja sisältö vaaditaan' });
    }

    try {
      const isMember = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel_id, userId);
      if (!isMember) return callback?.({ error: 'Et ole kanavan jäsen' });

      let processedContent = content.trim();

      // Slash-komento viestissä
      if (processedContent.startsWith('/me ')) {
        processedContent = `_${processedContent.slice(4)}_`;
      }

      const result = db.prepare(
        `INSERT INTO messages (channel_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)`
      ).run(channel_id, userId, processedContent, parent_id || null);

      const message = db.prepare(`
        SELECT m.*, u.display_name as author_name, u.avatar as author_avatar,
          u.status_emoji as author_status_emoji
        FROM messages m JOIN users u ON m.user_id = u.id
        WHERE m.id = ?
      `).get(result.lastInsertRowid);

      message.reactions = [];
      message.files = [];
      message.reply_count = 0;

      // Lähetä kaikille kanavan jäsenille
      if (parent_id) {
        io.to(`channel:${channel_id}`).emit('message:new_reply', { message, channel_id });
      } else {
        io.to(`channel:${channel_id}`).emit('message:new', { message, channel_id });
      }

      // Maininnat @käyttäjä
      const mentionRegex = /@(\w+)/g;
      const mentions = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
      }

      for (const mentionName of mentions) {
        const mentionedUser = db.prepare('SELECT id FROM users WHERE workspace_id = ? AND (display_name LIKE ? OR username LIKE ?)').get(workspaceId, mentionName, mentionName);
        if (mentionedUser && mentionedUser.id !== userId) {
          db.prepare('INSERT INTO notifications (user_id, type, message_id, channel_id, from_user_id) VALUES (?, ?, ?, ?, ?)').run(mentionedUser.id, 'mention', result.lastInsertRowid, channel_id, userId);

          const sockets = userSockets.get(mentionedUser.id);
          if (sockets) {
            const sender = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
            sockets.forEach(sid => {
              io.to(sid).emit('notification:new', {
                type: 'mention',
                from: sender?.display_name,
                channel_id,
                message_id: result.lastInsertRowid,
                content: processedContent.substring(0, 100)
              });
            });
          }
        }
      }

      callback?.({ ok: true, message });
    } catch (err) {
      console.error('Virhe viestin lähetyksessä:', err);
      callback?.({ error: 'Virhe viestin lähetyksessä' });
    }
  });

  // Kirjoitusilmoitus
  socket.on('typing:start', (data) => {
    const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
    socket.to(`channel:${data.channel_id}`).emit('typing:start', {
      userId,
      displayName: user?.display_name,
      channel_id: data.channel_id
    });
  });

  socket.on('typing:stop', (data) => {
    socket.to(`channel:${data.channel_id}`).emit('typing:stop', {
      userId,
      channel_id: data.channel_id
    });
  });

  // Reaktio
  socket.on('reaction:toggle', (data, callback) => {
    const { message_id, emoji } = data;
    try {
      const message = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(message_id);
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(message_id, userId, emoji);
      let action;
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(message_id, userId, emoji);
        action = 'removed';
      } else {
        db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(message_id, userId, emoji);
        action = 'added';
      }

      const reactions = db.prepare(`
        SELECT emoji, COUNT(*) as count,
          MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) as reacted_by_me
        FROM reactions r WHERE r.message_id = ?
        GROUP BY emoji
      `).all(userId, message_id);

      io.to(`channel:${message.channel_id}`).emit('reaction:updated', {
        message_id, reactions, action, emoji, userId, channel_id: message.channel_id
      });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: 'Virhe reaktion lisäämisessä' });
    }
  });

  // Muokkaa viesti
  socket.on('message:edit', (data, callback) => {
    const { message_id, content } = data;
    if (!content?.trim()) return callback?.({ error: 'Sisältö vaaditaan' });

    try {
      const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(message_id, userId);
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      db.prepare('UPDATE messages SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content.trim(), message_id);

      io.to(`channel:${message.channel_id}`).emit('message:edited', {
        message_id,
        content: content.trim(),
        channel_id: message.channel_id,
        is_edited: true
      });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: 'Virhe viestin muokkaamisessa' });
    }
  });

  // Poista viesti
  socket.on('message:delete', (data, callback) => {
    const { message_id } = data;
    try {
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      const userRole = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
      if (message.user_id !== userId && userRole?.role !== 'admin') {
        return callback?.({ error: 'Ei oikeuksia' });
      }

      db.prepare('UPDATE messages SET is_deleted = 1, content = \'[Viesti poistettu]\' WHERE id = ?').run(message_id);

      io.to(`channel:${message.channel_id}`).emit('message:deleted', {
        message_id,
        channel_id: message.channel_id
      });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: 'Virhe' });
    }
  });

  // Liity uuteen kanavaan reaaliaikaisesti
  socket.on('channel:join', (data) => {
    socket.join(`channel:${data.channel_id}`);
  });

  // Käyttäjä poistu
  socket.on('disconnect', () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
        db.prepare('UPDATE users SET is_online = 0 WHERE id = ?').run(userId);
        io.to(`workspace:${workspaceId}`).emit('user:offline', { userId });
      }
    }
    socketUsers.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Loysa-palvelin käynnissä portissa ${PORT}`);
});

module.exports = { app, io };
