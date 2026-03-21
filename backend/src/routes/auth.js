const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/database');
const { generateToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Luo uusi workspace + admin-käyttäjä
router.post('/workspace/create', async (req, res) => {
  const { workspaceName, workspaceSlug, displayName, email, password } = req.body;

  if (!workspaceName || !workspaceSlug || !email || !password || !displayName) {
    return res.status(400).json({ error: 'Kaikki kentät vaaditaan' });
  }

  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(workspaceSlug)) {
    return res.status(400).json({ error: 'Slug voi sisältää vain pieniä kirjaimia, numeroita ja viivoja' });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id FROM workspaces WHERE slug = $1', [workspaceSlug]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'Workspace-tunnus on jo käytössä' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');

    const workspace = await client.query(
      'INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id',
      [workspaceName, workspaceSlug]
    );
    const workspaceId = workspace.rows[0].id;

    const user = await client.query(
      `INSERT INTO users (workspace_id, username, email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING id`,
      [workspaceId, email.split('@')[0], email, passwordHash, displayName]
    );
    const userId = user.rows[0].id;

    const generalChannel = await client.query(
      `INSERT INTO channels (workspace_id, name, description, created_by)
       VALUES ($1, 'general', 'Yleinen kanava kaikille', $2) RETURNING id`,
      [workspaceId, userId]
    );

    await client.query(
      'INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES ($1, $2, 1)',
      [generalChannel.rows[0].id, userId]
    );

    const randomChannel = await client.query(
      `INSERT INTO channels (workspace_id, name, description, created_by)
       VALUES ($1, 'random', 'Satunnainen keskustelu', $2) RETURNING id`,
      [workspaceId, userId]
    );

    await client.query(
      'INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES ($1, $2, 1)',
      [randomChannel.rows[0].id, userId]
    );

    await client.query('COMMIT');

    const result = {
      workspace: { id: workspaceId, name: workspaceName, slug: workspaceSlug },
      user: { id: userId, email, display_name: displayName, role: 'admin', workspace_id: workspaceId }
    };

    const token = generateToken(result.user);
    res.status(201).json({ token, user: result.user, workspace: result.workspace });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  } finally {
    client.release();
  }
});

// Kirjaudu sisään
router.post('/login', async (req, res) => {
  const { workspaceSlug, email, password } = req.body;

  if (!workspaceSlug || !email || !password) {
    return res.status(400).json({ error: 'Kaikki kentät vaaditaan' });
  }

  try {
    const wsResult = await pool.query('SELECT * FROM workspaces WHERE slug = $1', [workspaceSlug]);
    const workspace = wsResult.rows[0];
    if (!workspace) {
      return res.status(404).json({ error: 'Workspacea ei löydy' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE workspace_id = $1 AND email = $2', [workspace.id, email]);
    const user = userResult.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Virheellinen sähköposti tai salasana' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Virheellinen sähköposti tai salasana' });
    }

    await pool.query('UPDATE users SET is_online = 1 WHERE id = $1', [user.id]);

    const token = generateToken(user);
    const { password_hash, ...safeUser } = user;

    res.json({ token, user: safeUser, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Rekisteröidy olemassa olevaan workspaceen
router.post('/register', async (req, res) => {
  const { workspaceSlug, displayName, email, password } = req.body;

  if (!workspaceSlug || !email || !password || !displayName) {
    return res.status(400).json({ error: 'Kaikki kentät vaaditaan' });
  }

  try {
    const wsResult = await pool.query('SELECT * FROM workspaces WHERE slug = $1', [workspaceSlug]);
    const workspace = wsResult.rows[0];
    if (!workspace) {
      return res.status(404).json({ error: 'Workspacea ei löydy' });
    }

    const existingResult = await pool.query('SELECT id FROM users WHERE workspace_id = $1 AND email = $2', [workspace.id, email]);
    if (existingResult.rows[0]) {
      return res.status(409).json({ error: 'Sähköposti on jo käytössä' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await pool.query(
      `INSERT INTO users (workspace_id, username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [workspace.id, email.split('@')[0], email, passwordHash, displayName]
    );
    const userId = userResult.rows[0].id;

    // Liitä general-kanavalle
    const generalResult = await pool.query('SELECT id FROM channels WHERE workspace_id = $1 AND name = $2', [workspace.id, 'general']);
    if (generalResult.rows[0]) {
      await pool.query('INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [generalResult.rows[0].id, userId]);
    }

    const newUserResult = await pool.query('SELECT id, workspace_id, email, display_name, role FROM users WHERE id = $1', [userId]);
    const newUser = newUserResult.rows[0];
    const token = generateToken(newUser);

    res.status(201).json({ token, user: newUser, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae nykyinen käyttäjä
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT id, workspace_id, email, display_name, avatar, status_emoji, status_text, role, is_online, is_away FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
    const wsResult = await pool.query('SELECT id, name, slug FROM workspaces WHERE id = $1', [user.workspace_id]);
    res.json({ user, workspace: wsResult.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Kirjaudu ulos
router.post('/logout', authenticateToken, async (req, res) => {
  await pool.query('UPDATE users SET is_online = 0 WHERE id = $1', [req.user.id]);
  res.json({ message: 'Kirjauduttu ulos' });
});

module.exports = router;
