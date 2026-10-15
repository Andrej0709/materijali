import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, REDIS_URL, REDIS_TOKEN } from './config.js';

// Isti interfejs za oba skladišta:
// list() · get(id) · create(post) · like(id, delta) · remove(id)

function sortNewest(posts) {
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Lokalno: JSON fajl na disku ----------
function createFileStore() {
  const file = path.join(DATA_DIR, 'db.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let db = { posts: [] };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Ne mogu da pročitam bazu, krećem od prazne:', err.message);
  }

  let queue = Promise.resolve();
  function save() {
    queue = queue
      .then(async () => {
        await fsp.writeFile(file + '.tmp', JSON.stringify(db, null, 2));
        await fsp.rename(file + '.tmp', file);
      })
      .catch((err) => console.error('Greška pri čuvanju baze:', err));
    return queue;
  }

  return {
    async list() {
      return sortNewest([...db.posts]);
    },
    async get(id) {
      return db.posts.find((p) => p.id === id) || null;
    },
    async create(post) {
      db.posts.unshift(post);
      await save();
    },
    async like(id, delta) {
      const post = db.posts.find((p) => p.id === id);
      if (!post) return null;
      post.likes = Math.max(0, (post.likes || 0) + delta);
      await save();
      return post.likes;
    },
    async remove(id) {
      const index = db.posts.findIndex((p) => p.id === id);
      if (index === -1) return null;
      const [post] = db.posts.splice(index, 1);
      await save();
      return post;
    }
  };
}

// ---------- Vercel: Upstash Redis ----------
async function createRedisStore() {
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  const POSTS = 'odeljenje:posts';
  const LIKES = 'odeljenje:likes'; // poseban hash da bi brojanje bilo atomično

  return {
    async list() {
      const [posts, likes] = await Promise.all([redis.hgetall(POSTS), redis.hgetall(LIKES)]);
      return sortNewest(
        Object.values(posts || {}).map((p) => ({ ...p, likes: Number(likes?.[p.id]) || 0 }))
      );
    },
    async get(id) {
      return (await redis.hget(POSTS, id)) || null;
    },
    async create(post) {
      const { likes, ...rest } = post;
      await redis.hset(POSTS, { [post.id]: rest });
    },
    async like(id, delta) {
      if (!(await redis.hexists(POSTS, id))) return null;
      let likes = await redis.hincrby(LIKES, id, delta);
      if (likes < 0) {
        await redis.hset(LIKES, { [id]: 0 });
        likes = 0;
      }
      return likes;
    },
    async remove(id) {
      const post = await redis.hget(POSTS, id);
      if (!post) return null;
      await Promise.all([redis.hdel(POSTS, id), redis.hdel(LIKES, id)]);
      return post;
    }
  };
}

let storePromise;
export function getStore() {
  storePromise ||= REDIS_URL && REDIS_TOKEN ? createRedisStore() : Promise.resolve(createFileStore());
  return storePromise;
}
