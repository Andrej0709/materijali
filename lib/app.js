import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  CLASS_NAME,
  CLASS_CODE,
  SESSION_SECRET,
  DATA_DIR,
  MAX_FILE_MB,
  MAX_FILES,
  BLOB_TOKEN,
  UPLOAD_MODE,
  TYPES,
  ALLOWED_EXT,
  INLINE_TYPES,
  setupError
} from './config.js';
import { getStore } from './store.js';

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// ---------- Šifra odeljenja ----------
const SESSION_COOKIE = 'odeljenje';
const sessionValue = CLASS_CODE ? crypto.createHmac('sha256', SESSION_SECRET).update(CLASS_CODE).digest('hex') : '';

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isAuthed(req) {
  if (!CLASS_CODE) return true;
  const cookie = readCookie(req, SESSION_COOKIE);
  return Boolean(cookie) && safeEqual(cookie, sessionValue);
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Unesi šifru odeljenja.' });
}

function requireSetup(req, res, next) {
  const error = setupError();
  if (error) return res.status(503).json({ error });
  next();
}

// Jednostavno ograničenje pokušaja unosa šifre
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 60_000) {
    entry.count = 0;
    entry.since = now;
  }
  entry.count++;
  attempts.set(ip, entry);
  return entry.count > 10;
}

// ---------- Pomoćne funkcije ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const extOf = (name) => path.extname(name).slice(1).toLowerCase();

// Multer čita ime fajla kao latin1; vraćamo ga u UTF-8 da bi č, ć, š, ž, đ radili.
function fixName(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function publicPost(post) {
  const { deleteTokenHash, ...rest } = post;
  return {
    ...rest,
    likes: post.likes || 0,
    files: post.files.map(({ stored, ...f }) =>
      f.url ? f : { ...f, url: `/files/${f.id}`, downloadUrl: `/files/${f.id}?download` }
    )
  };
}

function contentDisposition(type, name) {
  const fallback = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'fajl';
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Polja zajednička za oba načina slanja. Vraća grešku ili očišćene podatke.
function readPostFields(body) {
  const fields = {
    title: clean(body.title, 120),
    description: clean(body.description, 4000),
    subject: clean(body.subject, 32).toLowerCase(),
    type: clean(body.type, 32),
    author: clean(body.author, 40) || 'Anonimno'
  };
  if (!fields.title) return { error: 'Dodaj naslov.' };
  if (!/^[a-z0-9-]{1,32}$/.test(fields.subject)) return { error: 'Izaberi predmet.' };
  if (!TYPES.has(fields.type)) return { error: 'Izaberi vrstu materijala.' };
  return { fields };
}

function newPost(fields, files) {
  const deleteToken = crypto.randomBytes(24).toString('hex');
  const post = {
    id: crypto.randomBytes(8).toString('hex'),
    ...fields,
    createdAt: new Date().toISOString(),
    likes: 0,
    files,
    deleteTokenHash: sha256(deleteToken)
  };
  return { post, deleteToken };
}

// ---------- Blob (Vercel) ----------
// Putanja koju klijent sam bira: m/<32 hex>/<ime-fajla.ext>
const BLOB_PATH = /^m\/[a-f0-9]{32}\/[A-Za-z0-9._-]{1,120}$/;

function isOurBlobUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.public.blob.vercel-storage.com') &&
      BLOB_PATH.test(decodeURIComponent(url.pathname.slice(1)))
    );
  } catch {
    return false;
  }
}

function readBlobFiles(list) {
  if (!Array.isArray(list)) return { files: [] };
  if (list.length > MAX_FILES) return { error: `Najviše ${MAX_FILES} fajlova odjednom.` };
  const files = [];
  for (const f of list) {
    const name = clean(f?.name, 200);
    const ext = extOf(name);
    const size = Number(f?.size);
    if (!name || !ALLOWED_EXT.has(ext) || !isOurBlobUrl(f?.url) || !Number.isFinite(size) || size < 0) {
      return { error: 'Neispravan fajl u objavi.' };
    }
    const url = new URL(f.url);
    url.search = '';
    const downloadUrl = new URL(url);
    downloadUrl.searchParams.set('download', '1');
    files.push({ id: crypto.randomBytes(12).toString('hex'), name, size, ext, url: url.href, downloadUrl: downloadUrl.href });
  }
  return { files };
}

// ---------- Lokalni upload ----------
let upload;
function localUpload() {
  if (upload) return upload;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => {
        const ext = extOf(fixName(file.originalname));
        cb(null, `${crypto.randomBytes(12).toString('hex')}${ext ? '.' + ext : ''}`);
      }
    }),
    limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES, fields: 10, fieldSize: 20_000 },
    fileFilter: (req, file, cb) => {
      const ext = extOf(fixName(file.originalname));
      if (ALLOWED_EXT.has(ext)) return cb(null, true);
      const err = new Error(`Tip fajla .${ext || '?'} nije dozvoljen.`);
      err.code = 'BAD_TYPE';
      cb(err);
    }
  });
  return upload;
}

function uploadErrorMessage(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `Fajl je veći od ${MAX_FILE_MB} MB.`;
    case 'LIMIT_FILE_COUNT':
      return `Najviše ${MAX_FILES} fajlova odjednom.`;
    case 'BAD_TYPE':
      return err.message;
    default:
      return 'Slanje nije uspelo.';
  }
}

// ---------- Aplikacija ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Vercel ponekad već isparsira telo zahteva; tada ga ne čitamo ponovo
const jsonParser = express.json({ limit: '20kb' });
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return next();
  jsonParser(req, res, next);
});

app.get('/api/session', (req, res) => {
  res.json({
    className: CLASS_NAME,
    required: Boolean(CLASS_CODE),
    authed: isAuthed(req),
    upload: UPLOAD_MODE,
    maxFileMb: MAX_FILE_MB,
    maxFiles: MAX_FILES,
    setupError: setupError()
  });
});

app.post('/api/session', (req, res) => {
  if (!CLASS_CODE) return res.json({ authed: true });
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Previše pokušaja. Sačekaj minut.' });
  const code = String(req.body?.code ?? '').trim();
  if (!safeEqual(code, CLASS_CODE)) return res.status(403).json({ error: 'Pogrešna šifra.' });
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionValue}; Path=/; Max-Age=${60 * 60 * 24 * 180}; HttpOnly; SameSite=Lax${secure}`
  );
  res.json({ authed: true });
});

app.get('/api/posts', requireSetup, requireAuth, async (req, res, next) => {
  try {
    const store = await getStore();
    res.json({ posts: (await store.list()).map(publicPost) });
  } catch (err) {
    next(err);
  }
});

// Vercel Blob: izdaje kratkotrajni token da telefon pošalje fajl direktno u Blob (bez limita od 4,5 MB)
app.post('/api/upload', requireSetup, async (req, res, next) => {
  if (UPLOAD_MODE !== 'blob') return res.status(404).json({ error: 'Nepoznata ruta.' });
  // Obaveštenje od samog Bloba stiže bez kolačića; handleUpload proverava njegov potpis
  if (req.body?.type !== 'blob.upload-completed' && !isAuthed(req)) {
    return res.status(401).json({ error: 'Unesi šifru odeljenja.' });
  }
  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const json = await handleUpload({
      token: BLOB_TOKEN,
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!BLOB_PATH.test(pathname) || !ALLOWED_EXT.has(extOf(pathname))) {
          throw new Error('Tip fajla nije dozvoljen.');
        }
        return {
          maximumSizeInBytes: MAX_FILE_MB * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: false
        };
      }
    });
    res.json(json);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Slanje nije uspelo.' });
  }
});

app.post('/api/posts', requireSetup, requireAuth, async (req, res, next) => {
  try {
    const store = await getStore();

    // Vercel: fajlovi su već u Blobu, stižu samo njihovi linkovi
    if (UPLOAD_MODE === 'blob') {
      const { error, fields } = readPostFields(req.body || {});
      if (error) return res.status(400).json({ error });
      const blob = readBlobFiles(req.body.files);
      if (blob.error) return res.status(400).json({ error: blob.error });
      if (!blob.files.length && !fields.description) {
        return res.status(400).json({ error: 'Dodaj bar jedan fajl ili opis.' });
      }
      const { post, deleteToken } = newPost(fields, blob.files);
      await store.create(post);
      return res.status(201).json({ post: publicPost(post), deleteToken });
    }

    // Lokalno: multipart upload na disk
    localUpload().array('files', MAX_FILES)(req, res, async (err) => {
      const files = req.files || [];
      const cleanup = () => Promise.all(files.map((f) => fsp.unlink(f.path).catch(() => {})));
      try {
        if (err) {
          await cleanup();
          return res.status(400).json({ error: uploadErrorMessage(err) });
        }
        const { error, fields } = readPostFields(req.body || {});
        const finalError = error || (!files.length && !fields.description ? 'Dodaj bar jedan fajl ili opis.' : null);
        if (finalError) {
          await cleanup();
          return res.status(400).json({ error: finalError });
        }
        const { post, deleteToken } = newPost(
          fields,
          files.map((f) => ({
            id: path.parse(f.filename).name,
            name: fixName(f.originalname),
            size: f.size,
            ext: extOf(f.filename),
            stored: f.filename
          }))
        );
        await store.create(post);
        res.status(201).json({ post: publicPost(post), deleteToken });
      } catch (e) {
        next(e);
      }
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/posts/:id/like', requireSetup, requireAuth, async (req, res, next) => {
  try {
    const store = await getStore();
    const likes = await store.like(req.params.id, Math.sign(Number(req.body?.delta) || 0));
    if (likes === null) return res.status(404).json({ error: 'Materijal ne postoji.' });
    res.json({ likes });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/posts/:id', requireSetup, requireAuth, async (req, res, next) => {
  try {
    const store = await getStore();
    const post = await store.get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Materijal ne postoji.' });
    const token = String(req.get('x-delete-token') || '');
    if (!token || !safeEqual(sha256(token), post.deleteTokenHash)) {
      return res.status(403).json({ error: 'Možeš da obrišeš samo svoje materijale.' });
    }
    await store.remove(post.id);

    const blobUrls = post.files.filter((f) => f.url).map((f) => f.url);
    if (blobUrls.length) {
      const { del } = await import('@vercel/blob');
      await del(blobUrls, { token: BLOB_TOKEN }).catch((e) => console.error('Brisanje iz Bloba nije uspelo:', e));
    }
    await Promise.all(
      post.files.filter((f) => f.stored).map((f) => fsp.unlink(path.join(UPLOAD_DIR, f.stored)).catch(() => {}))
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Lokalni fajlovi (na Vercelu fajlovi stižu direktno iz Bloba)
app.get('/files/:id', requireAuth, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.sendStatus(404);
    const store = await getStore();
    const posts = await store.list();
    const file = posts.flatMap((p) => p.files).find((f) => f.id === req.params.id && f.stored);
    if (!file) return res.sendStatus(404);

    const inlineType = INLINE_TYPES[file.ext];
    const download = 'download' in req.query || !inlineType;
    res.setHeader('Content-Type', inlineType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', file.name));
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.sendFile(path.join(UPLOAD_DIR, file.stored), (err) => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Nepoznata ruta.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Greška na serveru. Probaj ponovo.' });
});

export default app;
