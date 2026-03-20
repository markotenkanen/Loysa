const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function getMessages(channelId, userId, limit = 50, before = null) {
  let query = `
    SELECT m.*,
      u.display_name as author_name, u.avatar as author_avatar,
      u.status_emoji as author_status_emoji,
      (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id AND r.is_deleted = 0) as reply_count,
      (SELECT COUNT(*) FROM saved_messages WHERE message_id = m.id AND user_id = ?) as is_saved,
      (SELECT COUNT(*) FROM pins WHERE message_id = m.id AND channel_id = m.channel_id) as is_pinned
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.channel_id = ? AND m.is_deleted = 0 AND m.parent_id IS NULL
  `;
  const params = [userId, channelId];

  if (before) {
    query += ' AND m.created_at < ?';
    params.push(before);
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const messages = db.prepare(query).all(...params).reverse();

  // Lisää reaktiot
  for (const msg of messages) {
    msg.reactions = db.prepare(`
      SELECT emoji, COUNT(*) as count,
        GROUP_CONCAT(u.display_name) as users,
        MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) as reacted_by_me
      FROM reactions r
      JOIN users u ON r.user_id = u.id
      WHERE r.message_id = ?
      GROUP BY emoji
    `).all(userId, msg.id);

    // Lisää tiedostot
    msg.files = db.prepare('SELECT * FROM files WHERE message_id = ?').all(msg.id);
  }

  return messages;
}

// Hae kanavan viestit
router.get('/channel/:channelId', authenticateToken, (req, res) => {
  try {
    const isMember = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(req.params.channelId, req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Ei pääsyä kanavalle' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before || null;

    const messages = getMessages(req.params.channelId, req.user.id, limit, before);
    const hasMore = messages.length === limit;

    res.json({ messages, hasMore });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae viestiketju
router.get('/:id/thread', authenticateToken, (req, res) => {
  try {
    const parent = db.prepare(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar
      FROM messages m JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!parent) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const replies = db.prepare(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.parent_id = ? AND m.is_deleted = 0
      ORDER BY m.created_at ASC
    `).all(req.params.id);

    for (const reply of replies) {
      reply.reactions = db.prepare(`
        SELECT emoji, COUNT(*) as count,
          MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) as reacted_by_me
        FROM reactions r WHERE r.message_id = ?
        GROUP BY emoji
      `).all(req.user.id, reply.id);
    }

    res.json({ parent, replies });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Muokkaa viestiä
router.patch('/:id', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Viesti ei voi olla tyhjä' });

  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!message) return res.status(404).json({ error: 'Viestiä ei löydy tai sinulla ei ole oikeuksia muokata sitä' });

    db.prepare('UPDATE messages SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content.trim(), req.params.id);
    const updated = db.prepare('SELECT m.*, u.display_name as author_name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Poista viesti
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    if (message.user_id !== req.user.id && user?.role !== 'admin') {
      return res.status(403).json({ error: 'Ei oikeuksia poistaa viestiä' });
    }

    db.prepare('UPDATE messages SET is_deleted = 1, content = \'[Viesti poistettu]\' WHERE id = ?').run(req.params.id);
    res.json({ message: 'Viesti poistettu' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Lisää tai poista reaktio
router.post('/:id/reactions', authenticateToken, (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji vaaditaan' });

  try {
    const existing = db.prepare('SELECT * FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(req.params.id, req.user.id, emoji);

    if (existing) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(req.params.id, req.user.id, emoji);
      res.json({ action: 'removed' });
    } else {
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(req.params.id, req.user.id, emoji);
      res.json({ action: 'added' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Pinnaa viesti
router.post('/:id/pin', authenticateToken, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const existing = db.prepare('SELECT 1 FROM pins WHERE message_id = ? AND channel_id = ?').get(req.params.id, message.channel_id);
    if (existing) {
      db.prepare('DELETE FROM pins WHERE message_id = ? AND channel_id = ?').run(req.params.id, message.channel_id);
      res.json({ action: 'unpinned' });
    } else {
      db.prepare('INSERT INTO pins (channel_id, message_id, pinned_by) VALUES (?, ?, ?)').run(message.channel_id, req.params.id, req.user.id);
      res.json({ action: 'pinned' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Tallenna / poista tallennus
router.post('/:id/save', authenticateToken, (req, res) => {
  try {
    const existing = db.prepare('SELECT 1 FROM saved_messages WHERE message_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (existing) {
      db.prepare('DELETE FROM saved_messages WHERE message_id = ? AND user_id = ?').run(req.params.id, req.user.id);
      res.json({ action: 'unsaved' });
    } else {
      db.prepare('INSERT INTO saved_messages (message_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
      res.json({ action: 'saved' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae tallennetut viestit
router.get('/saved', authenticateToken, (req, res) => {
  try {
    const saved = db.prepare(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar,
        c.name as channel_name, sm.saved_at
      FROM saved_messages sm
      JOIN messages m ON sm.message_id = m.id
      JOIN users u ON m.user_id = u.id
      JOIN channels c ON m.channel_id = c.id
      WHERE sm.user_id = ? AND m.is_deleted = 0
      ORDER BY sm.saved_at DESC
    `).all(req.user.id);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Haku
router.get('/search', authenticateToken, (req, res) => {
  const { q, channel_id } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Hakusana vaaditaan' });

  try {
    let query = `
      SELECT m.*, u.display_name as author_name, c.name as channel_name
      FROM messages m
      JOIN users u ON m.user_id = u.id
      JOIN channels c ON m.channel_id = c.id
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.user_id = ? AND m.is_deleted = 0
        AND m.content LIKE ?
    `;
    const params = [req.user.id, `%${q}%`];

    if (channel_id) {
      query += ' AND m.channel_id = ?';
      params.push(channel_id);
    }

    query += ' ORDER BY m.created_at DESC LIMIT 50';

    const results = db.prepare(query).all(...params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
