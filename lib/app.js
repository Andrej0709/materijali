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
  BLOB_STORE_ID,
  BLOB_WEBHOOK_PUBLIC_KEY,
  BLOB_AUTH,
  BLOB_PUBLIC_HOST,
  ON_VERCEL,
  UPLOAD_MODE,
  TYPES,
  ALLOWED_EXT,
  INLINE_TYPES,
  setupError
} from './config.js';
import { getStore } from './store.js';
import { presignUpload, presignDownload, headObject, deleteObjects, ensureCors } from './s3.js';

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

// Linkovi zavise od toga gde je fajl: B2/R2 (potpisan link), Vercel Blob (javni link) ili lokalni disk
async function publicFile({ stored, key, ...f }) {
  if (key) {
    const [url, downloadUrl] = await Promise.all([
      presignDownload(key),
      presignDownload(key, { download: true, name: f.name })
    ]);
    return { ...f, url, downloadUrl };
  }
  if (f.url) {
    // Fajl iz Bloba se otvara preko adrese aplikacije (/f/...), middleware.js ga dovlači i proverava šifru
    const url = new URL(f.url);
    if (url.host === BLOB_PUBLIC_HOST) {
      const local = `/f${url.pathname}`;
      return { ...f, url: local, downloadUrl: `${local}?download` };
    }
    return f;
  }
  return { ...f, url: `/files/${f.id}`, downloadUrl: `/files/${f.id}?download` };
}

async function publicPost(post) {
  const { deleteTokenHash, ...rest } = post;
  return { ...rest, likes: post.likes || 0, files: await Promise.all(post.files.map(publicFile)) };
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

// ---------- B2 / R2 (S3) ----------
const CONTENT_TYPES = {
  ...INLINE_TYPES,
  heic: 'image/heic',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function slugify(name) {
  const ext = extOf(name);
  const base = name
    .replace(/.[^.]+$/, '')
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'fajl'}${ext ? '.' + ext : ''}`;
}

async function readS3Files(list) {
  if (!Array.isArray(list)) return { files: [] };
  if (list.length > MAX_FILES) return { error: `Najviše ${MAX_FILES} fajlova odjednom.` };
  const files = [];
  for (const f of list) {
    const name = clean(f?.name, 200);
    const key = String(f?.key || '');
    if (!name || !ALLOWED_EXT.has(extOf(name)) || !BLOB_PATH.test(key)) return { error: 'Neispravan fajl u objavi.' };
    // Proveravamo da je fajl zaista stigao u bucket i uzimamo njegovu pravu veličinu
    const head = await headObject(key);
    if (!head) return { error: 'Fajl nije stigao do skladišta. Probaj ponovo.' };
    files.push({ id: crypto.randomBytes(12).toString('hex'), name, size: Number(head.ContentLength) || 0, ext: extOf(name), key });
  }
  return { files };
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
  const authed = isAuthed(req);
  const session = { className: CLASS_NAME, required: Boolean(CLASS_CODE), authed, setupError: setupError() };
  // Detalje o skladištu vide samo oni koji su uneli šifru
  if (authed) Object.assign(session, { upload: UPLOAD_MODE, blobAuth: BLOB_AUTH, maxFileMb: MAX_FILE_MB, maxFiles: MAX_FILES });
  res.json(session);
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
    res.json({ posts: await Promise.all((await store.list()).map(publicPost)) });
  } catch (err) {
    next(err);
  }
});

// Vercel Blob: telefon dobija kratkotrajnu dozvolu i šalje fajl direktno u Blob (bez limita od 4,5 MB)
// Vercel šalje OIDC token funkciji u zaglavlju zahteva; prosleđujemo ga eksplicitno
function oidcOptions(req) {
  const oidcToken = req.get('x-vercel-oidc-token');
  return oidcToken ? { storeId: BLOB_STORE_ID, oidcToken } : { storeId: BLOB_STORE_ID };
}

function checkBlobPath(pathname) {
  if (!BLOB_PATH.test(pathname) || !ALLOWED_EXT.has(extOf(pathname))) throw new Error('Tip fajla nije dozvoljen.');
}

app.post('/api/upload', requireSetup, async (req, res, next) => {
  // B2 / R2: server izdaje potpisan link za jedan fajl, telefon ga šalje direktno u bucket
  if (UPLOAD_MODE === 's3') {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unesi šifru odeljenja.' });
    const name = clean(req.body?.name, 200);
    const size = Number(req.body?.size);
    const ext = extOf(name);
    if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: `Tip fajla .${ext || '?'} nije dozvoljen.` });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_MB * 1024 * 1024) {
      return res.status(400).json({ error: `Fajl je veći od ${MAX_FILE_MB} MB.` });
    }
    try {
      await ensureCors();
      const key = `m/${crypto.randomBytes(16).toString('hex')}/${slugify(name)}`;
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      const uploadUrl = await presignUpload(key, contentType, size);
      return res.json({ uploadUrl, key, contentType });
    } catch (err) {
      return next(err);
    }
  }
  if (UPLOAD_MODE !== 'blob') return res.status(404).json({ error: 'Nepoznata ruta.' });
  // Obaveštenje od samog Bloba stiže bez kolačića; SDK proverava njegov potpis
  if (req.body?.type !== 'blob.upload-completed' && !isAuthed(req)) {
    return res.status(401).json({ error: 'Unesi šifru odeljenja.' });
  }
  const maximumSizeInBytes = MAX_FILE_MB * 1024 * 1024;
  try {
    const client = await import('@vercel/blob/client');
    let json;
    if (BLOB_AUTH === 'token') {
      json = await client.handleUpload({
        token: BLOB_TOKEN,
        body: req.body,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          checkBlobPath(pathname);
          return { maximumSizeInBytes, addRandomSuffix: false, allowOverwrite: false };
        }
      });
    } else {
      // OIDC: Vercel sam daje identitet funkcije, a mi izdajemo presigned link za jedan fajl
      const { issueSignedToken } = await import('@vercel/blob');
      json = await client.handleUploadPresigned({
        body: req.body,
        request: req,
        webhookPublicKey: BLOB_WEBHOOK_PUBLIC_KEY || 'nije-podeseno',
        getSignedToken: async (pathname) => {
          checkBlobPath(pathname);
          const validUntil = Date.now() + 30 * 60 * 1000;
          const token = await issueSignedToken({
            ...oidcOptions(req),
            pathname,
            operations: ['put'],
            maximumSizeInBytes,
            validUntil
          });
          return { token, urlOptions: { validUntil, maximumSizeInBytes, addRandomSuffix: false, allowOverwrite: false } };
        }
      });
    }
    res.json(json);
  } catch (err) {
    console.error('Blob upload:', err);
    res.status(400).json({ error: err.message || 'Slanje nije uspelo.' });
  }
});

app.post('/api/posts', requireSetup, requireAuth, async (req, res, next) => {
  try {
    const store = await getStore();

    // Na Vercelu su fajlovi već u B2/R2 ili Blobu, stižu samo njihovi ključevi/linkovi
    if (UPLOAD_MODE === 's3' || UPLOAD_MODE === 'blob') {
      const { error, fields } = readPostFields(req.body || {});
      if (error) return res.status(400).json({ error });
      const blob = UPLOAD_MODE === 's3' ? await readS3Files(req.body.files) : readBlobFiles(req.body.files);
      if (blob.error) return res.status(400).json({ error: blob.error });
      if (!blob.files.length && !fields.description) {
        return res.status(400).json({ error: 'Dodaj bar jedan fajl ili opis.' });
      }
      const { post, deleteToken } = newPost(fields, blob.files);
      await store.create(post);
      return res.status(201).json({ post: await publicPost(post), deleteToken });
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
        res.status(201).json({ post: await publicPost(post), deleteToken });
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

    const s3Keys = post.files.filter((f) => f.key).map((f) => f.key);
    if (s3Keys.length) await deleteObjects(s3Keys).catch((e) => console.error('Brisanje iz B2/R2 nije uspelo:', e));

    const blobUrls = post.files.filter((f) => f.url).map((f) => f.url);
    if (blobUrls.length) {
      const { del } = await import('@vercel/blob');
      await del(blobUrls, BLOB_AUTH === 'token' ? { token: BLOB_TOKEN } : oidcOptions(req)).catch((e) => console.error('Brisanje iz Bloba nije uspelo:', e));
    }
    await Promise.all(
      post.files.filter((f) => f.stored).map((f) => fsp.unlink(path.join(UPLOAD_DIR, f.stored)).catch(() => {}))
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Lokalno nema middleware-a, pa /f/ linkove samo preusmeravamo na Blob
app.get(/^\/f\/(m\/[a-f0-9]{32}\/[A-Za-z0-9._-]{1,120})$/, requireAuth, (req, res) => {
  if (ON_VERCEL || !BLOB_PUBLIC_HOST) return res.sendStatus(404);
  const target = new URL(`https://${BLOB_PUBLIC_HOST}/${req.params[0]}`);
  if ('download' in req.query) target.searchParams.set('download', '1');
  res.redirect(target.href);
});

// Lokalni fajlovi (na Vercelu fajlovi stižu iz Bloba ili B2/R2)
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
