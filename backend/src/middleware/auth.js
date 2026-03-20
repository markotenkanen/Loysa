const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'loysa-secret-key-change-in-production';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token puuttuu' });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Virheellinen token' });
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, workspace_id: user.workspace_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authenticateToken, generateToken };
