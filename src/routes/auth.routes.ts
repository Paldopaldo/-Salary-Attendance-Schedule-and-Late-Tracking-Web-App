import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb, withTransaction } from '../db/database.ts';
import { AuditService } from '../services/audit.service.ts';
import { ScheduleService } from '../services/schedule.service.ts';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth.middleware.ts';
import { User } from '../types.ts';

const router = Router();

// In-memory rate limiter & lockout map: ip/email -> { count: number, lockedUntil: number }
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

function checkLockout(key: string): { isLocked: boolean; remainingSeconds: number } {
  const record = loginAttempts.get(key);
  if (!record) return { isLocked: false, remainingSeconds: 0 };

  if (record.count >= MAX_ATTEMPTS) {
    const now = Date.now();
    if (now < record.lockedUntil) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { isLocked: true, remainingSeconds };
    } else {
      loginAttempts.delete(key);
    }
  }
  return { isLocked: false, remainingSeconds: 0 };
}

function recordFailedAttempt(key: string) {
  const existing = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  existing.count += 1;
  if (existing.count >= MAX_ATTEMPTS) {
    existing.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, existing);
}

function clearAttempts(key: string) {
  loginAttempts.delete(key);
}

/**
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = await getDb();

    // Check existing email
    const checkStmt = db.prepare('SELECT id FROM users WHERE email = ?');
    checkStmt.bind([cleanEmail]);
    if (checkStmt.step()) {
      checkStmt.free();
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }
    checkStmt.free();

    const userId = `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    await withTransaction(async (dbTx) => {
      dbTx.run(
        `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE');`,
        [userId, fullName.trim(), cleanEmail, passwordHash, phone?.trim() || null]
      );
    });

    // Initialize default weekly schedule
    await ScheduleService.getUserSchedule(userId);

    // Audit log
    await AuditService.logAction(
      userId,
      'REGISTER',
      `User account created for ${fullName}`,
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || 'App-Client'
    );

    const token = jwt.sign({ id: userId, email: cleanEmail, fullName }, JWT_SECRET, { expiresIn: '7d' });

    const user: User = {
      id: userId,
      fullName,
      email: cleanEmail,
      phone: phone?.trim(),
      accountStatus: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return res.status(201).json({
      message: 'Account successfully registered.',
      token,
      user,
    });
  } catch (err: any) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message || 'Registration failed.' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const lockoutKey = `${req.ip || '127.0.0.1'}_${cleanEmail}`;

    const lockout = checkLockout(lockoutKey);
    if (lockout.isLocked) {
      return res.status(429).json({
        error: `Too many failed login attempts. Account temporarily locked. Please try again in ${lockout.remainingSeconds} seconds.`,
      });
    }

    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, password_hash, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE email = ?;
    `);
    stmt.bind([cleanEmail]);

    if (!stmt.step()) {
      stmt.free();
      recordFailedAttempt(lockoutKey);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const row = stmt.getAsObject();
    stmt.free();

    if (row.account_status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
    }

    const isMatch = bcrypt.compareSync(password, row.password_hash as string);
    if (!isMatch) {
      recordFailedAttempt(lockoutKey);
      await AuditService.logAction(
        row.id as string,
        'FAILED_LOGIN',
        `Failed password attempt for ${cleanEmail}`,
        req.ip || '127.0.0.1',
        req.headers['user-agent'] || 'App-Client'
      );
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    clearAttempts(lockoutKey);

    const token = jwt.sign(
      { id: row.id, email: row.email, fullName: row.full_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    await AuditService.logAction(
      row.id as string,
      'LOGIN',
      `Successful login from IP ${req.ip || '127.0.0.1'}`,
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || 'App-Client'
    );

    const user: User = {
      id: row.id as string,
      fullName: row.full_name as string,
      email: row.email as string,
      phone: (row.phone as string) || undefined,
      profilePicture: (row.profile_picture as string) || undefined,
      accountStatus: row.account_status as any,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };

    return res.json({
      message: 'Login successful.',
      token,
      user,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, async (req: AuthRequest, res) => {
  if (req.user) {
    await AuditService.logAction(
      req.user.id,
      'LOGOUT',
      'User logged out',
      req.ip || '127.0.0.1',
      req.headers['user-agent'] || 'App-Client'
    );
  }
  return res.json({ message: 'Successfully logged out.' });
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE id = ?;
    `);
    stmt.bind([req.user!.id]);

    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'User not found.' });
    }

    const row = stmt.getAsObject();
    stmt.free();

    const user: User = {
      id: row.id as string,
      fullName: row.full_name as string,
      email: row.email as string,
      phone: (row.phone as string) || undefined,
      profilePicture: (row.profile_picture as string) || undefined,
      accountStatus: row.account_status as any,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };

    return res.json({ user });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/demo-switch
 * Allows instantaneous user switching (between Juan and Maria, or registered users) for seamless local review
 */
router.post('/demo-switch', async (req, res) => {
  try {
    const { email } = req.body;
    const targetEmail = (email || 'juan@example.com').trim().toLowerCase();

    const db = await getDb();
    const stmt = db.prepare(`
      SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at
      FROM users
      WHERE email = ?;
    `);
    stmt.bind([targetEmail]);

    if (!stmt.step()) {
      stmt.free();
      // fallback to first user
      const firstStmt = db.prepare('SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users LIMIT 1;');
      if (!firstStmt.step()) {
        firstStmt.free();
        return res.status(404).json({ error: 'No users found.' });
      }
      const first = firstStmt.getAsObject();
      firstStmt.free();
      const token = jwt.sign({ id: first.id, email: first.email, fullName: first.full_name }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: first });
    }

    const row = stmt.getAsObject();
    stmt.free();

    const token = jwt.sign({ id: row.id, email: row.email, fullName: row.full_name }, JWT_SECRET, { expiresIn: '7d' });

    const user: User = {
      id: row.id as string,
      fullName: row.full_name as string,
      email: row.email as string,
      phone: (row.phone as string) || undefined,
      profilePicture: (row.profile_picture as string) || undefined,
      accountStatus: row.account_status as any,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };

    return res.json({ token, user });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const cleanEmail = email.trim().toLowerCase();
    const db = await getDb();
    const stmt = db.prepare('SELECT id FROM users WHERE email = ?');
    stmt.bind([cleanEmail]);

    if (!stmt.step()) {
      stmt.free();
      // Do not reveal whether user exists for security
      return res.json({ message: 'If this email is registered, a password reset token has been issued.' });
    }

    const userId = stmt.getAsObject().id as string;
    stmt.free();

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.run('INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', [
      token,
      userId,
      expiresAt,
    ]);

    await AuditService.logAction(
      userId,
      'PASSWORD_RESET_REQUESTED',
      `Password reset token generated for ${cleanEmail}`,
      req.ip || '127.0.0.1'
    );

    return res.json({
      message: 'Password reset token generated successfully.',
      resetToken: token, // Returned for dev testing convenience
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/reset-password
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const db = await getDb();
    const stmt = db.prepare(`
      SELECT token, user_id, expires_at, used
      FROM password_reset_tokens
      WHERE token = ? AND used = 0;
    `);
    stmt.bind([token]);

    if (!stmt.step()) {
      stmt.free();
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    const row = stmt.getAsObject();
    stmt.free();

    const expiresAt = new Date(row.expires_at as string).getTime();
    if (Date.now() > expiresAt) {
      return res.status(400).json({ error: 'Password reset token has expired.' });
    }

    const userId = row.user_id as string;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);

    await withTransaction((dbTx) => {
      dbTx.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?;', [
        hash,
        userId,
      ]);
      dbTx.run('UPDATE password_reset_tokens SET used = 1 WHERE token = ?;', [token]);
    });

    await AuditService.logAction(
      userId,
      'PASSWORD_CHANGED',
      'Password successfully reset via token',
      req.ip || '127.0.0.1'
    );

    return res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/profile
 */
router.get('/profile', authenticate, async (req: AuthRequest, res) => {
  const db = await getDb();
  const stmt = db.prepare('SELECT id, full_name, email, phone, profile_picture, account_status, created_at, updated_at FROM users WHERE id = ?');
  stmt.bind([req.user!.id]);
  if (!stmt.step()) {
    stmt.free();
    return res.status(404).json({ error: 'User not found.' });
  }
  const row = stmt.getAsObject();
  stmt.free();

  return res.json({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    profilePicture: row.profile_picture,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

/**
 * PUT /api/profile
 */
router.put('/profile', authenticate, async (req: AuthRequest, res) => {
  try {
    const { fullName, phone, profilePicture } = req.body;
    const userId = req.user!.id;

    await withTransaction((db) => {
      db.run(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             phone = COALESCE(?, phone),
             profile_picture = COALESCE(?, profile_picture),
             updated_at = datetime('now')
         WHERE id = ?;`,
        [fullName?.trim() || null, phone?.trim() || null, profilePicture || null, userId]
      );
    });

    await AuditService.logAction(
      userId,
      'PROFILE_UPDATED',
      'User updated profile information',
      req.ip || '127.0.0.1'
    );

    return res.json({ message: 'Profile updated successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/profile/password
 */
router.put('/profile/password', authenticate, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const userId = req.user!.id;
    const db = await getDb();
    const stmt = db.prepare('SELECT password_hash FROM users WHERE id = ?');
    stmt.bind([userId]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'User not found.' });
    }
    const hash = stmt.getAsObject().password_hash as string;
    stmt.free();

    const isMatch = bcrypt.compareSync(currentPassword, hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    await withTransaction((dbTx) => {
      dbTx.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?;', [
        newHash,
        userId,
      ]);
    });

    await AuditService.logAction(
      userId,
      'PASSWORD_CHANGED',
      'User changed account password',
      req.ip || '127.0.0.1'
    );

    return res.json({ message: 'Password updated successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
