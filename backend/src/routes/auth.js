const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
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

  try {
    const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(workspaceSlug);
    if (existing) {
      return res.status(409).json({ error: 'Workspace-tunnus on jo käytössä' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const createWorkspace = db.transaction(() => {
      const workspace = db.prepare(
        'INSERT INTO workspaces (name, slug) VALUES (?, ?)'
      ).run(workspaceName, workspaceSlug);

      const user = db.prepare(
        `INSERT INTO users (workspace_id, username, email, password_hash, display_name, role)
         VALUES (?, ?, ?, ?, ?, 'admin')`
      ).run(workspace.lastInsertRowid, email.split('@')[0], email, passwordHash, displayName);

      // Luo general-kanava
      const generalChannel = db.prepare(
        `INSERT INTO channels (workspace_id, name, description, created_by)
         VALUES (?, 'general', 'Yleinen kanava kaikille', ?)`
      ).run(workspace.lastInsertRowid, user.lastInsertRowid);

      db.prepare(
        'INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES (?, ?, 1)'
      ).run(generalChannel.lastInsertRowid, user.lastInsertRowid);

      // Luo random-kanava
      const randomChannel = db.prepare(
        `INSERT INTO channels (workspace_id, name, description, created_by)
         VALUES (?, 'random', 'Satunnainen keskustelu', ?)`
      ).run(workspace.lastInsertRowid, user.lastInsertRowid);

      db.prepare(
        'INSERT INTO channel_members (channel_id, user_id, is_admin) VALUES (?, ?, 1)'
      ).run(randomChannel.lastInsertRowid, user.lastInsertRowid);

      return {
        workspace: { id: workspace.lastInsertRowid, name: workspaceName, slug: workspaceSlug },
        user: { id: user.lastInsertRowid, email, display_name: displayName, role: 'admin', workspace_id: workspace.lastInsertRowid }
      };
    });

    const result = createWorkspace();
    const token = generateToken(result.user);

    res.status(201).json({ token, user: result.user, workspace: result.workspace });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Kirjaudu sisään
router.post('/login', async (req, res) => {
  const { workspaceSlug, email, password } = req.body;

  if (!workspaceSlug || !email || !password) {
    return res.status(400).json({ error: 'Kaikki kentät vaaditaan' });
  }

  try {
    const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(workspaceSlug);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspacea ei löydy' });
    }

    const user = db.prepare('SELECT * FROM users WHERE workspace_id = ? AND email = ?').get(workspace.id, email);
    if (!user) {
      return res.status(401).json({ error: 'Virheellinen sähköposti tai salasana' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Virheellinen sähköposti tai salasana' });
    }

    db.prepare('UPDATE users SET is_online = 1 WHERE id = ?').run(user.id);

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
    const workspace = db.prepare('SELECT * FROM workspaces WHERE slug = ?').get(workspaceSlug);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspacea ei löydy' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE workspace_id = ? AND email = ?').get(workspace.id, email);
    if (existing) {
      return res.status(409).json({ error: 'Sähköposti on jo käytössä' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = db.prepare(
      `INSERT INTO users (workspace_id, username, email, password_hash, display_name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(workspace.id, email.split('@')[0], email, passwordHash, displayName);

    // Liitä general-kanavalle
    const generalChannel = db.prepare('SELECT id FROM channels WHERE workspace_id = ? AND name = ?').get(workspace.id, 'general');
    if (generalChannel) {
      db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)').run(generalChannel.id, user.lastInsertRowid);
    }

    const newUser = db.prepare('SELECT id, workspace_id, email, display_name, role FROM users WHERE id = ?').get(user.lastInsertRowid);
    const token = generateToken(newUser);

    res.status(201).json({ token, user: newUser, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Hae nykyinen käyttäjä
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, workspace_id, email, display_name, avatar, status_emoji, status_text, role, is_online, is_away FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Käyttäjää ei löydy' });
    const workspace = db.prepare('SELECT id, name, slug FROM workspaces WHERE id = ?').get(user.workspace_id);
    res.json({ user, workspace });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

// Kirjaudu ulos
router.post('/logout', authenticateToken, (req, res) => {
  db.prepare('UPDATE users SET is_online = 0 WHERE id = ?').run(req.user.id);
  res.json({ message: 'Kirjauduttu ulos' });
});

module.exports = router;
