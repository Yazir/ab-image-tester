import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { Poll, Vote, Image, Selection } from '../shared/types';

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
`);

try { db.exec(`ALTER TABLE polls ADD COLUMN admin_token_rotated_at INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN admin_token_created_at INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE polls ADD COLUMN show_results INTEGER NOT NULL DEFAULT 1`); } catch {}

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
    showResults: !!row.show_results,
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
  insertPoll: db.prepare(`INSERT INTO polls (id, admin_token, share_token, title, description, images, rounds, container_width, container_height, fit_mode, show_results, created_at, admin_token_created_at, admin_token_rotated_at)
    VALUES (@id, @adminToken, @shareToken, @title, @description, @images, @rounds, @containerWidth, @containerHeight, @fitMode, @showResults, @createdAt, @createdAt, 0)`),
  getPoll: db.prepare('SELECT * FROM polls WHERE id = ?'),
  updatePoll: db.prepare(`UPDATE polls SET title = @title, description = @description, images = @images, rounds = @rounds,
    container_width = @containerWidth, container_height = @containerHeight, fit_mode = @fitMode, show_results = @showResults, share_token = @shareToken WHERE id = @id`),
  rotateToken: db.prepare(`UPDATE polls SET admin_token = @newToken, admin_token_rotated_at = @rotatedAt WHERE id = @id AND admin_token = @oldToken`),
  deletePoll: db.prepare('DELETE FROM polls WHERE id = ?'),
  insertVote: db.prepare(`INSERT INTO votes (id, poll_id, voter_fingerprint, selections, voted_at)
    VALUES (@id, @pollId, @voterFingerprint, @selections, @votedAt)`),
  getVotesForPoll: db.prepare('SELECT * FROM votes WHERE poll_id = ?'),
  getVoteForVoter: db.prepare('SELECT * FROM votes WHERE poll_id = ? AND voter_fingerprint = ?'),
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
    showResults: 1,
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
    showResults: true,
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
    showResults: updates.showResults !== undefined ? (updates.showResults ? 1 : 0) : (existing.showResults ? 1 : 0),
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

export function close(): void {
  db.close();
}
