// Vercel Routing Middleware: fajlovi se otvaraju preko adrese aplikacije (/f/...), a ne preko
// adrese skladišta. Vercel u pozadini dovlači fajl iz Bloba, a pre toga proverava šifru odeljenja.
import { rewrite } from '@vercel/functions';

export const config = { matcher: '/f/:path*' };

const FILE_PATH = /^m\/[a-f0-9]{32}\/[A-Za-z0-9._-]{1,120}$/;
const encoder = new TextEncoder();

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Javna adresa Blob store-a: store_ABC123 → abc123.public.blob.vercel-storage.com
function blobHost() {
  if (process.env.BLOB_PUBLIC_HOST) return process.env.BLOB_PUBLIC_HOST;
  const storeId = process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN?.split('_')[3] || '';
  const id = storeId.replace(/^store_/, '').toLowerCase();
  return id ? `${id}.public.blob.vercel-storage.com` : null;
}

const notFound = () => new Response('Fajl nije pronađen.', { status: 404 });

export default async function middleware(request) {
  const url = new URL(request.url);

  const code = (process.env.CLASS_CODE || '').trim();
  if (code) {
    const expected = await hmacHex(process.env.SESSION_SECRET || 'odeljenje', code);
    if (readCookie(request, 'odeljenje') !== expected) {
      return new Response('Unesi šifru odeljenja u aplikaciji.', { status: 401 });
    }
  }

  const path = decodeURIComponent(url.pathname.replace(/^\/f\//, ''));
  const host = blobHost();
  if (!FILE_PATH.test(path) || !host) return notFound();

  const target = new URL(`https://${host}/${path}`);
  if (url.searchParams.has('download')) target.searchParams.set('download', '1');
  return rewrite(target);
}
