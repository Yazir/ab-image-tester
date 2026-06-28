import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { Poll, Vote, Image, Selection, AnalyticsSnapshot } from '../shared/types';

const DATA_DIR = process.env.TEST_DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    admin_token TEXT NOT NULL,
    share_token TEXT,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    images TEXT NOT NULL DEFAULT '[]',
    rounds INTEGER NOT NULL DEFAULT 10,
    container_width INTEGER NOT NULL DEFAULT 800,
    container_height INTEGER NOT NULL DEFAULT 600,
    fit_mode TEXT NOT NULL DEFAULT 'contain',
    allow_scrolling INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL,
    voter_fingerprint TEXT NOT NULL,
    selections TEXT NOT NULL DEFAULT '[]',
    voted_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_votes_poll_voter ON votes(poll_id, voter_fingerprint);

  CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS analytics_counters (
    date TEXT NOT NULL,
    counter TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, counter)
  );
`);

try { db.exec(`ALTER TABLE polls ADD COLUMN admin_token_rotated_at INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN admin_token_created_at INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN show_results INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN allow_scrolling INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN show_labels INTEGER NOT NULL DEFAULT 0`); } catch {}

function rowToPoll(row: any): Poll {
  return {
    id: row.id,
    adminToken: row.admin_token,
    shareToken: row.share_token,
    title: row.title,
    description: row.description,
    images: JSON.parse(row.images),
    rounds: row.rounds,
    containerWidth: row.container_width,
    containerHeight: row.container_height,
    fitMode: row.fit_mode,
    allowScrolling: !!row.allow_scrolling,
    showResults: !!row.show_results,
    showLabels: !!row.show_labels,
    createdAt: row.created_at,
  };
}

function rowToVote(row: any): Vote {
  return {
    id: row.id,
    pollId: row.poll_id,
    voterFingerprint: row.voter_fingerprint,
    selections: JSON.parse(row.selections),
    votedAt: row.voted_at,
  };
}

const stmts = {
  insertPoll: db.prepare(`INSERT INTO polls (id, admin_token, share_token, title, description, images, rounds, container_width, container_height, fit_mode, allow_scrolling, show_results, show_labels, created_at, admin_token_created_at, admin_token_rotated_at)
    VALUES (@id, @adminToken, @shareToken, @title, @description, @images, @rounds, @containerWidth, @containerHeight, @fitMode, @allowScrolling, @showResults, @showLabels, @createdAt, @createdAt, 0)`),
  getPoll: db.prepare('SELECT * FROM polls WHERE id = ?'),
  updatePoll: db.prepare(`UPDATE polls SET title = @title, description = @description, images = @images, rounds = @rounds,
    container_width = @containerWidth, container_height = @containerHeight, fit_mode = @fitMode, allow_scrolling = @allowScrolling, show_results = @showResults, show_labels = @showLabels, share_token = @shareToken WHERE id = @id`),
  rotateToken: db.prepare(`UPDATE polls SET admin_token = @newToken, admin_token_rotated_at = @rotatedAt WHERE id = @id AND admin_token = @oldToken`),
  deletePoll: db.prepare('DELETE FROM polls WHERE id = ?'),
  insertVote: db.prepare(`INSERT INTO votes (id, poll_id, voter_fingerprint, selections, voted_at)
    VALUES (@id, @pollId, @voterFingerprint, @selections, @votedAt)`),
  getVotesForPoll: db.prepare('SELECT * FROM votes WHERE poll_id = ?'),
  getVoteForVoter: db.prepare('SELECT * FROM votes WHERE poll_id = ? AND voter_fingerprint = ?'),
  insertWaitlistEmail: db.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (@email, @createdAt)'),
};

export function createPoll(): Poll {
  const id = uuid().slice(0, 8);
  const adminToken = uuid();
  const now = Date.now();
  const params = {
    id,
    adminToken,
    shareToken: null,
    title: '',
    description: '',
    images: '[]',
    rounds: 10,
    containerWidth: 800,
    containerHeight: 600,
    fitMode: 'contain',
    allowScrolling: 0,
    showResults: 1,
    showLabels: 0,
    createdAt: now,
  };
  stmts.insertPoll.run(params);
  return {
    id,
    adminToken,
    shareToken: null,
    title: '',
    description: '',
    images: [],
    rounds: 10,
    containerWidth: 800,
    containerHeight: 600,
    fitMode: 'contain',
    allowScrolling: false,
    showResults: true,
    showLabels: false,
    createdAt: now,
  };
}

export function getPoll(id: string): Poll | null {
  const row = stmts.getPoll.get(id);
  return row ? rowToPoll(row) : null;
}

export function updatePoll(id: string, updates: Partial<Poll>): Poll | null {
  const existing = getPoll(id);
  if (!existing) return null;

  const merged: Record<string, any> = {
    id,
    title: updates.title !== undefined ? updates.title : existing.title,
    description: updates.description !== undefined ? updates.description : existing.description,
    images: updates.images !== undefined ? JSON.stringify(updates.images) : JSON.stringify(existing.images),
    rounds: updates.rounds !== undefined ? updates.rounds : existing.rounds,
    containerWidth: updates.containerWidth !== undefined ? updates.containerWidth : existing.containerWidth,
    containerHeight: updates.containerHeight !== undefined ? updates.containerHeight : existing.containerHeight,
    fitMode: updates.fitMode !== undefined ? updates.fitMode : existing.fitMode,
    allowScrolling: updates.allowScrolling !== undefined ? (updates.allowScrolling ? 1 : 0) : (existing.allowScrolling ? 1 : 0),
    showResults: updates.showResults !== undefined ? (updates.showResults ? 1 : 0) : (existing.showResults ? 1 : 0),
    showLabels: updates.showLabels !== undefined ? (updates.showLabels ? 1 : 0) : (existing.showLabels ? 1 : 0),
    shareToken: updates.shareToken !== undefined ? updates.shareToken : existing.shareToken,
  };

  stmts.updatePoll.run(merged);
  return getPoll(id);
}

export function deletePoll(id: string): boolean {
  const result = stmts.deletePoll.run(id);
  return result.changes > 0;
}

export function saveVote(vote: Vote): void {
  stmts.insertVote.run({
    id: vote.id,
    pollId: vote.pollId,
    voterFingerprint: vote.voterFingerprint,
    selections: JSON.stringify(vote.selections),
    votedAt: vote.votedAt,
  });
}

export function getVotesForPoll(pollId: string): Vote[] {
  return (stmts.getVotesForPoll.all(pollId) as any[]).map(rowToVote);
}

export function getVotesForVoter(pollId: string, fingerprint: string): Vote | null {
  const row = stmts.getVoteForVoter.get(pollId, fingerprint);
  return row ? rowToVote(row) : null;
}

export function generateShareToken(pollId: string): string | null {
  const poll = getPoll(pollId);
  if (!poll) return null;
  if (poll.shareToken) return poll.shareToken;
  const shareToken = uuid().slice(0, 12);
  updatePoll(pollId, { shareToken });
  return shareToken;
}

export function rotateAdminToken(pollId: string, oldToken: string): string | null {
  const newToken = uuid();
  const result = stmts.rotateToken.run({
    id: pollId,
    newToken,
    oldToken,
    rotatedAt: Date.now(),
  });
  return result.changes > 0 ? newToken : null;
}

export function addWaitlistEmail(email: string): boolean {
  const result = stmts.insertWaitlistEmail.run({ email: email.trim().toLowerCase(), createdAt: Date.now() });
  return result.changes > 0;
}

export interface ConsoleOverview {
  totalPolls: number;
  totalVotes: number;
  totalImages: number;
  totalVoters: number;
  averageImagesPerPoll: number;
  averageVotesPerPoll: number;
  averageRoundsPerPoll: number;
  latestPoll: { id: string; title: string; createdAt: number } | null;
  oldestPoll: { id: string; title: string; createdAt: number } | null;
}

export function getConsoleOverview(): ConsoleOverview {
  const pollStats = db.prepare(`
    SELECT
      COUNT(*) as totalPolls,
      AVG(json_array_length(images)) as avgImages,
      AVG(rounds) as avgRounds,
      MIN(created_at) as oldestCreatedAt,
      MAX(created_at) as latestCreatedAt
    FROM polls
  `).get() as any;

  const voteStats = db.prepare(`SELECT COUNT(*) as totalVotes, COUNT(DISTINCT voter_fingerprint) as totalVoters FROM votes`).get() as any;
  const imageTotal = db.prepare(`SELECT SUM(json_array_length(images)) as totalImages FROM polls`).get() as any;

  let latestPoll: { id: string; title: string; createdAt: number } | null = null;
  let oldestPoll: { id: string; title: string; createdAt: number } | null = null;

  if (pollStats.totalPolls > 0) {
    const latest = db.prepare(`SELECT id, title, created_at FROM polls ORDER BY created_at DESC LIMIT 1`).get() as any;
    if (latest) {
      latestPoll = { id: latest.id, title: latest.title, createdAt: latest.created_at };
    }
    const oldest = db.prepare(`SELECT id, title, created_at FROM polls ORDER BY created_at ASC LIMIT 1`).get() as any;
    if (oldest) {
      oldestPoll = { id: oldest.id, title: oldest.title, createdAt: oldest.created_at };
    }
  }

  const tp = (pollStats.totalPolls as number) || 0;

  return {
    totalPolls: tp,
    totalVotes: (voteStats.totalVotes as number) || 0,
    totalImages: (imageTotal.totalImages as number) || 0,
    totalVoters: (voteStats.totalVoters as number) || 0,
    averageImagesPerPoll: tp > 0 ? Math.round(((pollStats.avgImages as number) || 0) * 10) / 10 : 0,
    averageVotesPerPoll: tp > 0 ? Math.round(((voteStats.totalVotes as number) / tp) * 10) / 10 : 0,
    averageRoundsPerPoll: tp > 0 ? Math.round(((pollStats.avgRounds as number) || 0) * 10) / 10 : 0,
    latestPoll,
    oldestPoll,
  };
}

export interface DailyVote {
  date: string;
  count: number;
}

export function getVotesByDay(): DailyVote[] {
  return getDailyVotes();
}

export interface PollSummary {
  id: string;
  title: string;
  description: string;
  imageCount: number;
  voteCount: number;
  rounds: number;
  showResults: boolean;
  createdAt: number;
}

export function getPollsSummary(search?: string, sortBy?: string, sortDir?: string): PollSummary[] {
  let sql = `
    SELECT p.id, p.title, p.description, p.rounds, p.show_results, p.created_at,
           json_array_length(p.images) as imageCount,
           COALESCE(v.voteCount, 0) as voteCount
    FROM polls p
    LEFT JOIN (SELECT poll_id, COUNT(*) as voteCount FROM votes GROUP BY poll_id) v ON v.poll_id = p.id
  `;
  const params: any[] = [];

  if (search) {
    sql += ` WHERE p.title LIKE ? OR p.description LIKE ? OR p.id LIKE ?`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const sortCol = (sortBy && ['title', 'imageCount', 'voteCount', 'created_at', 'rounds'].includes(sortBy))
    ? sortBy : 'created_at';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${sortCol} ${dir}`;

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    imageCount: r.imageCount,
    voteCount: r.voteCount,
    rounds: r.rounds,
    showResults: !!r.show_results,
    createdAt: r.created_at,
  }));
}

export interface StorageStats {
  dbSizeBytes: number;
  uploadDirSizeBytes: number;
  uploadFileCount: number;
  largestFiles: { name: string; size: number }[];
}

export function getStorageStats(): StorageStats {
  const dbStats = fs.statSync(DB_PATH);
  const uploadsDir = path.join(dataDir, 'uploads');
  let uploadDirSizeBytes = 0;
  let uploadFileCount = 0;
  const fileSizes: { name: string; size: number }[] = [];

  if (fs.existsSync(uploadsDir)) {
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          try {
            const st = fs.statSync(fullPath);
            uploadDirSizeBytes += st.size;
            uploadFileCount++;
            fileSizes.push({ name: entry.name, size: st.size });
          } catch {}
        }
      }
    };
    walk(uploadsDir);
  }

  fileSizes.sort((a, b) => b.size - a.size);
  const largestFiles = fileSizes.slice(0, 10);

  return {
    dbSizeBytes: dbStats.size,
    uploadDirSizeBytes,
    uploadFileCount,
    largestFiles,
  };
}

export interface DbTableInfo {
  name: string;
  columns: { name: string; type: string; notnull: boolean; pk: boolean }[];
  rowCount: number;
}

export function getDbTables(): DbTableInfo[] {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as any[];
  return tables.map((t: any) => {
    const cols = db.prepare(`PRAGMA table_info('${t.name}')`).all() as any[];
    const rowCount = (db.prepare(`SELECT COUNT(*) as cnt FROM [${t.name}]`).get() as any).cnt;
    return {
      name: t.name,
      columns: cols.map((c: any) => ({
        name: c.name,
        type: c.type,
        notnull: !!c.notnull,
        pk: !!c.pk,
      })),
      rowCount,
    };
  });
}

export interface DbQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
}

export function executeReadOnlyQuery(sql: string, params?: any[]): DbQueryResult {
  const trimmed = sql.trim();
  const upper = trimmed.slice(0, 30).toUpperCase().replace(/\s/g, ' ');
  if (!upper.startsWith('SELECT') && !upper.startsWith('PRAGMA') && !upper.startsWith('EXPLAIN')) {
    throw new Error('Only SELECT, PRAGMA, and EXPLAIN queries allowed');
  }

  const dangerous = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|REINDEX|VACUUM)\b/i;
  if (dangerous.test(trimmed)) {
    throw new Error('Write operations are not allowed');
  }

  if (params && params.length > 0) {
    const stmt = db.prepare(trimmed);
    const rows = stmt.all(...params) as any[];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows, rowCount: rows.length };
  }

  const stmt = db.prepare(trimmed);
  const rows = stmt.all() as any[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows, rowCount: rows.length };
}

export function incrementAnalyticsCounter(date: string, counter: string): void {
  db.prepare(`
    INSERT INTO analytics_counters (date, counter, value) VALUES (?, ?, 1)
    ON CONFLICT(date, counter) DO UPDATE SET value = value + 1
  `).run(date, counter);
}

function executeDailyQuery(sql: string): { date: string; count: number }[] {
  const rows = db.prepare(sql).all() as any[];
  return rows.map(r => ({ date: r.day as string, count: r.cnt as number }));
}

export function getDailyVotes(): { date: string; count: number }[] {
  return executeDailyQuery(`
    SELECT date(datetime(voted_at / 1000, 'unixepoch')) as day, COUNT(*) as cnt
    FROM votes
    GROUP BY day
    ORDER BY day ASC
  `);
}

export function getDailyUniqueVoters(): { date: string; count: number }[] {
  return executeDailyQuery(`
    SELECT date(datetime(voted_at / 1000, 'unixepoch')) as day, COUNT(DISTINCT voter_fingerprint) as cnt
    FROM votes
    GROUP BY day
    ORDER BY day ASC
  `);
}

export function getDailyNewPolls(): { date: string; count: number }[] {
  return executeDailyQuery(`
    SELECT date(datetime(created_at / 1000, 'unixepoch')) as day, COUNT(*) as cnt
    FROM polls
    GROUP BY day
    ORDER BY day ASC
  `);
}

export function getDailyActivePolls(): { date: string; count: number }[] {
  return executeDailyQuery(`
    SELECT date(datetime(v.voted_at / 1000, 'unixepoch')) as day, COUNT(DISTINCT v.poll_id) as cnt
    FROM votes v
    GROUP BY day
    ORDER BY day ASC
  `);
}

export function getAnalyticsCounters(fromDate: string, toDate: string): { date: string; counter: string; value: number }[] {
  const rows = db.prepare(`
    SELECT date, counter, value FROM analytics_counters
    WHERE date >= ? AND date <= ?
    ORDER BY date
  `).all(fromDate, toDate) as any[];
  return rows.map(r => ({ date: r.date as string, counter: r.counter as string, value: r.value as number }));
}

export function getAnalyticsSnapshot(days: number): AnalyticsSnapshot[] {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - (days - 1) * 86400000);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  const votesMap = new Map<string, number>();
  for (const r of getDailyVotes()) votesMap.set(r.date, r.count);

  const uniqueMap = new Map<string, number>();
  for (const r of getDailyUniqueVoters()) uniqueMap.set(r.date, r.count);

  const newPollsMap = new Map<string, number>();
  for (const r of getDailyNewPolls()) newPollsMap.set(r.date, r.count);

  const activeMap = new Map<string, number>();
  for (const r of getDailyActivePolls()) activeMap.set(r.date, r.count);

  const countersMap = new Map<string, Map<string, number>>();
  for (const r of getAnalyticsCounters(fromStr, toStr)) {
    let inner = countersMap.get(r.date);
    if (!inner) { inner = new Map(); countersMap.set(r.date, inner); }
    inner.set(r.counter, r.value);
  }

  const snapshot: AnalyticsSnapshot[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(fromDate.getTime() + i * 86400000);
    const date = d.toISOString().slice(0, 10);
    const ci = countersMap.get(date);
    snapshot.push({
      date,
      votes: votesMap.get(date) || 0,
      uniqueVoters: uniqueMap.get(date) || 0,
      newPolls: newPollsMap.get(date) || 0,
      activePolls: activeMap.get(date) || 0,
      pairingsRequested: ci?.get('pairings_requested') || 0,
      votesSubmitted: ci?.get('votes_submitted') || 0,
    });
  }

  return snapshot;
}

export function close(): void {
  db.close();
}
