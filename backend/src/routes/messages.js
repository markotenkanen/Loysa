const express = require('express');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

async function getMessages(channelId, userId, limit = 50, before = null) {
  let query = `
    SELECT m.*,
      u.display_name as author_name, u.avatar as author_avatar,
      u.status_emoji as author_status_emoji,
      (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id AND r.is_deleted = 0) as reply_count,
      (SELECT COUNT(*) FROM saved_messages WHERE message_id = m.id AND user_id = $1) as is_saved,
      (SELECT COUNT(*) FROM pins WHERE message_id = m.id AND channel_id = m.channel_id) as is_pinned
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.channel_id = $2 AND m.is_deleted = 0 AND m.parent_id IS NULL
  `;
  const params = [userId, channelId];
  let paramIdx = 3;

  if (before) {
    query += ` AND m.created_at < $${paramIdx++}`;
    params.push(before);
  }

  query += ` ORDER BY m.created_at DESC LIMIT $${paramIdx}`;
  params.push(limit);

  const result = await pool.query(query, params);
  const messages = result.rows.reverse();

  // Lisää reaktiot ja tiedostot
  for (const msg of messages) {
    const reactionsResult = await pool.query(`
      SELECT emoji, COUNT(*) as count,
        STRING_AGG(u.display_name, ',') as users,
        MAX(CASE WHEN r.user_id = $1 THEN 1 ELSE 0 END) as reacted_by_me
      FROM reactions r
      JOIN users u ON r.user_id = u.id
      WHERE r.message_id = $2
      GROUP BY emoji
    `, [userId, msg.id]);
    msg.reactions = reactionsResult.rows;

    const filesResult = await pool.query('SELECT * FROM files WHERE message_id = $1', [msg.id]);
    msg.files = filesResult.rows;
  }

  return messages;
}

// Hae kanavan viestit
router.get('/channel/:channelId', authenticateToken, async (req, res) => {
  try {
    const memberResult = await pool.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.channelId, req.user.id]);
    if (!memberResult.rows[0]) return res.status(403).json({ error: 'Ei pääsyä kanavalle' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before || null;

    const messages = await getMessages(req.params.channelId, req.user.id, limit, before);
    const hasMore = messages.length === limit;

    res.json({ messages, hasMore });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae viestiketju
router.get('/:id/thread', authenticateToken, async (req, res) => {
  try {
    const parentResult = await pool.query(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar
      FROM messages m JOIN users u ON m.user_id = u.id
      WHERE m.id = $1
    `, [req.params.id]);

    const parent = parentResult.rows[0];
    if (!parent) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const repliesResult = await pool.query(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.parent_id = $1 AND m.is_deleted = 0
      ORDER BY m.created_at ASC
    `, [req.params.id]);

    for (const reply of repliesResult.rows) {
      const reactionsResult = await pool.query(`
        SELECT emoji, COUNT(*) as count,
          MAX(CASE WHEN r.user_id = $1 THEN 1 ELSE 0 END) as reacted_by_me
        FROM reactions r WHERE r.message_id = $2
        GROUP BY emoji
      `, [req.user.id, reply.id]);
      reply.reactions = reactionsResult.rows;
    }

    res.json({ parent, replies: repliesResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Muokkaa viestiä
router.patch('/:id', authenticateToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Viesti ei voi olla tyhjä' });

  try {
    const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!msgResult.rows[0]) return res.status(404).json({ error: 'Viestiä ei löydy tai sinulla ei ole oikeuksia muokata sitä' });

    await pool.query('UPDATE messages SET content = $1, is_edited = 1, updated_at = NOW() WHERE id = $2', [content.trim(), req.params.id]);
    const updatedResult = await pool.query('SELECT m.*, u.display_name as author_name FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = $1', [req.params.id]);
    res.json(updatedResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Poista viesti
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
    const message = msgResult.rows[0];
    if (!message) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (message.user_id !== req.user.id && userResult.rows[0]?.role !== 'admin') {
      return res.status(403).json({ error: 'Ei oikeuksia poistaa viestiä' });
    }

    await pool.query("UPDATE messages SET is_deleted = 1, content = '[Viesti poistettu]' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Viesti poistettu' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Lisää tai poista reaktio
router.post('/:id/reactions', authenticateToken, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji vaaditaan' });

  try {
    const existingResult = await pool.query('SELECT * FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [req.params.id, req.user.id, emoji]);

    if (existingResult.rows[0]) {
      await pool.query('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [req.params.id, req.user.id, emoji]);
      res.json({ action: 'removed' });
    } else {
      await pool.query('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [req.params.id, req.user.id, emoji]);
      res.json({ action: 'added' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Pinnaa viesti
router.post('/:id/pin', authenticateToken, async (req, res) => {
  try {
    const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
    const message = msgResult.rows[0];
    if (!message) return res.status(404).json({ error: 'Viestiä ei löydy' });

    const existingResult = await pool.query('SELECT 1 FROM pins WHERE message_id = $1 AND channel_id = $2', [req.params.id, message.channel_id]);
    if (existingResult.rows[0]) {
      await pool.query('DELETE FROM pins WHERE message_id = $1 AND channel_id = $2', [req.params.id, message.channel_id]);
      res.json({ action: 'unpinned' });
    } else {
      await pool.query('INSERT INTO pins (channel_id, message_id, pinned_by) VALUES ($1, $2, $3)', [message.channel_id, req.params.id, req.user.id]);
      res.json({ action: 'pinned' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Tallenna / poista tallennus
router.post('/:id/save', authenticateToken, async (req, res) => {
  try {
    const existingResult = await pool.query('SELECT 1 FROM saved_messages WHERE message_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (existingResult.rows[0]) {
      await pool.query('DELETE FROM saved_messages WHERE message_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      res.json({ action: 'unsaved' });
    } else {
      await pool.query('INSERT INTO saved_messages (message_id, user_id) VALUES ($1, $2)', [req.params.id, req.user.id]);
      res.json({ action: 'saved' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae tallennetut viestit
router.get('/saved', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, u.display_name as author_name, u.avatar as author_avatar,
        c.name as channel_name, sm.saved_at
      FROM saved_messages sm
      JOIN messages m ON sm.message_id = m.id
      JOIN users u ON m.user_id = u.id
      JOIN channels c ON m.channel_id = c.id
      WHERE sm.user_id = $1 AND m.is_deleted = 0
      ORDER BY sm.saved_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Haku
router.get('/search', authenticateToken, async (req, res) => {
  const { q, channel_id } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'Hakusana vaaditaan' });

  try {
    let query = `
      SELECT m.*, u.display_name as author_name, c.name as channel_name
      FROM messages m
      JOIN users u ON m.user_id = u.id
      JOIN channels c ON m.channel_id = c.id
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.user_id = $1 AND m.is_deleted = 0
        AND m.content ILIKE $2
    `;
    const params = [req.user.id, `%${q}%`];
    let paramIdx = 3;

    if (channel_id) {
      query += ` AND m.channel_id = $${paramIdx++}`;
      params.push(channel_id);
    }

    query += ' ORDER BY m.created_at DESC LIMIT 50';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
