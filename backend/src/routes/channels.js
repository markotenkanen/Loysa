const express = require('express');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Hae kaikki käyttäjän kanavat
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
        cm.last_read_at,
        (SELECT COUNT(*) FROM messages m
         WHERE m.channel_id = c.id AND m.is_deleted = 0
         AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) as unread_count
      FROM channels c
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.user_id = $1 AND c.is_archived = 0
      ORDER BY c.is_dm ASC, c.name ASC
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae kaikki workspace-kanavat (joihin voi liittyä)
router.get('/browse', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
        EXISTS(SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $1) as is_member
      FROM channels c
      WHERE c.workspace_id = $2 AND c.is_private = 0 AND c.is_dm = 0 AND c.is_archived = 0
      ORDER BY member_count DESC
    `, [req.user.id, req.user.workspace_id]);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Luo uusi kanava
router.post('/', authenticateToken, async (req, res) => {
  const { name, description, is_private } = req.body;

  if (!name) return res.status(400).json({ error: 'Kanavan nimi vaaditaan' });

  const cleanName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  try {
    const existingResult = await pool.query('SELECT id FROM channels WHERE workspace_id = $1 AND name = $2', [req.user.workspace_id, cleanName]);
    if (existingResult.rows[0]) return res.status(409).json({ error: 'Kanava on jo olemassa' });

    const channelResult = await pool.query(
      `INSERT INTO channels (workspace_id, name, description, is_private, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.workspace_id, cleanName, description || '', is_private ? 1 : 0, req.user.id]
    );
    const channelId = channelResult.rows[0].id;

    await pool.query('INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES ($1, $2, 1)', [channelId, req.user.id]);

    const newChannelResult = await pool.query('SELECT * FROM channels WHERE id = $1', [channelId]);
    res.status(201).json(newChannelResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae yksittäinen kanava
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const channelResult = await pool.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
      FROM channels c WHERE c.id = $1
    `, [req.params.id]);

    const channel = channelResult.rows[0];
    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });

    const memberResult = await pool.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channel.id, req.user.id]);
    if (!memberResult.rows[0] && channel.is_private) return res.status(403).json({ error: 'Ei pääsyä yksityiseen kanavaan' });

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Liity kanavalle
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    const channelResult = await pool.query('SELECT * FROM channels WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.workspace_id]);
    const channel = channelResult.rows[0];
    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });
    if (channel.is_private) return res.status(403).json({ error: 'Et voi liittyä yksityiseen kanavaan ilman kutsua' });

    await pool.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [channel.id, req.user.id]);
    res.json({ message: 'Liityit kanavalle' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Poistu kanavalta
router.delete('/:id/leave', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Poistuit kanavalta' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae kanavan jäsenet
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.display_name, u.avatar, u.status_emoji, u.status_text, u.is_online, u.is_away, cm.is_admin
      FROM users u
      JOIN channel_members cm ON u.id = cm.user_id
      WHERE cm.channel_id = $1
      ORDER BY u.display_name ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Päivitä kanavan tiedot
router.patch('/:id', authenticateToken, async (req, res) => {
  const { name, description, topic } = req.body;
  try {
    const channelResult = await pool.query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
    const channel = channelResult.rows[0];
    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });

    const adminResult = await pool.query('SELECT is_admin FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channel.id, req.user.id]);
    const isAdmin = adminResult.rows[0];
    if (!isAdmin || !isAdmin.is_admin) {
      const roleResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
      if (roleResult.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Ei oikeuksia' });
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;
    if (name !== undefined) { updates.push(`name = $${paramIdx++}`); values.push(name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')); }
    if (description !== undefined) { updates.push(`description = $${paramIdx++}`); values.push(description); }
    if (topic !== undefined) { updates.push(`topic = $${paramIdx++}`); values.push(topic); }

    if (updates.length > 0) {
      values.push(req.params.id);
      await pool.query(`UPDATE channels SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    const updatedResult = await pool.query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
    res.json(updatedResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae tai luo DM-kanava
router.post('/dm/:userId', authenticateToken, async (req, res) => {
  try {
    const targetResult = await pool.query('SELECT id, display_name FROM users WHERE id = $1 AND workspace_id = $2', [req.params.userId, req.user.workspace_id]);
    const targetUser = targetResult.rows[0];
    if (!targetUser) return res.status(404).json({ error: 'Käyttäjää ei löydy' });

    // Tarkista olemassa oleva DM
    const existingResult = await pool.query(`
      SELECT c.* FROM channels c
      WHERE c.is_dm = 1 AND c.workspace_id = $1
      AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $2)
      AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $3)
      AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2
    `, [req.user.workspace_id, req.user.id, targetUser.id]);

    if (existingResult.rows[0]) return res.json(existingResult.rows[0]);

    const channelResult = await pool.query(
      `INSERT INTO channels (workspace_id, name, is_dm, is_private, created_by)
       VALUES ($1, $2, 1, 1, $3) RETURNING id`,
      [req.user.workspace_id, `dm-${req.user.id}-${targetUser.id}`, req.user.id]
    );
    const channelId = channelResult.rows[0].id;

    await pool.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)', [channelId, req.user.id]);
    await pool.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)', [channelId, targetUser.id]);

    const newChannelResult = await pool.query('SELECT * FROM channels WHERE id = $1', [channelId]);
    res.status(201).json(newChannelResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Päivitä viimeksi luettu
router.post('/:id/read', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE channel_members SET last_read_at = NOW() WHERE channel_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae pinnatut viestit
router.get('/:id/pins', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, m.content, m.created_at as message_created_at,
        u.display_name as author_name, u.avatar as author_avatar,
        pu.display_name as pinned_by_name
      FROM pins p
      JOIN messages m ON p.message_id = m.id
      JOIN users u ON m.user_id = u.id
      JOIN users pu ON p.pinned_by = pu.id
      WHERE p.channel_id = $1
      ORDER BY p.created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
