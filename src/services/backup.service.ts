import fs from 'fs';
import path from 'path';
import { getDb, persistDb } from '../db/database.ts';

const DB_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.join(DB_DIR, 'backups');
const DB_FILE = path.join(DB_DIR, 'salary_tracker.sqlite');

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  isAutomatic: boolean;
}

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

/**
 * Creates a database backup file
 */
export async function createBackup(isAutomatic = false): Promise<BackupInfo> {
  ensureBackupsDir();
  persistDb();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = isAutomatic ? 'auto-backup' : 'manual-backup';
  const filename = `${prefix}-${timestamp}.sqlite`;
  const targetPath = path.join(BACKUPS_DIR, filename);

  if (fs.existsSync(DB_FILE)) {
    fs.copyFileSync(DB_FILE, targetPath);
  } else {
    const db = await getDb();
    const data = db.export();
    fs.writeFileSync(targetPath, Buffer.from(data));
  }

  const stat = fs.statSync(targetPath);
  return {
    filename,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
    isAutomatic,
  };
}

/**
 * Lists all existing database backups
 */
export function listBackups(): BackupInfo[] {
  ensureBackupsDir();
  const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.sqlite'));
  return files.map((file) => {
    const filePath = path.join(BACKUPS_DIR, file);
    const stat = fs.statSync(filePath);
    return {
      filename: file,
      sizeBytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
      isAutomatic: file.startsWith('auto-'),
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Restores the database from a specified backup file
 */
export async function restoreBackup(filename: string): Promise<boolean> {
  ensureBackupsDir();
  const backupPath = path.join(BACKUPS_DIR, filename);
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found.');
  }

  // Copy backup over active DB
  fs.copyFileSync(backupPath, DB_FILE);
  return true;
}

/**
 * Database health check status
 */
export async function getDatabaseHealth() {
  try {
    const db = await getDb();
    const tableRes = db.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table';");
    const count = tableRes[0]?.values[0]?.[0] || 0;
    const stat = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE) : null;

    return {
      status: 'HEALTHY',
      persistedToDisk: fs.existsSync(DB_FILE),
      sizeBytes: stat?.size || 0,
      tableCount: count,
      lastModified: stat?.mtime.toISOString() || new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      status: 'DEGRADED',
      error: err.message,
      persistedToDisk: false,
    };
  }
}
