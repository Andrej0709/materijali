import { prefersReducedMotion } from './spring.js';

const COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'];
const GRAVITY = 1150; // px/s²

let canvas;
let ctx;
let dpr = 1;
let particles = [];
let raf = 0;
let last = 0;

function setup() {
  canvas = document.getElementById('confetti');
  ctx = canvas.getContext('2d');
  resize();
  addEventListener('resize', resize);
}

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}

const rand = (min, max) => min + Math.random() * (max - min);

// angle u stepenima: -90 = pravo gore
function burst({ x, y, count, angle = -90, spread = 60, power = 1 }) {
  for (let i = 0; i < count; i++) {
    const a = ((angle + rand(-spread, spread)) * Math.PI) / 180;
    const speed = rand(450, 1150) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      w: rand(6, 11),
      h: rand(9, 16),
      round: Math.random() < 0.28,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: rand(0, Math.PI * 2),
      vr: rand(-10, 10),
      flip: rand(0, Math.PI * 2),
      vflip: rand(5, 13),
      sway: rand(0, Math.PI * 2),
      drag: rand(2.3, 3.4),
      life: 0,
      ttl: rand(2.4, 3.6)
    });
  }
}

function tick(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  particles = particles.filter((p) => {
    p.life += dt;
    const air = Math.exp(-p.drag * dt);
    p.vx *= air;
    p.vy = p.vy * air + GRAVITY * dt * air;
    p.sway += dt * 4;
    p.x += (p.vx + Math.sin(p.sway) * 40) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.flip += p.vflip * dt;

    if (p.life > p.ttl || p.y > innerHeight + 40) return false;

    const flip = Math.cos(p.flip);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (p.ttl - p.life) / 0.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, flip); // "okretanje" papirića u 3D
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    // Blago tamnija poleđina daje utisak dubine
    if (flip < 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
    return true;
  });

  if (particles.length) {
    raf = requestAnimationFrame(tick);
  } else {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    raf = 0;
  }
}

function start() {
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

// Veliki prasak iz jedne tačke + dva bočna "topa" sa dna ekrana
export function celebrate(x = innerWidth / 2, y = innerHeight / 2) {
  if (prefersReducedMotion()) return;
  if (!ctx) setup();
  burst({ x, y, count: 120, spread: 55, power: 1 });
  start();
  setTimeout(() => {
    burst({ x: -10, y: innerHeight + 10, count: 70, angle: -64, spread: 16, power: 1.6 });
    burst({ x: innerWidth + 10, y: innerHeight + 10, count: 70, angle: -116, spread: 16, power: 1.6 });
    start();
  }, 140);
}
