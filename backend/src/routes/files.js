const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt|csv|zip|mp3|mp4|mov|webm|svg|webp/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tiedostotyyppi ei ole sallittu'));
    }
  }
});

router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tiedosto puuttuu' });

  try {
    const { channel_id, message_id } = req.body;
    const result = await pool.query(`
      INSERT INTO files (workspace_id, user_id, channel_id, message_id, filename, original_name, mime_type, size)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [
      req.user.workspace_id, req.user.id,
      channel_id || null, message_id || null,
      req.file.filename, req.file.originalname,
      req.file.mimetype, req.file.size
    ]);

    res.json({
      id: result.rows[0].id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size: req.file.size,
      url: `/api/files/${req.file.filename}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Palvelinvirhe' });
  }
});

router.get('/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tiedostoa ei löydy' });
  res.sendFile(filePath);
});

module.exports = router;
