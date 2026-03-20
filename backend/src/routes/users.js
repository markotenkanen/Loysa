const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Hae workspace-käyttäjät
router.get('/', authenticateToken, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, display_name, avatar, status_emoji, status_text, is_online, is_away, role
      FROM users WHERE workspace_id = ?
      ORDER BY display_name ASC
    `).all(req.user.workspace_id);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Päivitä profiili
router.patch('/me', authenticateToken, async (req, res) => {
  const { display_name, status_emoji, status_text, avatar } = req.body;
  try {
    const updates = [];
    const values = [];

    if (display_name !== undefined) { updates.push('display_name = ?'); values.push(display_name); }
    if (status_emoji !== undefined) { updates.push('status_emoji = ?'); values.push(status_emoji); }
    if (status_text !== undefined) { updates.push('status_text = ?'); values.push(status_text); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }

    if (updates.length > 0) {
      values.push(req.user.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const user = db.prepare('SELECT id, workspace_id, email, display_name, avatar, status_emoji, status_text, role, is_online, is_away FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Vaihda salasana
router.patch('/me/password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Molemmat salasanat vaaditaan' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Uuden salasanan on oltava vähintään 8 merkkiä' });

  try {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Nykyinen salasana on väärä' });

    const newHash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
    res.json({ message: 'Salasana vaihdettu' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Aseta poissa-tila
router.post('/me/away', authenticateToken, (req, res) => {
  const { is_away } = req.body;
  try {
    db.prepare('UPDATE users SET is_away = ? WHERE id = ?').run(is_away ? 1 : 0, req.user.id);
    res.json({ is_away: !!is_away });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae ilmoitukset
router.get('/me/notifications', authenticateToken, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT n.*, u.display_name as from_user_name, c.name as channel_name,
        m.content as message_preview
      FROM notifications n
      LEFT JOIN users u ON n.from_user_id = u.id
      LEFT JOIN channels c ON n.channel_id = c.id
      LEFT JOIN messages m ON n.message_id = m.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `).all(req.user.id);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Merkitse ilmoitukset luetuiksi
router.post('/me/notifications/read', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae käyttäjä id:llä
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, display_name, avatar, status_emoji, status_text, is_online, is_away, role FROM users WHERE id = ? AND workspace_id = ?').get(req.params.id, req.user.workspace_id);
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
