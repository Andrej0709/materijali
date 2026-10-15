import { SUBJECTS, TYPES, MAX_FILE_MB, MAX_FILES, ALLOWED_EXT } from './config.js';
import { Spring, springEasing, prefersReducedMotion, rubberband, velocityFrom } from './spring.js';
import { Sheet } from './sheet.js';
import { celebrate } from './confetti.js';

// ============ Stanje ============
const state = {
  posts: [],
  type: 'all',
  subject: 'all',
  query: '',
  loaded: false,
  // Server javlja da li fajlovi idu direktno u Vercel Blob ili na lokalni disk
  session: { upload: 'local', maxFileMb: MAX_FILE_MB, maxFiles: MAX_FILES }
};

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* privatni režim — samo ne pamtimo */
    }
  }
};

const liked = new Set(store.get('liked', []));
const tokens = store.get('tokens', {}); // postId -> deleteToken

const $ = (sel, root = document) => root.querySelector(sel);
const grid = $('#grid');
const subjectById = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));
const typeById = Object.fromEntries(TYPES.map((t) => [t.id, t]));

// ============ Pomoćno ============
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fold = (s) =>
  String(s)
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const DAYS = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];
const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function relativeTime(iso) {
  const date = new Date(iso);
  const diff = (Date.now() - date) / 1000;
  if (diff < 60) return 'upravo sada';
  if (diff < 3600) return `pre ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `pre ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'juče';
  if (days < 7) return `pre ${days} ${plural(days, 'dan', 'dana', 'dana')}`;
  return `${date.getDate()}. ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

function fullDate(iso) {
  const d = new Date(iso);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}. u ${time}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const EXT_COLORS = [
  [['pdf'], '#FF3B30'],
  [['doc', 'docx', 'odt', 'rtf', 'txt', 'md'], '#007AFF'],
  [['ppt', 'pptx', 'odp', 'key'], '#FF9500'],
  [['xls', 'xlsx', 'ods', 'csv'], '#34C759'],
  [['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'], '#AF52DE'],
  [['mp3', 'm4a', 'wav', 'ogg'], '#FF2D55'],
  [['mp4', 'mov', 'webm'], '#5856D6'],
  [['zip', 'rar', '7z'], '#8E8E93']
];
function extColor(ext) {
  for (const [list, color] of EXT_COLORS) if (list.includes(ext)) return color;
  return '#30B0C7';
}

const AVATAR_COLORS = ['#007AFF', '#FF9500', '#34C759', '#AF52DE', '#FF2D55', '#5856D6', '#00C7BE', '#FF3B30'];
function avatarColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const ICONS = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  share: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 7.5 12 3.5l4 4"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v7A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>'
};

function haptic(pattern = 10) {
  navigator.vibrate?.(pattern);
}

function shake(el) {
  if (prefersReducedMotion()) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(7px)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(0)' }
    ],
    { duration: 420, easing: 'ease-out' }
  );
}

// ============ API ============
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...options, headers });
  } catch {
    throw new Error('Nema veze sa serverom.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) showGate();
  if (!res.ok) throw new Error(data.error || 'Nešto nije u redu.');
  return data;
}

function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/posts');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status === 401) showGate();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || 'Slanje nije uspelo.'));
    };
    xhr.onerror = () => reject(new Error('Nema veze sa serverom.'));
    xhr.send(formData);
  });
}

// ============ Toast ============
function toast(message, kind = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = `${kind === 'error' ? ICONS.alert : ICONS.check}<span></span>`;
  el.querySelector('span').textContent = message;
  $('#toasts').append(el);

  const hidden = { transform: 'translateY(-28px) scale(0.94)', opacity: 0 };
  const shown = { transform: 'none', opacity: 1 };
  const { easing, duration } = springEasing({ damping: 1, response: 0.42 });
  el.animate([hidden, shown], { duration, easing, fill: 'both' });
  setTimeout(() => {
    // Izlazi istim putem kojim je ušao
    el.animate([shown, hidden], { duration: 260, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () =>
      el.remove();
  }, 3200);
}

// ============ Segmentirana kontrola sa oprugom ============
function createSegmented(container, items, { initial, onChange, role = 'tab' }) {
  const indicator = container.querySelector('.segmented-indicator');
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', role);
    b.dataset.value = item.id;
    b.textContent = item.label;
    container.append(b);
    return b;
  });

  const x = new Spring(0, { damping: 1, response: 0.34, precision: 0.1, onUpdate: render });
  const w = new Spring(0, { damping: 1, response: 0.34, precision: 0.1, onUpdate: render });
  function render() {
    indicator.style.transform = `translateX(${x.value}px)`;
    indicator.style.width = `${w.value}px`;
  }

  let value = initial;
  function select(next, { animate = true } = {}) {
    value = next;
    const attr = role === 'tab' ? 'aria-selected' : 'aria-checked';
    let active = null;
    for (const b of buttons) {
      const on = b.dataset.value === next;
      b.setAttribute(attr, String(on));
      if (on) active = b;
    }
    if (!active) {
      indicator.style.opacity = '0';
      return;
    }
    indicator.style.opacity = '1';
    // Ako je pre bio sakriven, nema odakle da klizi
    const from = animate && w.value > 0;
    if (from) {
      x.to(active.offsetLeft);
      w.to(active.offsetWidth);
    } else {
      x.set(active.offsetLeft);
      w.set(active.offsetWidth);
    }
  }

  container.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.dataset.value === value) return;
    select(b.dataset.value);
    b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    onChange?.(b.dataset.value);
  });

  new ResizeObserver(() => value && select(value, { animate: false })).observe(container);
  select(initial, { animate: false });
  return {
    get value() {
      return value;
    },
    select
  };
}

function chipHtml(subject, attr) {
  return `<button type="button" class="chip" style="--c:${subject.color}" data-value="${subject.id}" ${attr}="false"><span class="dot"></span>${escapeHtml(subject.name)}</button>`;
}

// ============ Filteri ============
const typeFilter = createSegmented($('#type-filter'), [{ id: 'all', label: 'Sve' }, ...TYPES.map((t) => ({ id: t.id, label: t.short }))], {
  initial: 'all',
  onChange: (v) => {
    state.type = v;
    renderGrid();
  }
});

const subjectFilter = $('#subject-filter');
subjectFilter.innerHTML =
  chipHtml({ id: 'all', name: 'Svi predmeti', color: 'var(--text-2)' }, 'aria-selected') +
  SUBJECTS.map((s) => chipHtml(s, 'aria-selected')).join('');
subjectFilter.querySelectorAll('.chip').forEach((c) => c.setAttribute('role', 'tab'));
subjectFilter.querySelector('[data-value="all"]').setAttribute('aria-selected', 'true');
subjectFilter.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.subject = chip.dataset.value;
  subjectFilter.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
  chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  renderGrid();
});

let searchTimer = 0;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = fold(e.target.value.trim());
    renderGrid();
  }, 90);
});

function filteredPosts() {
  return state.posts.filter((p) => {
    if (state.type !== 'all' && p.type !== state.type) return false;
    if (state.subject !== 'all' && p.subject !== state.subject) return false;
    if (state.query) {
      const hay = fold(
        [p.title, p.description, p.author, subjectById[p.subject]?.name, ...p.files.map((f) => f.name)].join(' ')
      );
      return state.query.split(/\s+/).every((word) => hay.includes(word));
    }
    return true;
  });
}

// ============ Kartice ============
const cards = new Map(); // postId -> element

function fileChipsHtml(files) {
  const counts = new Map();
  for (const f of files) counts.set(f.ext, (counts.get(f.ext) || 0) + 1);
  return [...counts]
    .slice(0, 4)
    .map(
      ([ext, n]) =>
        `<span class="file-chip" style="--fc:${extColor(ext)}"><b>${escapeHtml(ext || '?')}</b>${n} ${plural(n, 'fajl', 'fajla', 'fajlova')}</span>`
    )
    .join('');
}

function likeButtonHtml(post, text = '') {
  const on = liked.has(post.id);
  return `<button type="button" class="like" data-like="${post.id}" aria-pressed="${on}" aria-label="${on ? 'Ukloni zahvalnicu' : 'Zahvali se'}">${ICONS.heart}<span>${post.likes || 0}</span>${text}</button>`;
}

function createCard(post) {
  const subject = subjectById[post.subject] || subjectById.ostalo;
  const type = typeById[post.type];
  const cover = post.files.find((f) => IMAGE_EXT.has(f.ext));
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;
  el.dataset.id = post.id;
  el.style.setProperty('--c', subject.color);
  el.setAttribute('aria-label', post.title);
  el.innerHTML = `
    ${cover ? `<div class="card-cover"><img loading="lazy" decoding="async" alt="" src="${escapeHtml(cover.url)}"></div>` : '<div class="card-band"></div>'}
    <div class="card-body">
      <div class="tags">
        <span class="tag tag-subject"><i></i>${escapeHtml(subject.name)}</span>
        ${type ? `<span class="tag tag-type">${escapeHtml(type.short)}</span>` : ''}
      </div>
      <h3 class="card-title">${escapeHtml(post.title)}</h3>
      ${post.description ? `<p class="card-desc">${escapeHtml(post.description)}</p>` : ''}
      ${post.files.length ? `<div class="file-chips">${fileChipsHtml(post.files)}</div>` : ''}
      <footer class="card-foot">
        <span class="avatar" style="--c:${avatarColor(post.author)}">${escapeHtml(post.author.slice(0, 1).toUpperCase())}</span>
        <span class="author">${escapeHtml(post.author)}</span>
        <span class="sep">·</span>
        <time datetime="${post.createdAt}">${relativeTime(post.createdAt)}</time>
        ${likeButtonHtml(post)}
      </footer>
    </div>`;
  const img = el.querySelector('.card-cover img');
  if (img) {
    const show = () => img.classList.add('is-loaded');
    img.complete ? show() : img.addEventListener('load', show, { once: true });
  }
  return el;
}

function updateCard(el, post) {
  el.querySelector('time').textContent = relativeTime(post.createdAt);
  const count = el.querySelector('.like span');
  if (count.textContent !== String(post.likes || 0)) count.textContent = post.likes || 0;
}

grid.addEventListener('click', (e) => {
  const likeBtn = e.target.closest('[data-like]');
  if (likeBtn) {
    e.stopPropagation();
    toggleLike(likeBtn.dataset.like);
    return;
  }
  const card = e.target.closest('.card');
  if (card && !card.classList.contains('is-exiting')) openDetail(card.dataset.id, card);
});

grid.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
    e.preventDefault();
    openDetail(e.target.dataset.id, e.target);
  }
});

// FLIP raspored: kartice klize na nova mesta oprugom, od trenutne (vidljive) pozicije
function renderGrid({ highlight, stagger = false } = {}) {
  const reduce = prefersReducedMotion();
  const visible = filteredPosts();
  const keep = new Set(visible.map((p) => p.id));
  const gridRect = grid.getBoundingClientRect();

  // FIRST — uključuje transformacije animacija u toku (prekidivo)
  const first = new Map();
  for (const [id, el] of cards) if (el.isConnected) first.set(id, el.getBoundingClientRect());

  // Izlaz: kartica ostaje na svom mestu (apsolutno) i nestaje
  for (const [id, el] of cards) {
    if (keep.has(id) || !el.isConnected || el.classList.contains('is-exiting')) continue;
    const r = first.get(id);
    el.getAnimations().forEach((a) => a.cancel());
    el.classList.add('is-exiting');
    Object.assign(el.style, {
      position: 'absolute',
      left: `${r.left - gridRect.left}px`,
      top: `${r.top - gridRect.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      zIndex: '0'
    });
    const anim = el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94)' }], {
      duration: reduce ? 120 : 200,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards'
    });
    anim.onfinish = () => {
      if (el.classList.contains('is-exiting')) el.remove();
    };
  }

  // Ažuriranje DOM-a po redosledu
  let index = 0;
  for (const post of visible) {
    let el = cards.get(post.id);
    if (!el) {
      el = createCard(post);
      cards.set(post.id, el);
    } else {
      updateCard(el, post);
      if (el.classList.contains('is-exiting')) {
        el.classList.remove('is-exiting');
        el.getAnimations().forEach((a) => a.cancel());
        el.removeAttribute('style');
        el.style.setProperty('--c', (subjectById[post.subject] || subjectById.ostalo).color);
      }
    }
    const at = grid.children[index];
    if (at !== el) grid.insertBefore(el, at || null);
    index++;
  }

  // LAST + PLAY
  const move = springEasing({ damping: 1, response: 0.45 });
  const enter = springEasing({ damping: 1, response: 0.5 });
  const pop = springEasing({ damping: 0.72, response: 0.5 });
  let entering = 0;
  for (const post of visible) {
    const el = cards.get(post.id);
    const was = first.get(post.id);
    el.getAnimations().forEach((a) => a.cancel());

    if (reduce) {
      if (!was) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease' });
      continue;
    }
    if (post.id === highlight) {
      el.animate(
        [
          { opacity: 0, transform: 'translateY(-24px) scale(0.86)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: pop.duration, easing: pop.easing }
      );
      continue;
    }
    if (!was) {
      const delay = stagger ? Math.min(entering, 10) * 45 : 0;
      entering++;
      el.animate(
        [
          { opacity: 0, transform: 'translateY(18px) scale(0.97)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: enter.duration, easing: enter.easing, delay, fill: 'backwards' }
      );
      continue;
    }
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: move.duration,
        easing: move.easing
      });
    }
  }

  renderEmpty(visible.length);
}

function renderEmpty(count) {
  const empty = $('#empty');
  const wasHidden = empty.hidden;
  empty.hidden = !state.loaded || count > 0;
  if (empty.hidden) return;
  const filtering = state.posts.length > 0;
  $('#empty-title').textContent = filtering ? 'Ništa ne odgovara filteru' : 'Još nema materijala';
  $('#empty-text').textContent = filtering
    ? 'Probaj drugi predmet ili vrstu, ili dodaj materijal koji fali.'
    : 'Budi prvi koji će podeliti nešto sa odeljenjem.';
  if (wasHidden && !prefersReducedMotion()) {
    const { easing, duration } = springEasing({ damping: 1, response: 0.5 });
    empty.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration, easing });
  }
}

function renderStats() {
  const n = state.posts.length;
  const weekAgo = Date.now() - 7 * 86400 * 1000;
  const fresh = state.posts.filter((p) => new Date(p.createdAt) > weekAgo).length;
  let text = `${n} ${plural(n, 'materijal', 'materijala', 'materijala')}`;
  if (fresh) text += ` · ${fresh} ${plural(fresh, 'novi', 'nova', 'novih')} ove nedelje`;
  if (!n) text = 'Sve za odgovaranje, domaće i kontrolne — na jednom mestu.';
  $('#stats').textContent = text;
}

// ============ Zahvalnice (srce) ============
async function toggleLike(id) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;
  const on = !liked.has(id);
  on ? liked.add(id) : liked.delete(id);
  post.likes = Math.max(0, (post.likes || 0) + (on ? 1 : -1));
  store.set('liked', [...liked]);
  syncLikeButtons(post, on);
  if (on) haptic(8);

  try {
    const { likes } = await api(`/api/posts/${id}/like`, { method: 'POST', body: JSON.stringify({ delta: on ? 1 : -1 }) });
    post.likes = likes;
    syncLikeButtons(post);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function syncLikeButtons(post, popped) {
  const pop = springEasing({ damping: 0.45, response: 0.38 });
  document.querySelectorAll(`[data-like="${post.id}"]`).forEach((btn) => {
    const on = liked.has(post.id);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Ukloni zahvalnicu' : 'Zahvali se');
    btn.querySelector('span').textContent = post.likes || 0;
    if (popped && !prefersReducedMotion()) {
      btn.querySelector('svg').animate([{ transform: 'scale(0.55)' }, { transform: 'scale(1)' }], {
        duration: pop.duration,
        easing: pop.easing
      });
    }
  });
}

// ============ Detalji ============
const detailSheet = new Sheet($('#detail-sheet'));
const detailBody = $('#detail-body');

function openDetail(id, trigger) {
  const post = state.posts.find((p) => p.id === id);
  if (!post) return;
  const subject = subjectById[post.subject] || subjectById.ostalo;
  const type = typeById[post.type];
  const images = post.files.filter((f) => IMAGE_EXT.has(f.ext));
  const canDelete = Boolean(tokens[post.id]);

  detailBody.innerHTML = `
    <div class="detail-head" style="--c:${subject.color}">
      <div class="tags">
        <span class="tag tag-subject"><i></i>${escapeHtml(subject.name)}</span>
        ${type ? `<span class="tag tag-type">${escapeHtml(type.name)}</span>` : ''}
      </div>
      <h2 class="detail-title" id="detail-title">${escapeHtml(post.title)}</h2>
      <div class="detail-meta">
        <span class="avatar" style="--c:${avatarColor(post.author)}">${escapeHtml(post.author.slice(0, 1).toUpperCase())}</span>
        <span><b class="author">${escapeHtml(post.author)}</b> · ${fullDate(post.createdAt)}</span>
      </div>
    </div>
    ${post.description ? `<p class="detail-desc">${escapeHtml(post.description)}</p>` : ''}
    ${
      images.length
        ? `<div class="gallery">${images
            .map((f) => `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(f.url)}" alt="${escapeHtml(f.name)}"></a>`)
            .join('')}</div>`
        : ''
    }
    ${
      post.files.length
        ? `<div class="files"><h3>${post.files.length} ${plural(post.files.length, 'fajl', 'fajla', 'fajlova')}</h3>${post.files
            .map(
              (f) => `
          <div class="file-row" style="--fc:${extColor(f.ext)}">
            <span class="file-badge">${escapeHtml(f.ext || '?')}</span>
            <a class="file-meta file-open" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">
              <span class="file-name">${escapeHtml(f.name)}</span><span class="file-size">${formatSize(f.size)} · Otvori</span>
            </a>
            <a class="icon-btn icon-btn-tinted" href="${escapeHtml(f.downloadUrl)}" download aria-label="Preuzmi ${escapeHtml(f.name)}">${ICONS.download}</a>
          </div>`
            )
            .join('')}</div>`
        : ''
    }
    <div class="detail-actions">
      ${likeButtonHtml(post, ' hvala')}
      <button type="button" class="btn btn-soft" id="share-btn">${ICONS.share}Podeli</button>
      ${canDelete ? '<button type="button" class="btn btn-danger" id="delete-btn">Obriši</button>' : ''}
    </div>`;

  detailBody.scrollTop = 0;
  detailBody.querySelector('[data-like]').addEventListener('click', () => toggleLike(post.id));
  $('#share-btn').addEventListener('click', () => sharePost(post));
  if (canDelete) setupDelete(post);
  detailSheet.open(trigger);
}

// Link do materijala, za Viber/WhatsApp grupu odeljenja
async function sharePost(post) {
  const url = `${location.origin}/?p=${post.id}`;
  const subject = subjectById[post.subject]?.name || '';
  if (navigator.share) {
    try {
      await navigator.share({ title: post.title, text: `${subject}: ${post.title}`, url });
    } catch {
      /* korisnik je odustao */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link je kopiran');
  } catch {
    toast('Kopiranje nije uspelo', 'error');
  }
}

function setupDelete(post) {
  const btn = $('#delete-btn');
  let armed = false;
  let timer = 0;
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.classList.add('is-armed');
      btn.textContent = 'Potvrdi brisanje';
      haptic(12);
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove('is-armed');
        btn.textContent = 'Obriši';
      }, 3500);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE', headers: { 'x-delete-token': tokens[post.id] } });
      delete tokens[post.id];
      store.set('tokens', tokens);
      state.posts = state.posts.filter((p) => p.id !== post.id);
      detailSheet.close();
      renderGrid();
      cards.delete(post.id);
      renderStats();
      toast('Materijal je obrisan');
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });
}

// ============ Novi materijal ============
const uploadSheet = new Sheet($('#upload-sheet'));
const form = $('#upload-form');
const fileList = $('#file-list');
const dropzone = $('#dropzone');
const submitBtn = $('#submit-btn');
let selected = []; // { file, key }
let busy = false;

const subjectPicker = $('#subject-picker');
subjectPicker.innerHTML = SUBJECTS.map((s) => chipHtml(s, 'aria-checked')).join('');
subjectPicker.querySelectorAll('.chip').forEach((c) => c.setAttribute('role', 'radio'));
let pickedSubject = null;
function pickSubject(id) {
  pickedSubject = id;
  subjectPicker.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.value === id)));
}
subjectPicker.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  pickSubject(chip.dataset.value);
  chip.closest('.field').classList.remove('is-invalid');
});

const typePicker = createSegmented($('#type-picker'), TYPES.map((t) => ({ id: t.id, label: t.short })), {
  initial: 'domaci',
  role: 'radio'
});

function openUpload(trigger) {
  if (busy) return;
  if (state.subject !== 'all') pickSubject(state.subject);
  if (state.type !== 'all') typePicker.select(state.type, { animate: false });
  $('#f-author').value ||= store.get('author', '');
  uploadSheet.open(trigger);
  // Indikator meri širinu tek kad je sheet vidljiv
  requestAnimationFrame(() => typePicker.select(typePicker.value, { animate: false }));
}

$('#add-btn').addEventListener('click', (e) => openUpload(e.currentTarget));
$('#fab').addEventListener('click', (e) => openUpload(e.currentTarget));
$('#empty-add').addEventListener('click', (e) => openUpload(e.currentTarget));

// Slike sa telefona su često 5–15 MB; smanjujemo ih pre slanja (brže, manje interneta)
const COMPRESSIBLE = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_IMAGE_SIDE = 2400;

async function shrinkImage(file) {
  const ext = extOf(file.name);
  if (!COMPRESSIBLE.has(ext) || file.size < 1.2 * 1024 * 1024 || !('createImageBitmap' in window)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // providni PNG ne sme da postane crn
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

async function addFiles(fileArray) {
  const { maxFileMb, maxFiles } = state.session;
  const errors = [];
  dropzone.classList.add('is-working');
  for (const original of fileArray) {
    const key = `${original.name}:${original.size}`;
    if (selected.some((s) => s.key === key)) continue;
    if (!ALLOWED_EXT.includes(extOf(original.name))) {
      errors.push(`.${extOf(original.name) || '?'} nije dozvoljen`);
      continue;
    }
    if (selected.length >= maxFiles) {
      errors.push(`najviše ${maxFiles} fajlova`);
      break;
    }
    const file = await shrinkImage(original);
    if (file.size > maxFileMb * 1024 * 1024) {
      errors.push(`${file.name} je veći od ${maxFileMb} MB`);
      continue;
    }
    const entry = { file, key, originalName: original.name };
    selected.push(entry);
    renderFileItem(entry);
  }
  dropzone.classList.remove('is-working');
  if (errors.length) toast(errors[0].charAt(0).toUpperCase() + errors[0].slice(1), 'error');
  if (selected.length) {
    $('#form-error').textContent = '';
    dropzone.classList.remove('is-invalid');
    const title = $('#f-title');
    const name = selected[0].originalName;
    // Fotke sa kamere imaju imena tipa IMG_2041 — njih ne nudimo kao naslov
    if (!title.value && selected.length === 1 && !/^(img|dsc|pxl|image|photo|screenshot)[\s_-]?\d/i.test(name)) {
      title.value = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    }
  }
}

function renderFileItem(entry) {
  const ext = extOf(entry.file.name);
  const li = document.createElement('li');
  li.className = 'file-item';
  li.style.setProperty('--fc', extColor(ext));
  li.innerHTML = `
    <span class="file-badge">${escapeHtml(ext)}</span>
    <span class="file-meta"><span class="file-name"></span><span class="file-size">${formatSize(entry.file.size)}</span></span>
    <button type="button" class="icon-btn" aria-label="Ukloni fajl">${ICONS.x}</button>`;
  li.querySelector('.file-name').textContent = entry.file.name;

  if (IMAGE_EXT.has(ext)) {
    const url = URL.createObjectURL(entry.file);
    const img = new Image();
    img.src = url;
    img.alt = '';
    img.onload = () => URL.revokeObjectURL(url);
    li.querySelector('.file-badge').replaceChildren(img);
  }

  li.querySelector('button').addEventListener('click', () => {
    selected = selected.filter((s) => s !== entry);
    if (prefersReducedMotion()) return li.remove();
    const h = li.offsetHeight;
    li.style.overflow = 'hidden';
    li.animate(
      [
        { opacity: 1, transform: 'scale(1)', height: `${h}px`, marginBottom: '0px' },
        { opacity: 0, transform: 'scale(0.94)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-8px' }
      ],
      { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
    ).onfinish = () => li.remove();
  });

  fileList.append(li);
  if (!prefersReducedMotion()) {
    const { easing, duration } = springEasing({ damping: 1, response: 0.4 });
    li.animate([{ opacity: 0, transform: 'translateY(-8px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration, easing });
  }
}

for (const input of [$('#file-input'), $('#camera-input')]) {
  input.addEventListener('change', (e) => {
    addFiles([...e.target.files]);
    e.target.value = '';
  });
}

// Vercel: svaki fajl ide direktno sa telefona u Blob, server dobija samo linkove
const slugify = (name) => {
  const ext = extOf(name);
  const base = fold(name.replace(/\.[^.]+$/, ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'fajl'}${ext ? '.' + ext : ''}`;
};

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function uploadToBlob(onProgress) {
  const { upload } = await import('./vendor/blob-client.js');
  const total = selected.reduce((sum, s) => sum + s.file.size, 0) || 1;
  const loaded = new Map();
  const report = () => onProgress([...loaded.values()].reduce((a, b) => a + b, 0) / total);

  const queue = [...selected];
  const results = new Map();
  // Najviše tri fajla paralelno — dovoljno brzo, a ne guši mobilni internet
  async function worker() {
    while (queue.length) {
      const { file } = queue.shift();
      const blob = await upload(`m/${randomHex(16)}/${slugify(file.name)}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: (e) => {
          loaded.set(file, e.loaded);
          report();
        }
      });
      results.set(file, { url: blob.url, name: file.name, size: file.size });
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  return selected.map((s) => results.get(s.file));
}

async function sendPost(fields, onProgress) {
  if (state.session.upload === 'blob') {
    let files = [];
    try {
      files = selected.length ? await uploadToBlob(onProgress) : [];
    } catch (err) {
      console.error(err);
      throw new Error('Slanje fajla nije uspelo. Proveri internet i probaj ponovo.');
    }
    return api('/api/posts', { method: 'POST', body: JSON.stringify({ ...fields, files }) });
  }
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  for (const { file } of selected) data.append('files', file, file.name);
  return uploadWithProgress(data, onProgress);
}

// Prevlačenje fajlova: bilo gde na stranici otvara formu
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  if (!uploadSheet.isOpen && $('#gate').hidden) openUpload(null);
  dropzone.classList.add('is-over');
});
addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropzone.classList.remove('is-over');
  }
});
addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('is-over');
  if (uploadSheet.isOpen && !busy) addFiles([...e.dataTransfer.files]);
});

function invalid(fieldEl, message) {
  const field = fieldEl.closest('.field') || fieldEl;
  field.classList.add('is-invalid');
  $('#form-error').textContent = message;
  shake(field);
  haptic([8, 40, 8]);
  return false;
}

form.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('is-invalid'));

// "Enter" na tastaturi telefona ne šalje formu, samo spušta tastaturu
form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input')) {
    e.preventDefault();
    e.target.blur();
  }
});

function validate() {
  form.querySelectorAll('.is-invalid').forEach((f) => f.classList.remove('is-invalid'));
  const title = $('#f-title');
  if (!selected.length && !$('#f-desc').value.trim()) return invalid(dropzone, 'Dodaj bar jedan fajl ili napiši opis.');
  if (!title.value.trim()) return invalid(title, 'Dodaj naslov.');
  if (!pickedSubject) return invalid(subjectPicker, 'Izaberi predmet.');
  return true;
}

// Traka napretka prati upload preko opruge, da ne skače
const progressSpring = new Spring(0, {
  damping: 1,
  response: 0.3,
  precision: 0.001,
  onUpdate: (v) => (submitBtn.querySelector('.btn-progress').style.transform = `scaleX(${v})`)
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy || !validate()) return;

  busy = true;
  const label = submitBtn.querySelector('.btn-label');
  submitBtn.classList.add('is-busy');
  label.textContent = 'Šaljem…';
  progressSpring.set(0);

  const fields = {
    title: $('#f-title').value.trim(),
    description: $('#f-desc').value.trim(),
    subject: pickedSubject,
    type: typePicker.value,
    author: $('#f-author').value.trim()
  };
  store.set('author', fields.author);
  $('#f-author').blur();
  document.activeElement?.blur?.(); // spusti tastaturu na telefonu

  try {
    const { post, deleteToken } = await sendPost(fields, (p) => {
      progressSpring.to(p * 0.96);
      label.textContent = `Šaljem… ${Math.round(p * 100)}%`;
    });
    tokens[post.id] = deleteToken;
    store.set('tokens', tokens);
    progressSpring.to(1);

    // Kvačica, konfete i vibracija — u istom frejmu
    submitBtn.classList.remove('is-busy');
    submitBtn.classList.add('is-done');
    const r = submitBtn.getBoundingClientRect();
    celebrate(r.left + r.width / 2, r.top + r.height / 2);
    haptic([12, 60, 18]);

    setTimeout(() => {
      uploadSheet.close();
      state.posts.unshift(post);
      // Novi materijal mora da se vidi, pa skidamo filtere koji ga skrivaju
      if (!filteredPosts().some((p) => p.id === post.id)) resetFilters();
      renderGrid({ highlight: post.id });
      renderStats();
      if (scrollY > grid.offsetTop) scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      toast('Objavljeno! Hvala što deliš');
      resetForm();
    }, 900);
  } catch (err) {
    busy = false;
    submitBtn.classList.remove('is-busy');
    label.textContent = 'Objavi';
    progressSpring.to(0);
    $('#form-error').textContent = err.message;
    shake(submitBtn);
    haptic([8, 40, 8]);
  }
});

function resetForm() {
  // Čeka da se sheet zatvori, da se forma ne isprazni naočigled
  setTimeout(() => {
    form.reset();
    selected = [];
    fileList.replaceChildren();
    pickedSubject = null;
    pickSubject(null);
    typePicker.select('domaci', { animate: false });
    $('#form-error').textContent = '';
    submitBtn.classList.remove('is-done');
    submitBtn.querySelector('.btn-label').textContent = 'Objavi';
    progressSpring.set(0);
    $('#f-author').value = store.get('author', '');
    busy = false;
  }, 750);
}

function resetFilters() {
  state.type = 'all';
  state.subject = 'all';
  state.query = '';
  $('#search').value = '';
  typeFilter.select('all');
  subjectFilter.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.value === 'all')));
}

// ============ Šifra odeljenja ============
function showGate() {
  const gate = $('#gate');
  if (!gate.hidden) return;
  gate.hidden = false;
  requestAnimationFrame(() => $('#gate-code').focus());
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#gate-code');
  const error = $('#gate-error');
  try {
    await api('/api/session', { method: 'POST', body: JSON.stringify({ code: input.value }) });
    error.textContent = '';
    const gate = $('#gate');
    const done = () => (gate.hidden = true);
    if (prefersReducedMotion()) done();
    else gate.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 320, easing: 'ease-out' }).onfinish = done;
    haptic(10);
    loadPosts({ stagger: true }).then(openLinkedPost);
  } catch (err) {
    error.textContent = err.message;
    shake(input);
    haptic([8, 40, 8]);
    input.select();
  }
});

// ============ Učitavanje ============
async function loadPosts({ stagger = false } = {}) {
  try {
    const { posts } = await api('/api/posts');
    state.posts = posts;
    state.loaded = true;
    $('#skeletons').hidden = true;
    renderGrid({ stagger });
    renderStats();
  } catch (err) {
    if (!$('#gate').hidden) return;
    toast(err.message, 'error');
  }
}

function renderToday() {
  const d = new Date();
  const day = DAYS[d.getDay()];
  $('#today').textContent = `${day.charAt(0).toUpperCase() + day.slice(1)}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

// ============ Traka na vrhu (iOS veliki naslov) ============
const topbar = $('.topbar');
const fab = $('#fab');
let lastScroll = scrollY;
let scrollTicking = false;

addEventListener(
  'scroll',
  () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      const y = scrollY;
      topbar.classList.toggle('is-scrolled', y > 4);
      // Dugme + se skloni dok listaš nadole, vrati se čim kreneš nagore
      const dy = y - lastScroll;
      if (y > 240 && dy > 6) fab.classList.add('is-hidden');
      else if (dy < -6 || y <= 240) fab.classList.remove('is-hidden');
      lastScroll = y;
    });
  },
  { passive: true }
);

// Kad veliki naslov "Materijali" prođe ispod trake, mali naslov se pojavi u njoj
new IntersectionObserver(
  ([entry]) => topbar.classList.toggle('is-collapsed', !entry.isIntersecting && entry.boundingClientRect.top < 60),
  { rootMargin: '-60px 0px 0px 0px' }
).observe($('.display'));

// iOS Safari prikazuje :active samo ako postoji touchstart slušalac
document.addEventListener('touchstart', () => {}, { passive: true });

$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur(); // spusti tastaturu
});

// ============ Povuci za osvežavanje ============
function setupPullToRefresh() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const page = $('.page');
  const indicator = $('#ptr');
  const THRESHOLD = 70;
  let touch = null;
  let pulling = false;
  let armed = false;
  let refreshing = false;

  const spring = new Spring(0, { damping: 1, response: 0.38, precision: 0.1, onUpdate: render });

  function render(y) {
    page.style.transform = y > 0.5 ? `translate3d(0, ${y}px, 0)` : '';
    const progress = Math.min(1, Math.max(0, y) / THRESHOLD);
    indicator.style.opacity = refreshing ? 1 : progress;
    indicator.style.transform = `translate3d(-50%, ${Math.min(y, THRESHOLD) * 0.5 - 12}px, 0) scale(${0.5 + 0.5 * progress})`;
    indicator.firstElementChild.style.transform = `rotate(${progress * 300}deg)`;
  }

  addEventListener(
    'touchstart',
    (e) => {
      if (refreshing || scrollY > 0 || e.touches.length > 1 || document.documentElement.classList.contains('is-locked')) return;
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY };
      pulling = false;
      armed = false;
    },
    { passive: true }
  );

  addEventListener(
    'touchmove',
    (e) => {
      if (!touch) return;
      const t = e.touches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      if (!pulling) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Samo jasno vertikalno povlačenje nadole, sa vrha stranice
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || scrollY > 0) {
          touch = null;
          return;
        }
        pulling = true;
        spring.stop();
        touch.y = t.clientY;
      }
      if (e.cancelable) e.preventDefault();
      const y = rubberband(Math.max(0, t.clientY - touch.y), innerHeight);
      spring.value = y;
      render(y);
      if (!armed && y >= THRESHOLD) {
        armed = true;
        haptic(8);
      } else if (armed && y < THRESHOLD) {
        armed = false;
      }
    },
    { passive: false }
  );

  const end = async () => {
    if (!touch) return;
    touch = null;
    if (!pulling) return;
    pulling = false;
    if (!armed) {
      spring.to(0);
      return;
    }
    refreshing = true;
    indicator.classList.add('is-spinning');
    spring.to(THRESHOLD * 0.75);
    const started = performance.now();
    await loadPosts();
    // Kratko zadržavanje da osvežavanje ne izgleda kao trzaj
    await new Promise((r) => setTimeout(r, Math.max(0, 550 - (performance.now() - started))));
    indicator.classList.remove('is-spinning');
    refreshing = false;
    spring.to(0);
  };
  addEventListener('touchend', end, { passive: true });
  addEventListener('touchcancel', end, { passive: true });
}
setupPullToRefresh();

// Osvežavanje kad se vratiš u aplikaciju, i povremeno
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loaded) loadPosts();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && state.loaded && !busy) loadPosts();
}, 45_000);

// Link iz Viber/WhatsApp grupe: /?p=<id> otvara taj materijal
function openLinkedPost() {
  const id = new URLSearchParams(location.search).get('p');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  if (state.posts.some((p) => p.id === id)) openDetail(id, null);
  else toast('Taj materijal više ne postoji', 'error');
}

function showSetupError(message) {
  $('#skeletons').hidden = true;
  $('#gate-form p').textContent = message;
  $('#gate-code').hidden = true;
  $('#gate-form .btn').hidden = true;
  showGate();
}

async function init() {
  renderToday();
  try {
    const session = await api('/api/session');
    state.session = { ...state.session, ...session };
    $('#class-name').textContent = session.className;
    $('#gate-title').textContent = session.className;
    document.title = `${session.className} · Materijali`;
    if (session.setupError) return showSetupError(session.setupError);
    if (!session.authed) {
      $('#skeletons').hidden = true;
      showGate();
      return;
    }
    await loadPosts({ stagger: true });
    openLinkedPost();
  } catch (err) {
    toast(err.message, 'error');
  }
}

init();
