// Fizika opruge u Apple stilu: damping (1 = bez odskoka) + response (koliko brzo stiže, u sekundama).
// Uvek kreće od trenutne vrednosti i brzine, pa animacija može da se prekine i preusmeri u bilo kom trenutku.

const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;

function coefficients(damping, response) {
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  return { stiffness, friction };
}

export class Spring {
  constructor(value = 0, { damping = 1, response = 0.4, precision = 0.001, onUpdate, onRest } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.damping = damping;
    this.response = response;
    this.precision = precision;
    this.onUpdate = onUpdate;
    this.onRest = onRest;
    this.raf = 0;
    this.last = 0;
  }

  get isAnimating() {
    return this.raf !== 0;
  }

  // Skok bez animacije (npr. tokom prevlačenja prstom 1:1)
  set(value) {
    this.stop();
    this.value = this.target = value;
    this.velocity = 0;
    this.onUpdate?.(value);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  to(target, { velocity, damping, response } = {}) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    if (damping !== undefined) this.damping = damping;
    if (response !== undefined) this.response = response;

    if (prefersReducedMotion()) {
      this.set(target);
      this.onRest?.(target);
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  tick = (now) => {
    let dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    const { stiffness, friction } = coefficients(this.damping, this.response);

    // Mali fiksni koraci = stabilno i glatko na 60 i 120 Hz ekranima
    while (dt > 0) {
      const h = Math.min(1 / 240, dt);
      const accel = -stiffness * (this.value - this.target) - friction * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      dt -= h;
    }

    const settled =
      Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 10;
    if (settled) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onUpdate?.(this.value);
      this.onRest?.(this.value);
      return;
    }
    this.onUpdate?.(this.value);
    this.raf = requestAnimationFrame(this.tick);
  };
}

// Pretvara oprugu u CSS linear() easing za Web Animations API (ulazi kartica, toastovi…)
const supportsLinear = CSS.supports('animation-timing-function', 'linear(0, 1)');
const easingCache = new Map();

export function springEasing({ damping = 1, response = 0.4 } = {}) {
  const key = `${damping}:${response}`;
  if (easingCache.has(key)) return easingCache.get(key);

  const { stiffness, friction } = coefficients(damping, response);
  const h = 1 / 240;
  const samples = [0];
  let x = 0;
  let v = 0;
  let lastMoving = 0;
  for (let t = 0; t < 3; t += h) {
    v += (-stiffness * (x - 1) - friction * v) * h;
    x += v * h;
    samples.push(x);
    if (Math.abs(x - 1) > 0.001 || Math.abs(v) > 0.01) lastMoving = samples.length;
  }
  const curve = samples.slice(0, lastMoving + 1);
  const points = [];
  const n = 50;
  for (let i = 0; i <= n; i++) points.push(+curve[Math.round((i / n) * (curve.length - 1))].toFixed(4));
  points[n] = 1;

  const result = supportsLinear
    ? { easing: `linear(${points.join(', ')})`, duration: Math.round(curve.length * h * 1000) }
    : { easing: 'cubic-bezier(0.22, 1, 0.36, 1)', duration: Math.round(response * 1300) };
  easingCache.set(key, result);
  return result;
}

// Apple-ova projekcija: gde bi element stao da nastavi sa trenutnim zamahom
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Meka granica: što dalje vučeš preko ivice, to manje prati prst
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Brzina iz poslednjih ~100ms pomeranja pokazivača (px/s)
export function velocityFrom(samples, now) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (now - last.t > 80) return 0; // prst je stao pre puštanja
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= 100) {
      first = s;
      break;
    }
  }
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}
