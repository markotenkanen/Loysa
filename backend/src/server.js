require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { pool, initializeDatabase } = require('./db/database');
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
app.post('/api/commands', require('./middleware/auth').authenticateToken, async (req, res) => {
  const { command, text, channel_id } = req.body;
  switch (command) {
    case '/me':
      res.json({ type: 'me_action', text: text || '' });
      break;
    case '/away':
      await pool.query('UPDATE users SET is_away = 1 WHERE id = $1', [req.user.id]);
      res.json({ type: 'status', text: 'Olet nyt poissa' });
      break;
    case '/active':
      await pool.query('UPDATE users SET is_away = 0 WHERE id = $1', [req.user.id]);
      res.json({ type: 'status', text: 'Olet nyt aktiivinen' });
      break;
    case '/topic':
      if (channel_id && text) {
        await pool.query('UPDATE channels SET topic = $1 WHERE id = $2', [text, channel_id]);
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

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  const workspaceId = socket.user.workspace_id;

  // Rekisteröi socket
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);
  socketUsers.set(socket.id, userId);

  // Merkitse online
  await pool.query('UPDATE users SET is_online = 1 WHERE id = $1', [userId]);
  socket.to(`workspace:${workspaceId}`).emit('user:online', { userId });

  // Liity workspace-huoneeseen
  socket.join(`workspace:${workspaceId}`);

  // Liity kanaviin
  const channelsResult = await pool.query('SELECT channel_id FROM channel_members WHERE user_id = $1', [userId]);
  for (const { channel_id } of channelsResult.rows) {
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
      const memberResult = await pool.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channel_id, userId]);
      if (!memberResult.rows[0]) return callback?.({ error: 'Et ole kanavan jäsen' });

      let processedContent = content.trim();

      // Slash-komento viestissä
      if (processedContent.startsWith('/me ')) {
        processedContent = `_${processedContent.slice(4)}_`;
      }

      const insertResult = await pool.query(
        `INSERT INTO messages (channel_id, user_id, content, parent_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [channel_id, userId, processedContent, parent_id || null]
      );
      const messageId = insertResult.rows[0].id;

      const msgResult = await pool.query(`
        SELECT m.*, u.display_name as author_name, u.avatar as author_avatar,
          u.status_emoji as author_status_emoji
        FROM messages m JOIN users u ON m.user_id = u.id
        WHERE m.id = $1
      `, [messageId]);

      const message = msgResult.rows[0];
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
        const mentionResult = await pool.query('SELECT id FROM users WHERE workspace_id = $1 AND (display_name ILIKE $2 OR username ILIKE $2)', [workspaceId, mentionName]);
        const mentionedUser = mentionResult.rows[0];
        if (mentionedUser && mentionedUser.id !== userId) {
          await pool.query('INSERT INTO notifications (user_id, type, message_id, channel_id, from_user_id) VALUES ($1, $2, $3, $4, $5)', [mentionedUser.id, 'mention', messageId, channel_id, userId]);

          const sockets = userSockets.get(mentionedUser.id);
          if (sockets) {
            const senderResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
            sockets.forEach(sid => {
              io.to(sid).emit('notification:new', {
                type: 'mention',
                from: senderResult.rows[0]?.display_name,
                channel_id,
                message_id: messageId,
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
  socket.on('typing:start', async (data) => {
    const userResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [userId]);
    socket.to(`channel:${data.channel_id}`).emit('typing:start', {
      userId,
      displayName: userResult.rows[0]?.display_name,
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
  socket.on('reaction:toggle', async (data, callback) => {
    const { message_id, emoji } = data;
    try {
      const msgResult = await pool.query('SELECT channel_id FROM messages WHERE id = $1', [message_id]);
      const message = msgResult.rows[0];
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      const existingResult = await pool.query('SELECT 1 FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [message_id, userId, emoji]);
      let action;
      if (existingResult.rows[0]) {
        await pool.query('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [message_id, userId, emoji]);
        action = 'removed';
      } else {
        await pool.query('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [message_id, userId, emoji]);
        action = 'added';
      }

      const reactionsResult = await pool.query(`
        SELECT emoji, COUNT(*) as count,
          MAX(CASE WHEN r.user_id = $1 THEN 1 ELSE 0 END) as reacted_by_me
        FROM reactions r WHERE r.message_id = $2
        GROUP BY emoji
      `, [userId, message_id]);

      io.to(`channel:${message.channel_id}`).emit('reaction:updated', {
        message_id, reactions: reactionsResult.rows, action, emoji, userId, channel_id: message.channel_id
      });

      callback?.({ ok: true });
    } catch (err) {
      callback?.({ error: 'Virhe reaktion lisäämisessä' });
    }
  });

  // Muokkaa viesti
  socket.on('message:edit', async (data, callback) => {
    const { message_id, content } = data;
    if (!content?.trim()) return callback?.({ error: 'Sisältö vaaditaan' });

    try {
      const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1 AND user_id = $2', [message_id, userId]);
      const message = msgResult.rows[0];
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      await pool.query('UPDATE messages SET content = $1, is_edited = 1, updated_at = NOW() WHERE id = $2', [content.trim(), message_id]);

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
  socket.on('message:delete', async (data, callback) => {
    const { message_id } = data;
    try {
      const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [message_id]);
      const message = msgResult.rows[0];
      if (!message) return callback?.({ error: 'Viestiä ei löydy' });

      const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
      if (message.user_id !== userId && roleResult.rows[0]?.role !== 'admin') {
        return callback?.({ error: 'Ei oikeuksia' });
      }

      await pool.query("UPDATE messages SET is_deleted = 1, content = '[Viesti poistettu]' WHERE id = $1", [message_id]);

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
  socket.on('disconnect', async () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
        await pool.query('UPDATE users SET is_online = 0 WHERE id = $1', [userId]);
        io.to(`workspace:${workspaceId}`).emit('user:offline', { userId });
      }
    }
    socketUsers.delete(socket.id);
  });
});

// Alusta tietokanta ja käynnistä palvelin
initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Loysa-palvelin käynnissä portissa ${PORT}`);
  });
}).catch(err => {
  console.error('Tietokannan alustus epäonnistui:', err);
  process.exit(1);
});

module.exports = { app, io };
