const CACHE_NAME = 'turbo-worm-v5';
const APP_SHELL = ['./', './index.html', './style.css', './game.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './assets/bg_factory.png', './assets/bg_junkyard.png', './assets/bg_swamp.png', './assets/boss_catfish.png', './assets/boss_catfish_t.png', './assets/enemy_drone.png', './assets/enemy_drone_t.png', './assets/enemy_patrol_bot.png', './assets/enemy_patrol_bot_t.png', './assets/enemy_swamp_critter.png', './assets/enemy_swamp_critter_t.png', './assets/hero_idle.png', './assets/hero_jump.png', './assets/hero_poses.png', './assets/hero_run.png', './assets/hero_shoot.png', './assets/hero_whip.png', './assets/screen_gameover.png', './assets/screen_victory.png', './assets/title_splash.png', './music/Doomfire.mp3'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
