import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createPoll, getPoll, updatePoll, generateShareToken, deletePoll, rotateAdminToken } from '../store';
import { requireAdmin, requireAdminOrShare } from '../middleware/auth';
import { uploadLeakyBucket } from '../middleware/rateLimit';
import { Image } from '../../shared/types';
import { processImage } from '../utils/imageProcessor';

const router = Router();

const UPLOADS_DIR = path.resolve(__dirname, '../../../data/uploads');
const MAX_IMAGES = 50;
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const MAGIC_BYTES: Map<string, number[]> = new Map();
const sig = (...bytes: number[]) => bytes;
MAGIC_BYTES.set('png', sig(0x89, 0x50, 0x4E, 0x47));
MAGIC_BYTES.set('jpg', sig(0xFF, 0xD8, 0xFF));
MAGIC_BYTES.set('jpeg', sig(0xFF, 0xD8, 0xFF));
MAGIC_BYTES.set('gif', sig(0x47, 0x49, 0x46, 0x38));
MAGIC_BYTES.set('webp', sig(0x52, 0x49, 0x46, 0x46));
MAGIC_BYTES.set('svg', sig(0x3C));

function validateMagic(filePath: string, ext: string): boolean {
  const sigs = MAGIC_BYTES.get(ext);
  if (!sigs) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(sigs.length);
    fs.readSync(fd, buf, 0, sigs.length, 0);
    fs.closeSync(fd);
    for (let i = 0; i < sigs.length; i++) {
      if (buf[i] !== sigs[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, _file, cb) => {
    const generated = uuid();
    cb(null, `${generated}.tmp`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error('Only .png, .jpg, .jpeg, .gif, .webp, .svg files allowed'));
      return;
    }
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'image/svg+xml') {
      cb(new Error('Only images allowed'));
      return;
    }
    cb(null, true);
  },
});

// Create poll
router.post('/', (_req: Request, res: Response) => {
  const poll = createPoll();
  res.status(201).json({ pollId: poll.id, adminToken: poll.adminToken });
});

// Get poll (admin)
router.get('/:pollId', requireAdmin, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  res.json(poll);
});

// Get poll for public view
router.get('/view/:pollId', (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  const { adminToken, shareToken, ...safe } = poll;
  res.json(safe);
});

// Update poll settings
router.patch('/:pollId', requireAdmin, (req: Request, res: Response) => {
  const allowed = ['title', 'description', 'rounds', 'containerWidth', 'containerHeight', 'fitMode'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    switch (key) {
      case 'title':
        if (typeof req.body[key] !== 'string' || req.body[key].length > 500) return res.status(400).json({ error: `${key} must be a string <= 500 characters` });
        break;
      case 'description':
        if (typeof req.body[key] !== 'string' || req.body[key].length > 5000) return res.status(400).json({ error: `${key} must be a string <= 5000 characters` });
        break;
      case 'rounds':
      case 'containerWidth':
      case 'containerHeight':
        if (typeof req.body[key] !== 'number' || !Number.isFinite(req.body[key]) || req.body[key] < 1) {
          return res.status(400).json({ error: `${key} must be a positive number` });
        }
        if (key === 'containerWidth' || key === 'containerHeight') {
          if (req.body[key] > 10000) return res.status(400).json({ error: `${key} must be <= 10000` });
        }
        if (key === 'rounds' && req.body[key] > 1000) return res.status(400).json({ error: 'rounds must be <= 1000' });
        break;
      case 'fitMode':
        if (!['contain', 'cover', 'scale-down'].includes(req.body[key])) return res.status(400).json({ error: 'fitMode must be contain, cover, or scale-down' });
        break;
    }
    updates[key] = req.body[key];
  }
  const poll = updatePoll(req.params.pollId as string, updates as any);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  res.json(poll);
});

// Upload image
router.post('/:pollId/upload', requireAdmin, uploadLeakyBucket, upload.single('image'), (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  if (poll.images.length >= MAX_IMAGES) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `Max ${MAX_IMAGES} images allowed` });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const origExt = path.extname(req.file.originalname).toLowerCase();
  if (!origExt || !ALLOWED_EXTENSIONS.has(origExt)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid file extension.' });
  }

  const cleanExt = origExt.replace(/\./g, '');
  if (!validateMagic(req.file.path, cleanExt)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'File content does not match its extension.' });
  }

  const img = {
    id: uuid().slice(0, 8),
    filename: `${uuid()}${origExt}`,
    originalName: req.file.originalname,
  };
  const finalPath = path.join(UPLOADS_DIR, img.filename);
  fs.renameSync(req.file.path, finalPath);

  poll.images.push(img);
  updatePoll(poll.id, { images: poll.images });
  res.status(201).json(img);
});

// Delete image
router.delete('/:pollId/images/:imgId', requireAdmin, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  const img = poll.images.find((i: Image) => i.id === req.params.imgId);
  if (!img) return res.status(404).json({ error: 'Image not found' });

  const filePath = path.join(UPLOADS_DIR, img.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  poll.images = poll.images.filter((i: Image) => i.id !== req.params.imgId);
  updatePoll(poll.id, { images: poll.images });
  res.json({ ok: true });
});

// Get/regenerate share token
router.get('/:pollId/share', requireAdmin, (req: Request, res: Response) => {
  const token = generateShareToken(req.params.pollId as string);
  if (!token) return res.status(404).json({ error: 'Not found' });
  const poll = getPoll(req.params.pollId as string)!;
  res.json({ shareToken: token, shareUrl: `/vote/${poll.id}` });
});

// Public admin share view
router.get('/:pollId/public', requireAdminOrShare, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  const { adminToken, ...safe } = poll;
  res.json(safe);
});

// Delete poll
router.delete('/:pollId', requireAdmin, (req: Request, res: Response) => {
  const poll = getPoll(req.params.pollId as string);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  for (const img of poll.images) {
    const fp = path.join(UPLOADS_DIR, img.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  deletePoll(req.params.pollId as string);
  res.json({ ok: true });
});

// Rotate admin token
router.post('/:pollId/rotate-token', requireAdmin, (req: Request, res: Response) => {
  const token = req.headers['x-admin-token'] as string;
  const newToken = rotateAdminToken(req.params.pollId as string, token);
  if (!newToken) return res.status(403).json({ error: 'Token rotation failed' });
  res.json({ adminToken: newToken });
});

export default router;
