import { Spring, project, rubberband, velocityFrom, prefersReducedMotion } from './spring.js';

// Na telefonu: donji "sheet" koji se vuče prstom. Na računaru: prozor koji izranja iz dugmeta koje ga je otvorilo.
const mobileQuery = matchMedia('(max-width: 640px)');
const app = document.getElementById('app');
let locks = 0;

function lockScroll() {
  if (locks++ === 0) {
    app.style.transformOrigin = `50% ${scrollY + innerHeight / 2}px`;
    document.documentElement.classList.add('is-locked');
  }
}

function unlockScroll() {
  if (--locks === 0) {
    document.documentElement.classList.remove('is-locked');
    setAppDepth(0);
  }
}

// iOS efekat: stranica iza se blago povuče unazad dok je sheet otvoren
function setAppDepth(p) {
  if (!mobileQuery.matches || p <= 0.001) {
    app.classList.remove('is-behind');
    app.style.transform = '';
    app.style.borderRadius = '';
    return;
  }
  app.classList.add('is-behind');
  app.style.transform = `scale(${1 - 0.06 * p}) translate3d(0, ${8 * p}px, 0)`;
  app.style.borderRadius = `${16 * p}px`;
}

// Android "nazad" i iOS gest unazad zatvaraju otvoreni sheet umesto da napuste stranicu
const openSheets = [];
addEventListener('popstate', () => {
  const top = openSheets[openSheets.length - 1];
  if (top) top.close(undefined, { fromHistory: true });
});

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export class Sheet {
  constructor(root, { onClose } = {}) {
    this.root = root;
    this.panel = root.querySelector('.sheet-panel');
    this.scrim = root.querySelector('.sheet-scrim');
    this.onClose = onClose;
    this.isOpen = false;
    this.height = 0;
    this.origin = { x: 0, y: 0 };

    this.spring = new Spring(0, {
      damping: 1,
      response: 0.4,
      precision: 0.0005,
      onUpdate: (p) => this.render(p),
      onRest: (p) => {
        if (p === 0 && !this.isOpen) this.finishClose();
      }
    });

    this.scrim.addEventListener('click', () => this.close());
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Tab') {
        this.trapFocus(e);
      }
    });
    addEventListener('resize', () => {
      if (!this.root.hidden) {
        this.measure();
        this.render(this.spring.value);
      }
    });
    this.setupDrag();

    // Na telefonu: polje u fokusu ne sme da ostane ispod tastature
    this.panel.addEventListener('focusin', (e) => {
      if (!mobileQuery.matches || !e.target.matches('input, textarea')) return;
      setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 320);
    });
  }

  measure() {
    this.height = this.panel.offsetHeight;
    if (this.trigger?.isConnected && !mobileQuery.matches) {
      const t = this.trigger.getBoundingClientRect();
      this.origin = {
        x: t.left + t.width / 2 - innerWidth / 2,
        y: t.top + t.height / 2 - innerHeight / 2
      };
    } else {
      this.origin = { x: 0, y: 40 };
    }
  }

  open(trigger) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.trigger = trigger || null;
    this.returnFocus = document.activeElement;
    openSheets.push(this);
    history.pushState({ sheet: true }, '');

    if (this.root.hidden) {
      this.root.hidden = false;
      lockScroll();
      this.measure();
      this.spring.set(0);
    }
    // Ako se zatvarao, nastavlja od trenutne pozicije (prekidivo)

    if (prefersReducedMotion()) {
      this.spring.set(1);
      this.fade(0, 1);
    } else {
      this.spring.to(1, { damping: 1, response: mobileQuery.matches ? 0.42 : 0.36 });
    }

    requestAnimationFrame(() => {
      const auto = !mobileQuery.matches && this.panel.querySelector('[data-autofocus]');
      (auto || this.panel).focus({ preventScroll: true });
    });
  }

  close(velocity, { fromHistory = false } = {}) {
    if (!this.isOpen) return;
    this.isOpen = false;
    openSheets.splice(openSheets.indexOf(this), 1);
    if (!fromHistory && history.state?.sheet) history.back();
    this.height = this.panel.offsetHeight; // sadržaj je mogao da poraste dok je bio otvoren
    if (prefersReducedMotion()) {
      this.fade(1, 0).finished.then(() => this.finishClose());
    } else {
      this.spring.to(0, { damping: 1, response: 0.34, velocity });
    }
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.onClose?.();
  }

  // Smanjeno kretanje: umesto klizanja, kratko pretapanje
  fade(from, to) {
    const opts = { duration: 200, easing: 'ease', fill: 'forwards' };
    this.scrim.animate([{ opacity: from }, { opacity: to }], opts);
    return this.panel.animate([{ opacity: from }, { opacity: to }], opts);
  }

  finishClose() {
    if (this.isOpen) return;
    this.root.hidden = true;
    this.panel.getAnimations().forEach((a) => a.cancel());
    this.scrim.getAnimations().forEach((a) => a.cancel());
    unlockScroll();
  }

  render(p) {
    const clamped = Math.max(0, Math.min(1, p));
    this.scrim.style.opacity = clamped;

    if (mobileQuery.matches) {
      this.panel.style.transform = `translate3d(0, ${(1 - p) * this.height}px, 0)`;
      this.panel.style.opacity = '';
      setAppDepth(clamped);
    } else {
      // Izranja iz dugmeta: kreće delimično sa njegove pozicije, malo manji
      const k = 1 - p;
      const scale = 0.9 + 0.1 * p;
      this.panel.style.transform = `translate3d(${this.origin.x * k * 0.4}px, ${this.origin.y * k * 0.4}px, 0) scale(${scale})`;
      this.panel.style.opacity = Math.min(1, clamped * 1.8);
    }
  }

  setupDrag() {
    let drag = null;

    const onDown = (e) => {
      if (!mobileQuery.matches || !this.isOpen || e.button > 0) return;
      if (e.target.closest('button, a, input, textarea, select, label')) return;
      this.spring.stop(); // uhvati ga u letu
      this.height = this.panel.offsetHeight;
      drag = {
        id: e.pointerId,
        startY: e.clientY,
        startP: this.spring.value,
        samples: [{ y: e.clientY, t: e.timeStamp }],
        active: false
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.startY;
      if (!drag.active && Math.abs(dy) < 6) return;
      drag.active = true;

      let p = drag.startP - dy / this.height;
      if (p > 1) p = 1 + rubberband((p - 1) * this.height, this.height) / this.height;
      this.spring.value = p;
      this.spring.velocity = 0;
      this.render(p);

      drag.samples.push({ y: e.clientY, t: e.timeStamp });
      if (drag.samples.length > 8) drag.samples.shift();
    };

    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.active) {
        this.spring.to(1);
        return;
      }
      const v = e.type === 'pointercancel' ? 0 : velocityFrom(d.samples, e.timeStamp); // px/s, + je nadole
      const projected = this.spring.value - project(v) / this.height;
      if (projected < 0.5) {
        this.close(-v / this.height);
      } else {
        // Zamah je postojao, pa sme malo da odskoči
        this.spring.to(1, { velocity: -v / this.height, damping: 0.8, response: 0.32 });
      }
    };

    this.root.querySelectorAll('.sheet-grab, .sheet-header').forEach((zone) => {
      zone.addEventListener('pointerdown', onDown);
      zone.addEventListener('pointermove', onMove);
      zone.addEventListener('pointerup', onUp);
      zone.addEventListener('pointercancel', onUp);
    });
  }

  trapFocus(e) {
    const items = [...this.panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
