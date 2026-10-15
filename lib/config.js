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
export const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
export const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
export const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
export const ON_VERCEL = Boolean(process.env.VERCEL);

export const UPLOAD_MODE = BLOB_TOKEN ? 'blob' : 'local';

export function setupError() {
  if (!ON_VERCEL) return null;
  const missing = [];
  if (!BLOB_TOKEN) missing.push('Vercel Blob');
  if (!REDIS_URL || !REDIS_TOKEN) missing.push('Upstash Redis');
  return missing.length ? `Na Vercelu nije povezano: ${missing.join(' i ')}. Pogledaj README.` : null;
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
