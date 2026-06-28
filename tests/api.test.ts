import { describe, test, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp, errorHandler } from '../src/server/app';

const png1px = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
  app.use((_req: any, res: any) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler as any);
});

describe('POST /api/polls', () => {
  test('creates a poll and returns credentials', async () => {
    const res = await request(app).post('/api/polls');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('pollId');
    expect(res.body).toHaveProperty('adminToken');
    expect(res.body.pollId).toHaveLength(8);
    expect(res.body.adminToken).toHaveLength(36);
  });
});

describe('GET /api/polls/:pollId', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;
  });

  test('returns poll data with valid admin token', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pollId);
    expect(res.body.images).toEqual([]);
    expect(res.body.title).toBe('');
    expect(res.body.rounds).toBe(10);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get(`/api/polls/${pollId}`);
    expect(res.status).toBe(401);
  });

  test('returns 403 with wrong token', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}`)
      .set('x-admin-token', 'wrong');
    expect(res.status).toBe(403);
  });

  test('returns 403 for nonexistent poll', async () => {
    const res = await request(app)
      .get('/api/polls/non-existent')
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/polls/view/:pollId (public)', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;
  });

  test('returns poll without sensitive fields', async () => {
    const res = await request(app).get(`/api/polls/view/${pollId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pollId);
    expect(res.body).not.toHaveProperty('adminToken');
    expect(res.body).not.toHaveProperty('shareToken');
  });
});

describe('PATCH /api/polls/:pollId', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;
  });

  test('updates title and description', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ title: 'My Poll', description: 'Desc' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('My Poll');
    expect(res.body.description).toBe('Desc');
  });

  test('updates container dimensions and fitMode', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ containerWidth: 600, containerHeight: 400, fitMode: 'cover' });
    expect(res.status).toBe(200);
    expect(res.body.containerWidth).toBe(600);
    expect(res.body.containerHeight).toBe(400);
    expect(res.body.fitMode).toBe('cover');
  });

  test('persists updates across requests', async () => {
    await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ title: 'Persistent' });

    const res = await request(app)
      .get(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken);
    expect(res.body.title).toBe('Persistent');
  });

  test('rejects negative rounds', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ rounds: -5 });
    expect(res.status).toBe(400);
  });

  test('rejects non-numeric rounds', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ rounds: 'ten' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid fitMode', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken)
      .send({ fitMode: 'stretch' });
    expect(res.status).toBe(400);
  });

  test('rejects unauthorized updates', async () => {
    const res = await request(app)
      .patch(`/api/polls/${pollId}`)
      .send({ title: 'Hacked' });
    expect(res.status).toBe(401);
  });
});

describe('Image upload and deletion', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;
  });

  test('uploads a valid image', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'test.png');
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.originalName).toBe('test.png');
    expect(res.body.filename).toMatch(/\.png$/);
  });

  test('rejects upload without auth', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .attach('image', png1px, 'test.png');
    expect(res.status).toBe(401);
  });

  test('rejects non-image file', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', Buffer.from('not an image'), 'test.txt');
    expect(res.status).toBe(400);
  });

  test('deletes an image', async () => {
    const up = await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'to-delete.png');
    const imgId = up.body.id;

    const del = await request(app)
      .delete(`/api/polls/${pollId}/images/${imgId}`)
      .set('x-admin-token', adminToken);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const poll = await request(app)
      .get(`/api/polls/${pollId}`)
      .set('x-admin-token', adminToken);
    expect(poll.body.images.find((i: any) => i.id === imgId)).toBeUndefined();
  });

  test('returns 404 for nonexistent image', async () => {
    const res = await request(app)
      .delete(`/api/polls/${pollId}/images/nonexistent`)
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(404);
  });
});

describe('Share token', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;
  });

  test('generates share token', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}/share`)
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('shareToken');
    expect(res.body.shareUrl).toContain('/vote/');
  });

  test('share token is idempotent', async () => {
    const r1 = await request(app)
      .get(`/api/polls/${pollId}/share`)
      .set('x-admin-token', adminToken);
    const r2 = await request(app)
      .get(`/api/polls/${pollId}/share`)
      .set('x-admin-token', adminToken);
    expect(r1.body.shareToken).toBe(r2.body.shareToken);
  });

  test('public view with share token', async () => {
    const shr = await request(app)
      .get(`/api/polls/${pollId}/share`)
      .set('x-admin-token', adminToken);

    const res = await request(app)
      .get(`/api/polls/${pollId}/public`)
      .set('x-share-token', shr.body.shareToken);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('adminToken');
  });
});

describe('Voting flow', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/polls/${pollId}/upload`)
        .set('x-admin-token', adminToken)
        .attach('image', png1px, `img${i}.png`);
    }
  });

  test('returns pairings for a voter', async () => {
    const fp = 'voter-1';
    const res = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', fp);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pairings)).toBe(true);
    expect(res.body.totalRounds).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('voterToken');
  });

  test('missing fingerprint returns 400', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}/pairings`);
    expect(res.status).toBe(400);
  });

  test('submits a vote after pairings', async () => {
    const fp = 'voter-vote-1';
    const pairRes = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', fp);
    expect(pairRes.status).toBe(200);

    const token = pairRes.body.voterToken;
    const pairings = pairRes.body.pairings;

    const selections = pairings.map((p: any) => ({
      round: p.round,
      leftImageId: p.left.id,
      rightImageId: p.right.id,
      winnerId: p.left.id,
    }));

    const voteRes = await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .send({ selections });
    expect(voteRes.status).toBe(201);

    const checkRes = await request(app)
      .get(`/api/polls/${pollId}/voted`)
      .set('x-voter-fingerprint', fp);
    expect(checkRes.body.voted).toBe(true);
  });

  test('rejects vote without token', async () => {
    const res = await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-fingerprint', 'voter-bad')
      .send({ selections: [] });
    expect(res.status).toBe(400);
  });

  test('rejects duplicate vote', async () => {
    const fp = 'voter-dup';
    const pairRes = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', fp);
    const token = pairRes.body.voterToken;
    const pairings = pairRes.body.pairings;
    const selections = pairings.map((p: any) => ({
      round: p.round,
      leftImageId: p.left.id,
      rightImageId: p.right.id,
      winnerId: p.left.id,
    }));

    await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .send({ selections });

    const dupRes = await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .send({ selections });
    expect(dupRes.status).toBe(409);
  });

  test('rejects invalid selections', async () => {
    const fp = 'voter-bad-sel';
    const pairRes = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', fp);
    const token = pairRes.body.voterToken;

    const res = await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .send({ selections: [{ round: 0, leftImageId: 'bad', rightImageId: 'bad', winnerId: 'bad' }] });
    expect(res.status).toBe(400);
  });
});

describe('Results and voters', () => {
  let pollId: string;
  let adminToken: string;

  beforeAll(async () => {
    const r = await request(app).post('/api/polls');
    pollId = r.body.pollId;
    adminToken = r.body.adminToken;

    await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'a.png');

    await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'b.png');
  });

  test('results show zero votes initially', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}/results`)
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.totalVotes).toBe(0);
  });

  test('voters list is empty initially', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}/voters`)
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.voters).toEqual([]);
  });

  test('results reflect votes after voting', async () => {
    const fp = 'results-voter';
    const pairRes = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', fp);
    const token = pairRes.body.voterToken;
    const pairings = pairRes.body.pairings;
    const selections = pairings.map((p: any) => ({
      round: p.round,
      leftImageId: p.left.id,
      rightImageId: p.right.id,
      winnerId: p.left.id,
    }));

    await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .send({ selections });

    const res = await request(app)
      .get(`/api/polls/${pollId}/results`)
      .set('x-admin-token', adminToken);
    expect(res.body.totalVotes).toBe(1);
    expect(Object.keys(res.body.imageStats).length).toBe(2);
  });

  test('voters list shows voter after voting', async () => {
    const res = await request(app)
      .get(`/api/polls/${pollId}/voters`)
      .set('x-admin-token', adminToken);
    expect(res.body.total).toBe(1);
    expect(res.body.voters[0]).toHaveProperty('name');
    expect(res.body.voters[0]).toHaveProperty('fingerprint');
    expect(res.body.voters[0].selections.length).toBeGreaterThan(0);
  });
});

describe('Misc', () => {
  test('GET /api/nonexistent returns 404 JSON', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  test('CSRF rejects mismatched origin on vote', async () => {
    const r = await request(app).post('/api/polls');
    const pollId = r.body.pollId;
    const adminToken = r.body.adminToken;

    await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'a.png');
    await request(app)
      .post(`/api/polls/${pollId}/upload`)
      .set('x-admin-token', adminToken)
      .attach('image', png1px, 'b.png');

    const pairRes = await request(app)
      .get(`/api/polls/${pollId}/pairings`)
      .set('x-voter-fingerprint', 'csrf-voter');
    const token = pairRes.body.voterToken;
    const pairings = pairRes.body.pairings;
    const selections = pairings.map((p: any) => ({
      round: p.round,
      leftImageId: p.left.id,
      rightImageId: p.right.id,
      winnerId: p.left.id,
    }));

    const res = await request(app)
      .post(`/api/polls/${pollId}/vote`)
      .set('x-voter-token', token)
      .set('Origin', 'http://evil.com')
      .send({ selections });
    expect(res.status).toBe(403);
  });
});
