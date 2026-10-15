import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CLASS_NAME = process.env.CLASS_NAME || 'Naše odeljenje';
export const CLASS_CODE = (process.env.CLASS_CODE || '').trim(); // prazno = bez šifre
export const SESSION_SECRET = process.env.SESSION_SECRET || 'odeljenje';
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

export const MAX_FILE_MB = 25;
export const MAX_FILES = 10;

// Na Vercelu fajlovi idu u Blob, a podaci u Redis. Lokalno sve ide na disk.
// Vercel pri povezivanju ume da doda prefiks (npr. MATERIJALI_BLOB_READ_WRITE_TOKEN), pa tražimo po kraju imena
function findEnv(suffix, valuePrefix = '') {
  for (const [key, value] of Object.entries(process.env)) {
    if (value && key.endsWith(suffix) && value.startsWith(valuePrefix)) return value;
  }
  return '';
}

export const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || findEnv('READ_WRITE_TOKEN', 'vercel_blob_rw_');
// Noviji Blob store-ovi se povezuju preko OIDC-a: Vercel daje samo ID store-a, bez tokena
export const BLOB_STORE_ID = process.env.BLOB_STORE_ID || findEnv('BLOB_STORE_ID');
export const BLOB_WEBHOOK_PUBLIC_KEY = process.env.BLOB_WEBHOOK_PUBLIC_KEY || findEnv('BLOB_WEBHOOK_PUBLIC_KEY');
// Javna adresa Blob store-a (store_ABC123 → abc123.public.blob.vercel-storage.com); isto računa middleware.js
function blobPublicHost() {
  if (process.env.BLOB_PUBLIC_HOST) return process.env.BLOB_PUBLIC_HOST;
  const id = (BLOB_STORE_ID || BLOB_TOKEN.split('_')[3] || '').replace(/^store_/, '').toLowerCase();
  return id ? `${id}.public.blob.vercel-storage.com` : null;
}
export const BLOB_PUBLIC_HOST = blobPublicHost();
export const BLOB_AUTH = BLOB_TOKEN ? 'token' : BLOB_STORE_ID ? 'oidc' : null;
export const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || findEnv('KV_REST_API_URL') || findEnv('REDIS_REST_URL');
export const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || findEnv('KV_REST_API_TOKEN') || findEnv('REDIS_REST_TOKEN');
export const ON_VERCEL = Boolean(process.env.VERCEL);

// Backblaze B2 / Cloudflare R2 (S3): kad su podešeni, novi fajlovi idu tamo umesto u Vercel Blob
export const S3_ENDPOINT = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
export const S3_BUCKET = (process.env.S3_BUCKET || '').trim();
export const S3_ACCESS_KEY_ID = (process.env.S3_ACCESS_KEY_ID || '').trim();
export const S3_SECRET_ACCESS_KEY = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
// B2 ima region u adresi (s3.eu-central-003.backblazeb2.com); R2 koristi "auto"
export const S3_REGION =
  (process.env.S3_REGION || '').trim() || S3_ENDPOINT.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1] || 'auto';
export const S3_READY = Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);

export const UPLOAD_MODE = S3_READY ? 's3' : BLOB_AUTH ? 'blob' : 'local';

export function setupError() {
  if (!ON_VERCEL) return null;
  const missing = [];
  if (!BLOB_AUTH && !S3_READY) missing.push('skladište za fajlove (Vercel Blob ili B2/R2)');
  if (!REDIS_URL || !REDIS_TOKEN) missing.push('Upstash Redis');
  if (!missing.length) return null;
  return `Na Vercelu nije povezano: ${missing.join(' i ')}. Poveži ga u Storage (za Production), pa uradi Redeploy.`;
}

// Mora da se poklapa sa TYPES u public/js/config.js
export const TYPES = new Set(['odgovaranje', 'domaci', 'test', 'beleske']);

export const ALLOWED_EXT = new Set([
  'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md',
  'ppt', 'pptx', 'odp', 'key',
  'xls', 'xlsx', 'ods', 'csv',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif',
  'mp3', 'm4a', 'wav', 'ogg',
  'mp4', 'mov', 'webm',
  'zip', 'rar', '7z',
  'py', 'java', 'c', 'cpp', 'cs', 'js', 'ts', 'html', 'css', 'json', 'sql', 'ipynb', 'ggb'
]);

// Lokalni režim: samo ovi tipovi smeju da se otvore direktno u browseru; ostalo se preuzima.
export const INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  txt: 'text/plain; charset=utf-8'
};
