import './style.css';
import { unlockAudio } from './cues.js';
import { createHomeScreen, createSettingsScreen, createSafetyScreen, createTvScreen } from './screens/info.js';
import { createGameScreen } from './screens/game.js';
import { createRecorderScreen } from './screens/recorder.js';
import { createSimulateScreen } from './screens/simulate.js';

const root = document.getElementById('app');

const app = {
  screens: {},
  current: null,
  show(name, params) {
    const next = this.screens[name];
    if (!next) return;
    if (this.current) {
      this.current.leave?.();
      this.current.el.classList.remove('active');
    }
    this.current = next;
    next.el.classList.add('active');
    next.enter?.(params);
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  },
};

const factories = {
  home: createHomeScreen,
  game: createGameScreen,
  recorder: createRecorderScreen,
  simulate: createSimulateScreen,
  settings: createSettingsScreen,
  safety: createSafetyScreen,
  tv: createTvScreen,
};
for (const [name, make] of Object.entries(factories)) {
  const s = make(app);
  app.screens[name] = s;
  root.appendChild(s.el);
}

// Android back button (forwarded by the native host).
window.__golfBack = () => {
  if (app.current === app.screens.home) return false;
  app.show('home');
  return true;
};

// Browsers only allow audio after a user gesture: unlock on the first touch.
document.addEventListener('pointerdown', unlockAudio, { passive: true });

window.addEventListener('error', (e) => console.error('Uncaught', e.error || e.message));

const start = location.hash.slice(1);
app.show(app.screens[start] ? start : 'home');
window.__golfApp = app;
