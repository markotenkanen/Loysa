const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Hae workspace-käyttäjät
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, display_name, avatar, status_emoji, status_text, is_online, is_away, role
      FROM users WHERE workspace_id = $1
      ORDER BY display_name ASC
    `, [req.user.workspace_id]);
    res.json(result.rows);
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
    let paramIdx = 1;

    if (display_name !== undefined) { updates.push(`display_name = $${paramIdx++}`); values.push(display_name); }
    if (status_emoji !== undefined) { updates.push(`status_emoji = $${paramIdx++}`); values.push(status_emoji); }
    if (status_text !== undefined) { updates.push(`status_text = $${paramIdx++}`); values.push(status_text); }
    if (avatar !== undefined) { updates.push(`avatar = $${paramIdx++}`); values.push(avatar); }

    if (updates.length > 0) {
      values.push(req.user.id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    const result = await pool.query('SELECT id, workspace_id, email, display_name, avatar, status_emoji, status_text, role, is_online, is_away FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
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
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Nykyinen salasana on väärä' });

    const newHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    res.json({ message: 'Salasana vaihdettu' });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Aseta poissa-tila
router.post('/me/away', authenticateToken, async (req, res) => {
  const { is_away } = req.body;
  try {
    await pool.query('UPDATE users SET is_away = $1 WHERE id = $2', [is_away ? 1 : 0, req.user.id]);
    res.json({ is_away: !!is_away });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae ilmoitukset
router.get('/me/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, u.display_name as from_user_name, c.name as channel_name,
        m.content as message_preview
      FROM notifications n
      LEFT JOIN users u ON n.from_user_id = u.id
      LEFT JOIN channels c ON n.channel_id = c.id
      LEFT JOIN messages m ON n.message_id = m.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Merkitse ilmoitukset luetuiksi
router.post('/me/notifications/read', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae käyttäjä id:llä
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, display_name, avatar, status_emoji, status_text, is_online, is_away, role FROM users WHERE id = $1 AND workspace_id = $2', [req.params.id, req.user.workspace_id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

module.exports = router;
