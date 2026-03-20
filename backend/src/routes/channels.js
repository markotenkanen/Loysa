const express = require('express');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Hae kaikki käyttäjän kanavat
router.get('/', authenticateToken, (req, res) => {
  try {
    const channels = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
        cm.last_read_at,
        (SELECT COUNT(*) FROM messages m
         WHERE m.channel_id = c.id AND m.is_deleted = 0
         AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) as unread_count
      FROM channels c
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.user_id = ? AND c.is_archived = 0
      ORDER BY c.is_dm ASC, c.name ASC
    `).all(req.user.id);

    res.json(channels);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae kaikki workspace-kanavat (joihin voi liittyä)
router.get('/browse', authenticateToken, (req, res) => {
  try {
    const channels = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count,
        EXISTS(SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?) as is_member
      FROM channels c
      WHERE c.workspace_id = ? AND c.is_private = 0 AND c.is_dm = 0 AND c.is_archived = 0
      ORDER BY member_count DESC
    `).all(req.user.id, req.user.workspace_id);

    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Luo uusi kanava
router.post('/', authenticateToken, (req, res) => {
  const { name, description, is_private } = req.body;

  if (!name) return res.status(400).json({ error: 'Kanavan nimi vaaditaan' });

  const cleanName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  try {
    const existing = db.prepare('SELECT id FROM channels WHERE workspace_id = ? AND name = ?').get(req.user.workspace_id, cleanName);
    if (existing) return res.status(409).json({ error: 'Kanava on jo olemassa' });

    const channel = db.prepare(
      `INSERT INTO channels (workspace_id, name, description, is_private, created_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(req.user.workspace_id, cleanName, description || '', is_private ? 1 : 0, req.user.id);

    db.prepare('INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES (?, ?, 1)').run(channel.lastInsertRowid, req.user.id);

    const newChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.lastInsertRowid);
    res.status(201).json(newChannel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae yksittäinen kanava
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const channel = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
      FROM channels c WHERE c.id = ?
    `).get(req.params.id);

    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });

    const isMember = db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
    if (!isMember && channel.is_private) return res.status(403).json({ error: 'Ei pääsyä yksityiseen kanavaan' });

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Liity kanavalle
router.post('/:id/join', authenticateToken, (req, res) => {
  try {
    const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND workspace_id = ?').get(req.params.id, req.user.workspace_id);
    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });
    if (channel.is_private) return res.status(403).json({ error: 'Et voi liittyä yksityiseen kanavaan ilman kutsua' });

    db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(channel.id, req.user.id);
    res.json({ message: 'Liityit kanavalle' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Poistu kanavalta
router.delete('/:id/leave', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ message: 'Poistuit kanavalta' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae kanavan jäsenet
router.get('/:id/members', authenticateToken, (req, res) => {
  try {
    const members = db.prepare(`
      SELECT u.id, u.display_name, u.avatar, u.status_emoji, u.status_text, u.is_online, u.is_away, cm.is_admin
      FROM users u
      JOIN channel_members cm ON u.id = cm.user_id
      WHERE cm.channel_id = ?
      ORDER BY u.display_name ASC
    `).all(req.params.id);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Päivitä kanavan tiedot
router.patch('/:id', authenticateToken, (req, res) => {
  const { name, description, topic } = req.body;
  try {
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Kanavaa ei löydy' });

    const isAdmin = db.prepare('SELECT is_admin FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, req.user.id);
    if (!isAdmin || !isAdmin.is_admin) {
      const userRole = db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
      if (userRole?.role !== 'admin') return res.status(403).json({ error: 'Ei oikeuksia' });
    }

    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (topic !== undefined) { updates.push('topic = ?'); values.push(topic); }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae tai luo DM-kanava
router.post('/dm/:userId', authenticateToken, (req, res) => {
  try {
    const targetUser = db.prepare('SELECT id, display_name FROM users WHERE id = ? AND workspace_id = ?').get(req.params.userId, req.user.workspace_id);
    if (!targetUser) return res.status(404).json({ error: 'Käyttäjää ei löydy' });

    // Tarkista olemassa oleva DM
    const existing = db.prepare(`
      SELECT c.* FROM channels c
      WHERE c.is_dm = 1 AND c.workspace_id = ?
      AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?)
      AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = ?)
      AND (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) = 2
    `).get(req.user.workspace_id, req.user.id, targetUser.id);

    if (existing) return res.json(existing);

    const channel = db.prepare(
      `INSERT INTO channels (workspace_id, name, is_dm, is_private, created_by)
       VALUES (?, ?, 1, 1, ?)`
    ).run(req.user.workspace_id, `dm-${req.user.id}-${targetUser.id}`, req.user.id);

    db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(channel.lastInsertRowid, req.user.id);
    db.prepare('INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(channel.lastInsertRowid, targetUser.id);

    const newChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.lastInsertRowid);
    res.status(201).json(newChannel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Päivitä viimeksi luettu
router.post('/:id/read', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE channel_members SET last_read_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae pinnatut viestit
router.get('/:id/pins', authenticateToken, (req, res) => {
  try {
    const pins = db.prepare(`
      SELECT p.*, m.content, m.created_at as message_created_at,
        u.display_name as author_name, u.avatar as author_avatar,
        pu.display_name as pinned_by_name
      FROM pins p
      JOIN messages m ON p.message_id = m.id
      JOIN users u ON m.user_id = u.id
      JOIN users pu ON p.pinned_by = pu.id
      WHERE p.channel_id = ?
      ORDER BY p.created_at DESC
    `).all(req.params.id);
    res.json(pins);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
