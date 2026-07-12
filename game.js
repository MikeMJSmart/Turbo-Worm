// ===================================================================
// TURBO WORM — "Suit Up. Blast Off."
// Original run-and-gun cartoon platformer. 2D Canvas engine.
// ===================================================================

// ---------- Constants ----------
const VIEW_W = 1280, VIEW_H = 720;
const GROUND_Y = 600;               // logical ground line (top of ground strip)
const GRAVITY = 1900;
const MOVE_SPEED = 340;
const AIR_MOVE_SPEED = 300;
const FRICTION_GROUND = 0.78;
const FRICTION_AIR = 0.92;
const JUMP_VELOCITY = -760;
const JUMP_HOLD_GRAVITY_SCALE = 0.45; // holding jump reduces gravity briefly (floaty jump feel)
const JUMP_HOLD_MAX_TIME = 0.16;
const COYOTE_TIME = 0.09;
const TICK = 1 / 60;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_MAX_ENERGY = 100;
const ENERGY_PER_SHOT = 6;
const ENERGY_REGEN_PER_SEC = 14;
const PLAYER_LIVES_START = 3;

const BULLET_SPEED = 900;
const BULLET_LIFE = 1.1;
const WHIP_DURATION = 0.22;
const WHIP_RANGE = 108;
const WHIP_DAMAGE = 34;
const GUN_DAMAGE = 18;
const FIRE_COOLDOWN = 0.16;
const WHIP_COOLDOWN = 0.32;

const INVULN_TIME = 0.9;

// ---------- Utility ----------
const Utils = {
  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  randRange: (min, max) => Math.random() * (max - min) + min,
  randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
};

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- Asset loading (local images via <img>, per sandbox rules) ----------
const ASSET_LIST = {
  titleSplash: './assets/title_splash.png',
  bgJunkyard: './assets/bg_junkyard.png',
  bgSwamp: './assets/bg_swamp.png',
  bgFactory: './assets/bg_factory.png',
  heroIdle: './assets/hero_idle.png',
  heroRun: './assets/hero_run.png',
  heroJump: './assets/hero_jump.png',
  heroShoot: './assets/hero_shoot.png',
  heroWhip: './assets/hero_whip.png',
  enemyPatrol: './assets/enemy_patrol_bot_t.png',
  enemySwamp: './assets/enemy_swamp_critter_t.png',
  enemyDrone: './assets/enemy_drone_t.png',
  bossCatfish: './assets/boss_catfish_t.png',
  screenGameOver: './assets/screen_gameover.png',
  screenVictory: './assets/screen_victory.png',
};

const Assets = { images: {}, ready: false };

function loadImages() {
  const entries = Object.entries(ASSET_LIST);
  let loaded = 0;
  return new Promise((resolve) => {
    entries.forEach(([key, src]) => {
      const img = new Image();
      img.onload = () => {
        loaded++;
        if (loaded === entries.length) { Assets.ready = true; resolve(); }
      };
      img.onerror = () => {
        loaded++;
        console.warn('Failed to load asset', key, src);
        if (loaded === entries.length) { Assets.ready = true; resolve(); }
      };
      img.src = src;
      Assets.images[key] = img;
    });
  });
}

// ---------- Input ----------
const Input = {
  keys: {},
  justPressed: {},
  mouse: { x: 0, y: 0, down: false, rightDown: false },

  init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.justPressed[e.code] = true;
      this.keys[e.code] = true;
      // Prevent page scroll on arrows/space
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      this.mouse.y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.justPressed['MouseLeft'] = true; }
      if (e.button === 2) { this.mouse.rightDown = true; this.justPressed['MouseRight'] = true; }
    });
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  endFrame() { this.justPressed = {}; },
  isDown(code) { return !!this.keys[code]; },
  wasPressed(code) { return !!this.justPressed[code]; },
  moveLeft() { return this.isDown('ArrowLeft') || this.isDown('KeyA'); },
  moveRight() { return this.isDown('ArrowRight') || this.isDown('KeyD'); },
  jumpDown() { return this.isDown('Space') || this.isDown('ArrowUp') || this.isDown('KeyW'); },
  jumpPressed() { return this.wasPressed('Space') || this.wasPressed('ArrowUp') || this.wasPressed('KeyW'); },
  shootPressed() { return this.wasPressed('KeyZ') || this.wasPressed('MouseLeft'); },
  whipPressed() { return this.wasPressed('KeyX') || this.wasPressed('MouseRight'); },
  pausePressed() { return this.wasPressed('Escape') || this.wasPressed('KeyP'); },
};

// ---------- Audio (Web Audio API procedural, per game.md guidance) ----------
class AudioSystem {
  constructor() {
    this.ctx = null;
    this.musicNodes = [];
    this.musicTimer = null;
    this.muted = false;
    this.masterGain = null;
  }
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  sfx(freq = 440, duration = 0.12, type = 'square', opts = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + duration);
    gain.gain.setValueAtTime(opts.vol ?? 0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  noiseBurst(duration = 0.15, vol = 0.25, filterFreq = 1200) {
    if (!this.ctx || this.muted) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    src.connect(filter).connect(gain).connect(this.masterGain);
    src.start();
  }

  // ---- Named SFX ----
  playJump() { this.sfx(420, 0.14, 'square', { slideTo: 720, vol: 0.22 }); }
  playShoot() { this.sfx(880, 0.09, 'sawtooth', { slideTo: 220, vol: 0.18 }); }
  playWhip() { this.noiseBurst(0.1, 0.22, 2400); this.sfx(300, 0.08, 'triangle', { slideTo: 120, vol: 0.15 }); }
  playHit() { this.noiseBurst(0.12, 0.3, 900); }
  playPickup() { this.sfx(660, 0.08, 'square', { slideTo: 1200, vol: 0.2 }); this.sfx(990, 0.1, 'square', { slideTo: 1600, vol: 0.15 }); }
  playEnemyDefeat() { this.sfx(200, 0.22, 'sawtooth', { slideTo: 40, vol: 0.25 }); this.noiseBurst(0.18, 0.2, 1500); }
  playPlayerHurt() { this.sfx(180, 0.2, 'square', { slideTo: 60, vol: 0.25 }); }
  playBossHit() { this.sfx(120, 0.15, 'square', { slideTo: 50, vol: 0.3 }); }
  playBossDefeat() {
    [0, 0.15, 0.3, 0.45].forEach((d, i) => {
      setTimeout(() => this.sfx(300 - i * 40, 0.3, 'sawtooth', { slideTo: 30, vol: 0.3 }), d * 1000);
    });
    setTimeout(() => this.noiseBurst(0.6, 0.35, 800), 500);
  }
  playMenuSelect() { this.sfx(520, 0.06, 'square', { vol: 0.18 }); }

  // ---- Procedural chiptune-ish music loop per level ----
  startMusic(levelIndex) {
    this.stopMusic();
    if (!this.ctx || this.muted) return;
    const scales = [
      [196, 220, 262, 294, 330, 392], // junkyard - G major-ish, gritty
      [174, 196, 233, 261, 311, 349], // swamp - murky minor
      [220, 262, 294, 330, 392, 440], // factory - bright driving
    ];
    const scale = scales[levelIndex % scales.length];
    const tempo = 0.24; // seconds per step
    let step = 0;
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bassOsc.type = 'triangle';
    bassGain.gain.value = 0.09;
    bassOsc.connect(bassGain).connect(this.masterGain);
    bassOsc.start();
    this.musicNodes.push(bassOsc);

    const playStep = () => {
      if (!this.ctx || this.muted) return;
      const note = scale[step % scale.length];
      // lead blip
      const lead = this.ctx.createOscillator();
      const leadGain = this.ctx.createGain();
      lead.type = step % 4 === 0 ? 'square' : 'triangle';
      lead.frequency.value = note * (step % 8 === 4 ? 2 : 1);
      leadGain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      leadGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + tempo * 0.9);
      lead.connect(leadGain).connect(this.masterGain);
      lead.start();
      lead.stop(this.ctx.currentTime + tempo);
      // bass follows root every 4 steps
      if (step % 4 === 0) {
        bassOsc.frequency.setTargetAtTime(scale[0] / 2, this.ctx.currentTime, 0.02);
      }
      step++;
    };
    playStep();
    this.musicTimer = setInterval(playStep, tempo * 1000);
  }
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.musicNodes.forEach((n) => { try { n.stop(); } catch (e) {} });
    this.musicNodes = [];
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }
}

const Audio = new AudioSystem();

// Continue in same file (entities, levels, game state, main loop)...
// ===================================================================
// TURBO WORM — Entities, Levels, Camera, Particles
// (Concatenated into game.js at build; kept separate here for editing clarity,
//  but loaded via direct <script> concatenation — see build note below.)
// ===================================================================

// ---------- Camera ----------
class Camera {
  constructor(width, height) {
    this.x = 0; this.y = 0;
    this.width = width; this.height = height;
    this.worldWidth = 4000;
    this.smoothing = 0.12;
  }
  follow(target) {
    const targetX = target.x + target.w / 2 - this.width / 2;
    this.x += (targetX - this.x) * this.smoothing;
    this.clamp();
  }
  clamp() {
    this.x = Utils.clamp(this.x, 0, Math.max(0, this.worldWidth - this.width));
  }
}

// ---------- Particle system ----------
class Particle {
  constructor() { this.active = false; }
  init(x, y, vx, vy, life, color, size, gravity = 400) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life; this.color = color; this.size = size;
    this.gravity = gravity;
    this.active = true;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }
  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    const s = this.size * (0.4 + 0.6 * alpha);
    ctx.fillRect(this.x - s / 2, this.y - s / 2, s, s);
    ctx.globalAlpha = 1;
  }
}
class ParticlePool {
  constructor(size = 220) { this.pool = Array.from({ length: size }, () => new Particle()); }
  emit(x, y, count, cfg) {
    let emitted = 0;
    for (const p of this.pool) {
      if (!p.active && emitted < count) {
        const angle = Utils.randRange(cfg.angleMin ?? 0, cfg.angleMax ?? Math.PI * 2);
        const speed = Utils.randRange(cfg.speedMin ?? 60, cfg.speedMax ?? 220);
        p.init(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - (cfg.upBias || 0),
          (cfg.life ?? 0.5) + Math.random() * (cfg.lifeVariance ?? 0.2),
          cfg.color || '#fff', cfg.size ?? 4, cfg.gravity ?? 400);
        emitted++;
      }
    }
  }
  update(dt) { for (const p of this.pool) if (p.active) p.update(dt); }
  draw(ctx) { for (const p of this.pool) if (p.active) p.draw(ctx); }
}

// ---------- Bullets ----------
class Bullet {
  constructor(x, y, dir, owner) {
    this.x = x; this.y = y; this.w = 14; this.h = 6;
    this.vx = BULLET_SPEED * dir;
    this.dir = dir;
    this.life = BULLET_LIFE;
    this.owner = owner; // 'player' | 'enemy'
    this.dead = false;
    this.dmg = owner === 'player' ? GUN_DAMAGE : 10;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    ctx.save();
    const grad = ctx.createLinearGradient(this.x, this.y, this.x + this.w * this.dir, this.y);
    if (this.owner === 'player') {
      grad.addColorStop(0, 'rgba(155,227,39,0)');
      grad.addColorStop(1, '#c6ff5e');
    } else {
      grad.addColorStop(0, 'rgba(255,63,63,0)');
      grad.addColorStop(1, '#ff6b6b');
    }
    ctx.fillStyle = grad;
    ctx.shadowColor = this.owner === 'player' ? '#9be327' : '#ff3b3b';
    ctx.shadowBlur = 10;
    ctx.fillRect(this.x - (this.dir > 0 ? this.w : 0), this.y - this.h / 2, this.w, this.h);
    ctx.restore();
  }
  get bounds() { return { x: this.x - this.w / 2, y: this.y - this.h / 2, w: this.w, h: this.h }; }
}

// ---------- Collectibles ----------
class Collectible {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type; // 'orb' | 'health'
    this.w = 28; this.h = 28;
    this.baseY = y;
    this.t = Math.random() * Math.PI * 2;
    this.collected = false;
  }
  update(dt) {
    this.t += dt * 3;
    this.y = this.baseY + Math.sin(this.t) * 6;
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    if (this.type === 'orb') {
      const pulse = 0.85 + Math.sin(this.t * 2) * 0.15;
      ctx.shadowColor = '#9be327';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#c6ff5e';
      ctx.beginPath();
      ctx.arc(0, 0, 10 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eaffb0';
      ctx.beginPath();
      ctx.arc(-2, -2, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.shadowColor = '#ff5fa2';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ff8fc1';
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.bezierCurveTo(10, -20, 18, -6, 0, 12);
      ctx.bezierCurveTo(-18, -6, -10, -20, 0, -12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-2, -6, 4, 10);
      ctx.fillRect(-5, -3, 10, 4);
    }
    ctx.restore();
  }
  get bounds() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

// ---------- Platform ----------
class Platform {
  constructor(x, y, w, h, theme) { this.x = x; this.y = y; this.w = w; this.h = h; this.theme = theme; }
  get bounds() { return this; }
  draw(ctx, camera) {
    const sx = this.x - camera.x;
    const palettes = {
      junkyard: { top: '#8a7a63', side: '#54473a', accent: '#c94f2e' },
      swamp: { top: '#4d6b3a', side: '#2b3d22', accent: '#9be327' },
      factory: { top: '#4a4d63', side: '#2a2c3d', accent: '#ff5fa2' },
    };
    const pal = palettes[this.theme] || palettes.junkyard;
    ctx.fillStyle = pal.side;
    ctx.fillRect(sx, this.y, this.w, this.h);
    ctx.fillStyle = pal.top;
    ctx.fillRect(sx, this.y, this.w, 10);
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < this.w; i += 40) {
      ctx.fillRect(sx + i, this.y, 4, this.h);
    }
  }
}

// ---------- Player ----------
class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 56; this.h = 78;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.health = PLAYER_MAX_HEALTH;
    this.energy = PLAYER_MAX_ENERGY;
    this.lives = PLAYER_LIVES_START;
    this.score = 0;
    this.state = 'idle'; // idle, run, jump, shoot, whip, hurt
    this.stateTimer = 0;
    this.fireCooldown = 0;
    this.whipCooldown = 0;
    this.whipActive = 0;
    this.invuln = 0;
    this.coyote = 0;
    this.jumpHoldTime = 0;
    this.isJumpHeld = false;
    this.dead = false;
    this.bob = 0;
  }

  get bounds() { return { x: this.x + 10, y: this.y + 6, w: this.w - 20, h: this.h - 8 }; }

  takeDamage(amount) {
    if (this.invuln > 0 || this.dead) return false;
    this.health -= amount;
    this.invuln = INVULN_TIME;
    this.state = 'hurt'; this.stateTimer = 0.25;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
    return true;
  }

  heal(amount) { this.health = Math.min(PLAYER_MAX_HEALTH, this.health + amount); }

  update(dt, level, game) {
    this.bob += dt * 8;
    const left = Input.moveLeft(), right = Input.moveRight();
    const wantJump = Input.jumpPressed();
    const speed = this.grounded ? MOVE_SPEED : AIR_MOVE_SPEED;

    if (this.stateTimer > 0) this.stateTimer -= dt; else if (this.state === 'hurt') this.state = 'idle';

    if (left && !right) { this.vx -= speed * dt * 6; this.facing = -1; }
    else if (right && !left) { this.vx += speed * dt * 6; this.facing = 1; }

    const maxSpeed = speed;
    this.vx = Utils.clamp(this.vx, -maxSpeed, maxSpeed);
    this.vx *= this.grounded ? FRICTION_GROUND : FRICTION_AIR;
    if (Math.abs(this.vx) < 4) this.vx = 0;

    // coyote time
    if (this.grounded) this.coyote = COYOTE_TIME; else this.coyote -= dt;

    if (wantJump && this.coyote > 0) {
      this.vy = JUMP_VELOCITY;
      this.grounded = false;
      this.coyote = 0;
      this.isJumpHeld = true;
      this.jumpHoldTime = 0;
      Audio.playJump();
      game.particles.emit(this.x + this.w / 2, this.y + this.h, 8, { color: '#c9c2ff', speedMin: 40, speedMax: 120, life: 0.3, size: 4, angleMin: Math.PI * 0.2, angleMax: Math.PI * 0.8, gravity: 200 });
    }
    if (Input.jumpDown() && this.isJumpHeld && this.jumpHoldTime < JUMP_HOLD_MAX_TIME && this.vy < 0) {
      this.jumpHoldTime += dt;
    } else {
      this.isJumpHeld = false;
    }

    const gravityScale = this.isJumpHeld ? JUMP_HOLD_GRAVITY_SCALE : 1;
    this.vy += GRAVITY * gravityScale * dt;
    this.vy = Math.min(this.vy, 1600);

    // horizontal move + collision
    this.x += this.vx * dt;
    this.resolveCollisions(level, 'x');
    this.y += this.vy * dt;
    this.grounded = false;
    this.resolveCollisions(level, 'y');

    // world bounds
    this.x = Utils.clamp(this.x, 0, level.width - this.w);
    if (this.y > VIEW_H + 200) {
      this.takeDamage(PLAYER_MAX_HEALTH); // fell into pit
    }

    // shooting / whip
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.whipCooldown > 0) this.whipCooldown -= dt;
    if (this.whipActive > 0) this.whipActive -= dt;
    if (this.invuln > 0) this.invuln -= dt;

    if (Input.shootPressed() && this.fireCooldown <= 0 && this.energy >= ENERGY_PER_SHOT) {
      this.fireCooldown = FIRE_COOLDOWN;
      this.energy -= ENERGY_PER_SHOT;
      this.state = 'shoot'; this.stateTimer = 0.14;
      const bx = this.x + this.w / 2 + this.facing * 30;
      const by = this.y + 30;
      game.bullets.push(new Bullet(bx, by, this.facing, 'player'));
      Audio.playShoot();
      game.particles.emit(bx, by, 5, { color: '#eaffb0', speedMin: 30, speedMax: 90, life: 0.15, size: 3, gravity: 0 });
    } else {
      this.energy = Math.min(PLAYER_MAX_ENERGY, this.energy + ENERGY_REGEN_PER_SEC * dt);
    }

    if (Input.whipPressed() && this.whipCooldown <= 0) {
      this.whipCooldown = WHIP_COOLDOWN;
      this.whipActive = WHIP_DURATION;
      this.state = 'whip'; this.stateTimer = WHIP_DURATION;
      Audio.playWhip();
      this.applyWhipHit(game);
    }

    if (!this.grounded && this.vy < 0) this.state = this.state === 'shoot' || this.state === 'whip' ? this.state : 'jump';
    else if (!this.grounded) this.state = this.state === 'shoot' || this.state === 'whip' ? this.state : 'jump';
    else if (Math.abs(this.vx) > 20) this.state = (this.state === 'shoot' || this.state === 'whip' || this.state==='hurt') ? this.state : 'run';
    else this.state = (this.state === 'shoot' || this.state === 'whip' || this.state==='hurt') ? this.state : 'idle';
  }

  applyWhipHit(game) {
    const whipBox = {
      x: this.facing > 0 ? this.x + this.w * 0.6 : this.x + this.w * 0.4 - WHIP_RANGE,
      y: this.y + 10, w: WHIP_RANGE, h: this.h - 20,
    };
    for (const e of game.enemies) {
      if (!e.dead && aabb(whipBox, e.bounds)) {
        e.takeDamage(WHIP_DAMAGE, game);
      }
    }
    if (game.boss && !game.boss.dead && aabb(whipBox, game.boss.bounds)) {
      game.boss.takeDamage(WHIP_DAMAGE, game);
    }
    for (const crate of game.crates || []) {
      if (!crate.broken && aabb(whipBox, crate.bounds)) crate.break(game);
    }
  }

  resolveCollisions(level, axis) {
    const b = this.bounds;
    for (const plat of level.platforms) {
      if (aabb(b, plat.bounds)) {
        if (axis === 'x') {
          if (this.vx > 0) this.x = plat.x - (this.w - 10) - 10 + 0.001;
          else if (this.vx < 0) this.x = plat.x + plat.w - 10 + 0.001;
          this.vx = 0;
        } else {
          if (this.vy > 0) { this.y = plat.y - this.h + 2; this.grounded = true; }
          else if (this.vy < 0) { this.y = plat.y + plat.h - 6; }
          this.vy = 0;
        }
      }
    }
    // ground
    if (this.y + this.h >= GROUND_Y && axis === 'y' && this.vy >= 0) {
      this.y = GROUND_Y - this.h;
      this.vy = 0;
      this.grounded = true;
    }
  }

  draw(ctx, camera) {
    const sx = this.x - camera.x;
    let img = Assets.images.heroIdle;
    if (this.state === 'run') img = Assets.images.heroRun;
    else if (this.state === 'jump') img = Assets.images.heroJump;
    else if (this.state === 'shoot') img = Assets.images.heroShoot;
    else if (this.state === 'whip') img = Assets.images.heroWhip;
    else if (this.state === 'hurt') img = Assets.images.heroIdle;

    const flicker = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    ctx.save();
    if (flicker) ctx.globalAlpha = 0.4;

    const drawW = this.w * 1.7, drawH = this.h * 1.7;
    const bobOffset = this.grounded && Math.abs(this.vx) > 20 ? Math.sin(this.bob) * 3 : 0;
    const cx = sx + this.w / 2;
    const cy = this.y + this.h - drawH / 2 + 10 + bobOffset;

    ctx.translate(cx, cy);
    if (this.facing < 0) ctx.scale(-1, 1);
    if (this.state === 'hurt') ctx.rotate(Math.sin(this.stateTimer * 40) * 0.06);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      ctx.fillStyle = '#9be327';
      ctx.fillRect(-drawW/2, -drawH/2, drawW, drawH);
    }
    ctx.restore();

    // whip visual arc
    if (this.whipActive > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      const wx = sx + this.w / 2 + this.facing * 40;
      const wy = this.y + 40;
      ctx.beginPath();
      ctx.arc(wx, wy, WHIP_RANGE * 0.7, -0.6, 0.6);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- Enemies ----------
class Enemy {
  constructor(x, y, type, opts = {}) {
    this.x = x; this.y = y; this.type = type;
    this.w = 52; this.h = 52;
    this.vx = 0; this.vy = 0;
    this.health = opts.health ?? 40;
    this.maxHealth = this.health;
    this.dead = false;
    this.deathTimer = 0;
    this.hitFlash = 0;
    this.range = opts.range ?? [x - 120, x + 120];
    this.dir = 1;
    this.speed = opts.speed ?? 60;
    this.scoreValue = opts.scoreValue ?? 100;
    this.shootCooldown = 0;
    this.t = Math.random() * 10;
    this.grounded = true;
    this.baseY = y;
  }
  get bounds() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  takeDamage(dmg, game) {
    if (this.dead) return;
    this.health -= dmg;
    this.hitFlash = 0.15;
    Audio.playBossHit ? null : null;
    if (this.health <= 0) {
      this.dead = true;
      this.deathTimer = 0.4;
      game.player.score += this.scoreValue;
      Audio.playEnemyDefeat();
      game.particles.emit(this.x + this.w / 2, this.y + this.h / 2, 18, {
        color: this.type === 'swamp' ? '#9be327' : (this.type === 'drone' ? '#ff5fa2' : '#c9975a'),
        speedMin: 60, speedMax: 260, life: 0.5, size: 6,
      });
    } else {
      Audio.playHit();
    }
  }

  update(dt, game) {
    this.t += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.dead) { this.deathTimer -= dt; return; }

    const player = game.player;
    const distToPlayer = Utils.dist(this.x, this.y, player.x, player.y);

    if (this.type === 'patrol') {
      // patrol back and forth
      this.x += this.dir * this.speed * dt;
      if (this.x < this.range[0]) { this.x = this.range[0]; this.dir = 1; }
      if (this.x > this.range[1]) { this.x = this.range[1]; this.dir = -1; }
      this.y = this.baseY + Math.sin(this.t * 6) * 2;
    } else if (this.type === 'swamp') {
      // chase when player nearby, hop
      if (distToPlayer < 340) {
        const dx = player.x - this.x;
        this.dir = dx > 0 ? 1 : -1;
        this.x += this.dir * this.speed * 1.4 * dt;
      } else {
        this.x += this.dir * this.speed * 0.5 * dt;
        if (this.x < this.range[0] || this.x > this.range[1]) this.dir *= -1;
      }
      this.y = this.baseY - Math.abs(Math.sin(this.t * 5)) * 14;
    } else if (this.type === 'drone') {
      // floating shooter, keeps distance and fires
      this.y = this.baseY + Math.sin(this.t * 2) * 20;
      const dx = player.x - this.x;
      this.dir = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 260) this.x += this.dir * this.speed * dt;
      else if (Math.abs(dx) < 180) this.x -= this.dir * this.speed * 0.6 * dt;
      this.shootCooldown -= dt;
      if (this.shootCooldown <= 0 && Math.abs(dx) < 560 && distToPlayer < 620) {
        this.shootCooldown = 1.8;
        game.bullets.push(new Bullet(this.x + this.w / 2, this.y + this.h / 2, this.dir, 'enemy'));
      }
    }
  }

  // contact damage check handled by game loop
  draw(ctx, camera) {
    if (this.dead && this.deathTimer <= 0) return;
    const sx = this.x - camera.x;
    const img = this.type === 'patrol' ? Assets.images.enemyPatrol
      : this.type === 'swamp' ? Assets.images.enemySwamp
      : Assets.images.enemyDrone;
    ctx.save();
    if (this.dead) {
      const t = Utils.clamp(this.deathTimer / 0.4, 0, 1);
      ctx.globalAlpha = t;
      ctx.translate(sx + this.w/2, this.y + this.h/2);
      ctx.rotate((1 - t) * 1.4);
      ctx.scale(1 + (1-t)*0.6, 1 + (1-t)*0.6);
      ctx.translate(-this.w/2, -this.h/2);
      if (img && img.complete) ctx.drawImage(img, 0, 0, this.w, this.h);
      ctx.restore();
      return;
    }
    if (this.hitFlash > 0) {
      ctx.filter = 'brightness(1.8) saturate(0)';
    }
    ctx.translate(sx + this.w / 2, this.y + this.h / 2);
    if (this.dir < 0) ctx.scale(-1, 1);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
    } else {
      ctx.fillStyle = '#c94f2e';
      ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
    }
    ctx.restore();

    // mini health bar if damaged
    if (this.health < this.maxHealth) {
      const pct = Math.max(0, this.health / this.maxHealth);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx, this.y - 10, this.w, 5);
      ctx.fillStyle = '#ff5fa2';
      ctx.fillRect(sx, this.y - 10, this.w * pct, 5);
    }
  }
}

// ---------- Crate (breakable, whip target) ----------
class Crate {
  constructor(x, y) { this.x = x; this.y = y; this.w = 40; this.h = 40; this.broken = false; this.brokenTimer = 0; }
  get bounds() { return this; }
  break(game) {
    if (this.broken) return;
    this.broken = true; this.brokenTimer = 0.3;
    Audio.playHit();
    game.particles.emit(this.x + this.w/2, this.y + this.h/2, 10, { color: '#a97c50', speedMin: 60, speedMax: 200, life: 0.4, size: 5 });
    if (Math.random() < 0.6) {
      game.collectibles.push(new Collectible(this.x + 4, this.y + 4, Math.random() < 0.3 ? 'health' : 'orb'));
    }
  }
  update(dt) { if (this.broken) this.brokenTimer -= dt; }
  draw(ctx, camera) {
    if (this.broken && this.brokenTimer <= 0) return;
    const sx = this.x - camera.x;
    ctx.save();
    if (this.broken) ctx.globalAlpha = Utils.clamp(this.brokenTimer / 0.3, 0, 1);
    ctx.fillStyle = '#a97c50';
    ctx.fillRect(sx, this.y, this.w, this.h);
    ctx.strokeStyle = '#5c3f26';
    ctx.lineWidth = 3;
    ctx.strokeRect(sx + 2, this.y + 2, this.w - 4, this.h - 4);
    ctx.beginPath();
    ctx.moveTo(sx, this.y); ctx.lineTo(sx + this.w, this.y + this.h);
    ctx.moveTo(sx + this.w, this.y); ctx.lineTo(sx, this.y + this.h);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Boss ----------
class Boss {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 220; this.h = 200;
    this.baseY = y;
    this.health = 320; this.maxHealth = 320;
    this.dead = false; this.deathTimer = 0;
    this.hitFlash = 0;
    this.phase = 'intro'; // intro, attack1(charge), attack2(spit), retreat
    this.phaseTimer = 2.2;
    this.dir = -1;
    this.t = 0;
    this.spitCooldown = 0;
    this.introDone = false;
    this.shakeAmount = 0;
  }
  get bounds() { return { x: this.x + 10, y: this.y + 20, w: this.w - 20, h: this.h - 40 }; }

  takeDamage(dmg, game) {
    if (this.dead || this.phase === 'intro') return;
    this.health -= dmg;
    this.hitFlash = 0.15;
    Audio.playBossHit();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathTimer = 1.6;
      Audio.playBossDefeat();
      game.particles.emit(this.x + this.w/2, this.y + this.h/2, 40, { color: '#ffd35e', speedMin: 100, speedMax: 340, life: 1.0, size: 8 });
    }
  }

  update(dt, game) {
    this.t += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.dead) { this.deathTimer -= dt; return; }
    const player = game.player;

    this.phaseTimer -= dt;
    this.y = this.baseY + Math.sin(this.t * 1.6) * 10;

    if (this.phase === 'intro') {
      if (this.phaseTimer <= 0) { this.phase = 'chase'; this.phaseTimer = 2.5; }
      return;
    }

    const dx = player.x - (this.x + this.w / 2);
    this.dir = dx > 0 ? 1 : -1;

    if (this.phase === 'chase') {
      this.x += Utils.clamp(dx * 0.4, -70, 70) * dt;
      if (this.phaseTimer <= 0) { this.phase = Math.random() < 0.5 ? 'charge' : 'spit'; this.phaseTimer = this.phase === 'charge' ? 1.1 : 1.6; }
    } else if (this.phase === 'charge') {
      this.x += this.dir * 260 * dt;
      this.shakeAmount = 4;
      if (this.phaseTimer <= 0) { this.phase = 'chase'; this.phaseTimer = 2.0; this.shakeAmount = 0; }
    } else if (this.phase === 'spit') {
      this.spitCooldown -= dt;
      if (this.spitCooldown <= 0) {
        this.spitCooldown = 0.5;
        for (let i = -1; i <= 1; i++) {
          const b = new Bullet(this.x + this.w / 2, this.y + this.h / 2 + i * 20, this.dir, 'enemy');
          b.vx = this.dir * 620;
          game.bullets.push(b);
        }
      }
      if (this.phaseTimer <= 0) { this.phase = 'chase'; this.phaseTimer = 2.2; }
    }

    this.x = Utils.clamp(this.x, game.level.width - 900, game.level.width - this.w - 40);
  }

  draw(ctx, camera) {
    const sx = this.x - camera.x + (this.shakeAmount ? Utils.randRange(-this.shakeAmount, this.shakeAmount) : 0);
    ctx.save();
    if (this.dead) {
      const t = Utils.clamp(this.deathTimer / 1.6, 0, 1);
      ctx.globalAlpha = t;
    }
    if (this.hitFlash > 0) ctx.filter = 'brightness(1.6) saturate(0.3)';
    ctx.translate(sx + this.w / 2, this.y + this.h / 2);
    if (this.dir < 0) ctx.scale(-1, 1);
    const img = Assets.images.bossCatfish;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -this.w / 2, -this.h / 2, this.w, this.h);
    } else {
      ctx.fillStyle = '#888';
      ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
    }
    ctx.restore();
  }
}
// ===================================================================
// TURBO WORM — Level definitions
// ===================================================================

function buildLevel(index) {
  const themes = ['junkyard', 'swamp', 'factory'];
  const theme = themes[index];
  const width = 3600;
  const level = {
    index, theme, width,
    generationId: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    bgImage: index === 0 ? 'bgJunkyard' : index === 1 ? 'bgSwamp' : 'bgFactory',
    platforms: [],
    enemySpawns: [],
    collectibleSpawns: [],
    crateSpawns: [],
    endX: width - 260,
    hasBoss: index === 2,
    name: index === 0 ? 'Junkyard Planet' : index === 1 ? 'Toxic Swamp' : 'Alien Factory',
  };

  const P = (x, y, w, h = 30) => level.platforms.push(new Platform(x, y, w, h, theme));
  const platformCount = index === 2 ? Utils.randInt(7, 9) : Utils.randInt(9, 12);
  const generationEnd = index === 2 ? 2670 : width - 260;
  const minGap = 80;
  const maxGap = index === 1 ? 190 : 165;
  const heights = index === 0 ? [350, 400, 445, 485, 510] : index === 1 ? [345, 390, 430, 470, 505] : [350, 395, 440, 480, 510];

  let cursor = 300 + Utils.randInt(0, 70);
  let previousY = 470;
  for (let i = 0; i < platformCount && cursor < generationEnd - 180; i++) {
    const w = Utils.randInt(145, 235);
    let y = heights[Utils.randInt(0, heights.length - 1)];
    // Avoid wild vertical jumps between consecutive platforms.
    if (Math.abs(y - previousY) > 125) y = previousY + Math.sign(y - previousY) * 110;
    y = Utils.clamp(y, 340, 515);
    P(cursor, y, Math.min(w, generationEnd - cursor));

    const platform = level.platforms[level.platforms.length - 1];
    const enemyChance = index === 0 ? 0.55 : 0.68;
    if (Math.random() < enemyChance && platform.w >= 155) {
      const types = index === 0 ? ['patrol'] : index === 1 ? ['swamp', 'swamp', 'drone'] : ['patrol', 'drone', 'swamp'];
      const type = types[Utils.randInt(0, types.length - 1)];
      const enemyY = type === 'drone' ? platform.y - 92 : platform.y - 52;
      level.enemySpawns.push({
        x: platform.x + platform.w / 2 - 25,
        y: enemyY,
        type,
        range: [platform.x + 8, platform.x + platform.w - 8],
        health: type === 'drone' ? 34 : type === 'swamp' ? 46 : undefined,
      });
    }

    const collectibleType = Math.random() < 0.16 ? 'health' : 'orb';
    level.collectibleSpawns.push({
      x: platform.x + platform.w / 2 - 14,
      y: platform.y - 52,
      type: collectibleType,
    });

    if (Math.random() < 0.30) {
      level.crateSpawns.push({ x: platform.x + Utils.randInt(20, Math.max(20, platform.w - 60)), y: platform.y - 40 });
    }

    previousY = y;
    cursor += w + Utils.randInt(minGap, maxGap);
  }

  // Add ground enemies and crates so the safest route is not always empty.
  const groundEnemyCount = index === 0 ? 3 : 4;
  for (let i = 0; i < groundEnemyCount; i++) {
    const x = 650 + i * ((generationEnd - 900) / Math.max(1, groundEnemyCount - 1)) + Utils.randInt(-100, 100);
    const typePool = index === 0 ? ['patrol'] : index === 1 ? ['swamp', 'swamp', 'drone'] : ['patrol', 'swamp', 'drone'];
    const type = typePool[Utils.randInt(0, typePool.length - 1)];
    level.enemySpawns.push({
      x,
      y: type === 'drone' ? GROUND_Y - 135 : GROUND_Y - 52,
      type,
      range: [x - 110, x + 110],
      health: type === 'drone' ? 34 : type === 'swamp' ? 46 : undefined,
    });
  }

  const groundCrateCount = index === 2 ? 2 : 3;
  for (let i = 0; i < groundCrateCount; i++) {
    const x = 760 + i * ((generationEnd - 1050) / Math.max(1, groundCrateCount - 1)) + Utils.randInt(-90, 90);
    level.crateSpawns.push({ x, y: GROUND_Y - 40 });
  }

  if (index === 2) {
    // Keep the final boss arena open and predictable while the approach changes every run.
    level.endX = width - 160;
    level.collectibleSpawns.push({ x: 2700, y: GROUND_Y - 60, type: 'health' });
  }

  return level;
}
// ===================================================================
// TURBO WORM — Main game controller: state machine, HUD, loop, testing hooks
// ===================================================================

const GameMode = {
  TITLE: 'title',
  INSTRUCTIONS: 'instructions',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LEVEL_TRANSITION: 'level_transition',
  GAME_OVER: 'game_over',
  VICTORY: 'victory',
};

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = GameMode.TITLE;
    this.levelIndex = 0;
    this.level = null;
    this.camera = new Camera(VIEW_W, VIEW_H);
    this.particles = new ParticlePool(260);
    this.player = null;
    this.enemies = [];
    this.bullets = [];
    this.collectibles = [];
    this.crates = [];
    this.boss = null;
    this.transitionTimer = 0;
    this.levelStartScore = 0;
    this.frameCount = 0;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsCount = 0; this._fpsTimer = 0;
    this.debugVisible = true;
    this.shakeTimer = 0; this.shakeMag = 0;
    this.paused = false;
    this.lastReasonOfDeath = '';
    this.totalScore = 0;
    this.muted = false;
  }

  startNewGame() {
    this.levelIndex = 0;
    this.totalScore = 0;
    this.loadLevel(0, true);
    this.mode = GameMode.PLAYING;
    Audio.startMusic(0);
  }

  loadLevel(index, freshPlayer) {
    this.level = buildLevel(index);
    this.camera.worldWidth = this.level.width;
    this.camera.x = 0;
    const prevScore = this.player ? this.player.score : 0;
    const prevLives = this.player ? this.player.lives : PLAYER_LIVES_START;
    this.player = new Player(80, GROUND_Y - 78);
    if (!freshPlayer) { this.player.score = prevScore; this.player.lives = prevLives; }
    this.enemies = this.level.enemySpawns.map((s) => new Enemy(s.x, s.y, s.type, s));
    this.collectibles = this.level.collectibleSpawns.map((s) => new Collectible(s.x, s.y, s.type));
    this.crates = this.level.crateSpawns.map((s) => new Crate(s.x, s.y));
    this.bullets = [];
    this.boss = this.level.hasBoss ? new Boss(this.level.width - 340, GROUND_Y - 200) : null;
    Audio.startMusic(index);
  }

  goToNextLevel() {
    if (this.levelIndex < 2) {
      this.levelIndex++;
      this.mode = GameMode.LEVEL_TRANSITION;
      this.transitionTimer = 1.8;
    } else {
      this.mode = GameMode.VICTORY;
      Audio.stopMusic();
    }
  }

  triggerGameOver(reason) {
    this.mode = GameMode.GAME_OVER;
    this.lastReasonOfDeath = reason || '';
    Audio.stopMusic();
  }

  update(dt) {
    this.frameCount++;
    // fps calc
    this._fpsCount++; this._fpsTimer += dt;
    if (this._fpsTimer >= 1) { this.fps = this._fpsCount / this._fpsTimer; this._fpsCount = 0; this._fpsTimer = 0; }

    if (this.mode === GameMode.PLAYING) this.updatePlaying(dt);
    else if (this.mode === GameMode.LEVEL_TRANSITION) {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) {
        this.loadLevel(this.levelIndex, false);
        this.mode = GameMode.PLAYING;
      }
    }
    if (this.shakeTimer > 0) this.shakeTimer -= dt;
  }

  updatePlaying(dt) {
    if (Input.pausePressed()) { this.mode = GameMode.PAUSED; return; }
    const player = this.player;
    player.update(dt, this.level, this);
    this.camera.follow(player);

    for (const e of this.enemies) e.update(dt, this);
    if (this.boss) this.boss.update(dt, this);
    for (const c of this.crates) c.update(dt);
    for (const col of this.collectibles) col.update(dt);
    this.particles.update(dt);

    // bullets update + collision
    for (const b of this.bullets) {
      b.update(dt);
      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.dead && aabb(b.bounds, e.bounds)) { e.takeDamage(b.dmg, this); b.dead = true; break; }
        }
        if (this.boss && !this.boss.dead && aabb(b.bounds, this.boss.bounds)) { this.boss.takeDamage(b.dmg, this); b.dead = true; }
      } else {
        if (!player.dead && aabb(b.bounds, player.bounds)) {
          if (player.takeDamage(b.dmg)) { Audio.playPlayerHurt(); this.doShake(6, 0.2); }
          b.dead = true;
        }
      }
      if (b.x < this.camera.x - 100 || b.x > this.camera.x + VIEW_W + 100) b.dead = true;
    }
    this.bullets = this.bullets.filter((b) => !b.dead);

    // enemy contact damage
    for (const e of this.enemies) {
      if (!e.dead && aabb(player.bounds, e.bounds)) {
        if (player.takeDamage(14)) { Audio.playPlayerHurt(); this.doShake(5, 0.15); }
      }
    }
    if (this.boss && !this.boss.dead && this.boss.phase !== 'intro' && aabb(player.bounds, this.boss.bounds)) {
      if (player.takeDamage(22)) { Audio.playPlayerHurt(); this.doShake(8, 0.25); }
    }

    // collectible pickup
    for (const col of this.collectibles) {
      if (!col.collected && aabb(player.bounds, col.bounds)) {
        col.collected = true;
        Audio.playPickup();
        if (col.type === 'orb') { player.score += 25; }
        else { player.heal(30); player.score += 10; }
      }
    }
    this.collectibles = this.collectibles.filter((c) => !c.collected);

    // clean up dead enemies fully after death anim
    this.enemies = this.enemies.filter((e) => !(e.dead && e.deathTimer <= -1));

    // level end / boss check
    if (this.level.hasBoss) {
      if (this.boss && this.boss.dead && this.boss.deathTimer <= 0) {
        this.goToNextLevel();
      }
    } else if (player.x + player.w >= this.level.endX) {
      this.goToNextLevel();
    }

    if (player.dead) {
      player.lives -= 1;
      if (player.lives <= 0) {
        this.triggerGameOver('health');
      } else {
        // respawn at level start with full health
        player.health = PLAYER_MAX_HEALTH;
        player.dead = false;
        player.x = Math.max(80, this.camera.x - 100);
        player.y = GROUND_Y - player.h;
        player.invuln = INVULN_TIME;
      }
    }
  }

  doShake(mag, time) { this.shakeMag = mag; this.shakeTimer = time; }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    if (this.mode === GameMode.TITLE) { this.renderTitle(); return; }
    if (this.mode === GameMode.INSTRUCTIONS) { this.renderInstructions(); return; }

    ctx.save();
    if (this.shakeTimer > 0) {
      ctx.translate(Utils.randRange(-this.shakeMag, this.shakeMag), Utils.randRange(-this.shakeMag, this.shakeMag));
    }
    this.renderBackground();
    this.renderWorld();
    ctx.restore();

    this.renderHUD();

    if (this.mode === GameMode.LEVEL_TRANSITION) this.renderLevelTransition();
    if (this.mode === GameMode.PAUSED) this.renderPause();
    if (this.mode === GameMode.GAME_OVER) this.renderGameOver();
    if (this.mode === GameMode.VICTORY) this.renderVictory();

    if (this.debugVisible) this.renderDebugOverlay();
  }

  renderBackground() {
    const ctx = this.ctx;
    const img = Assets.images[this.level.bgImage];
    if (img && img.complete && img.naturalWidth > 0) {
      const parallax = this.camera.x * 0.35;
      const scaledW = VIEW_H * (img.naturalWidth / img.naturalHeight);
      let startX = -(parallax % scaledW);
      if (startX > 0) startX -= scaledW;
      for (let x = startX; x < VIEW_W; x += scaledW) {
        ctx.drawImage(img, x, 0, scaledW, VIEW_H);
      }
    } else {
      ctx.fillStyle = '#2a1a3a';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // ground strip
    const palettes = { junkyard: '#3a2f28', swamp: '#1e2b16', factory: '#1c1e2b' };
    ctx.fillStyle = palettes[this.level.theme] || '#222';
    ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, GROUND_Y, VIEW_W, 8);
  }

  renderWorld() {
    const ctx = this.ctx;
    const cam = this.camera;
    for (const p of this.level.platforms) {
      if (p.x + p.w < cam.x - 50 || p.x > cam.x + VIEW_W + 50) continue;
      p.draw(ctx, cam);
    }
    for (const c of this.crates) c.draw(ctx, cam);
    for (const col of this.collectibles) {
      const sx = col.x - cam.x;
      if (sx < -50 || sx > VIEW_W + 50) continue;
      ctx.save(); ctx.translate(cam.x, 0);
      col.draw(ctx);
      ctx.restore();
    }
    for (const e of this.enemies) e.draw(ctx, cam);
    if (this.boss) this.boss.draw(ctx, cam);
    for (const b of this.bullets) {
      ctx.save(); ctx.translate(-cam.x, 0);
      b.draw(ctx);
      ctx.restore();
    }
    ctx.save(); ctx.translate(-cam.x, 0);
    this.particles.draw(ctx);
    ctx.restore();
    if (this.player) this.player.draw(ctx, cam);

    // end-of-level marker
    if (!this.level.hasBoss) {
      const ex = this.level.endX - cam.x;
      if (ex > -60 && ex < VIEW_W + 60) {
        ctx.save();
        ctx.fillStyle = '#9be327';
        ctx.shadowColor = '#9be327'; ctx.shadowBlur = 20;
        ctx.fillRect(ex, GROUND_Y - 220, 10, 220);
        ctx.beginPath();
        ctx.moveTo(ex + 10, GROUND_Y - 220);
        ctx.lineTo(ex + 70, GROUND_Y - 195);
        ctx.lineTo(ex + 10, GROUND_Y - 170);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  renderHUD() {
    const ctx = this.ctx;
    const p = this.player;
    if (!p) return;
    ctx.save();
    ctx.font = '600 14px "Space Grotesk", sans-serif';
    ctx.textBaseline = 'top';

    // Panel bg top-left (health/energy)
    const panelX = 16, panelY = 14, panelW = 300, panelH = 78;
    ctx.fillStyle = 'rgba(13,7,20,0.72)';
    ctx.strokeStyle = 'rgba(155,227,39,0.4)';
    ctx.lineWidth = 2;
    roundRect(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fill(); ctx.stroke();

    // health bar
    const barX = panelX + 84, barW = panelW - 100;
    ctx.fillStyle = '#fff';
    ctx.fillText('HEALTH', panelX + 12, panelY + 10);
    drawBar(ctx, barX, panelY + 8, barW, 16, p.health / PLAYER_MAX_HEALTH, '#ff3b6b', '#5a1030');
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(p.health)}/${PLAYER_MAX_HEALTH}`, panelX + panelW - 12, panelY + 8);
    ctx.textAlign = 'left';

    // energy bar
    ctx.fillStyle = '#fff';
    ctx.fillText('ENERGY', panelX + 12, panelY + 34);
    drawBar(ctx, barX, panelY + 32, barW, 16, p.energy / PLAYER_MAX_ENERGY, '#ffb020', '#5a3a08');
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${Math.ceil(p.energy)}/${PLAYER_MAX_ENERGY}`, panelX + panelW - 12, panelY + 32);
    ctx.textAlign = 'left';

    // lives + level name row
    ctx.fillStyle = '#fff';
    ctx.fillText(`LIVES  ${'♥'.repeat(Math.max(0, p.lives))}`, panelX + 12, panelY + 56);

    ctx.restore();

    // score panel top-right
    ctx.save();
    const spX = VIEW_W - 260, spY = 14, spW = 244, spH = 48;
    ctx.fillStyle = 'rgba(13,7,20,0.72)';
    ctx.strokeStyle = 'rgba(255,95,162,0.4)';
    ctx.lineWidth = 2;
    roundRect(ctx, spX, spY, spW, spH, 10);
    ctx.fill(); ctx.stroke();
    ctx.font = '700 22px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#ff5fa2';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${(this.totalScoreDisplay()).toString().padStart(6, '0')}`, spX + spW - 14, spY + spH / 2 + 2);
    ctx.font = '600 12px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('SCORE', spX + spW - 14, spY + 14);
    ctx.restore();

    // level name banner top-center
    ctx.save();
    ctx.font = '700 16px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(13,7,20,0.6)';
    const label = `LEVEL ${this.levelIndex + 1} — ${this.level.name.toUpperCase()}`;
    const tw = ctx.measureText(label).width;
    roundRect(ctx, VIEW_W / 2 - tw / 2 - 16, 14, tw + 32, 32, 8);
    ctx.fill();
    ctx.fillStyle = '#f2f0e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, VIEW_W / 2, 30);
    ctx.restore();

    // boss health bar
    if (this.boss && !this.boss.dead) {
      ctx.save();
      const bx = VIEW_W / 2 - 260, by = VIEW_H - 56, bw = 520, bh = 22;
      ctx.fillStyle = 'rgba(13,7,20,0.75)';
      roundRect(ctx, bx - 4, by - 22, bw + 8, bh + 46, 10);
      ctx.fill();
      ctx.font = '700 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText('MUTATRON THE CATFISH — FACTORY BOSS', VIEW_W / 2, by - 6);
      drawBar(ctx, bx, by, bw, bh, Math.max(0, this.boss.health / this.boss.maxHealth), '#ff3b3b', '#3a0808');
      ctx.restore();
    }
  }

  totalScoreDisplay() { return this.player ? this.player.score : 0; }

  renderDebugOverlay() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, VIEW_H - 20, 230, 20);
    ctx.font = '11px monospace';
    ctx.fillStyle = this.fps < 30 ? '#f44' : '#0f0';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`FPS:${this.fps.toFixed(0)} mode:${this.mode} lvl:${this.levelIndex+1} ents:${this.enemies.length}`, 6, VIEW_H - 18);
    ctx.restore();
  }

  renderTitle() {
    const ctx = this.ctx;
    const img = Assets.images.titleSplash;
    if (img && img.complete) {
      ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = 'rgba(10,6,18,0.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else {
      ctx.fillStyle = '#160a24';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 72px Bungee, sans-serif';
    ctx.fillStyle = '#9be327';
    ctx.shadowColor = '#ff5fa2'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 5;
    ctx.fillText('TURBO WORM', VIEW_W / 2, 160);
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.font = '600 22px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#f2f0e8';
    ctx.fillText('SUIT UP. BLAST OFF.', VIEW_W / 2, 210);

    drawButton(ctx, VIEW_W / 2 - 140, 430, 280, 60, 'START GAME', this._startHover);
    drawButton(ctx, VIEW_W / 2 - 140, 510, 280, 56, 'HOW TO PLAY', this._instrHover);

    ctx.font = '500 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Click a button or press ENTER to start · H for instructions', VIEW_W / 2, 600);
    ctx.restore();
  }

  renderInstructions() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0d0714';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 40px Bungee, sans-serif';
    ctx.fillStyle = '#9be327';
    ctx.fillText('HOW TO PLAY', VIEW_W / 2, 70);

    const lines = [
      ['MOVE', 'Arrow Keys / A D'],
      ['JUMP', 'Space / W / Up  (hold for higher jump)'],
      ['SHOOT PLASMA GUN', 'Z  or  Left Click'],
      ['WHIP-TAIL ATTACK', 'X  or  Right Click  (close range, breaks crates)'],
      ['PAUSE', 'Esc / P'],
    ];
    ctx.font = '500 20px "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';
    let y = 150;
    for (const [k, v] of lines) {
      ctx.fillStyle = '#ff5fa2';
      ctx.font = '700 20px "Space Grotesk", sans-serif';
      ctx.fillText(k, VIEW_W / 2 - 380, y);
      ctx.fillStyle = '#f2f0e8';
      ctx.font = '500 20px "Space Grotesk", sans-serif';
      ctx.fillText(v, VIEW_W / 2 - 60, y);
      y += 52;
    }
    ctx.font = '500 16px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText('Collect glowing orbs for score, hearts restore health. Reach the flag or defeat the boss to advance!', VIEW_W / 2, y + 20);

    drawButton(ctx, VIEW_W / 2 - 130, VIEW_H - 100, 260, 56, 'BACK TO TITLE', this._backHover);
    ctx.restore();
  }

  renderLevelTransition() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,18,0.88)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = '700 44px Bungee, sans-serif';
    ctx.fillStyle = '#9be327';
    ctx.fillText(`LEVEL ${this.levelIndex + 1}`, VIEW_W / 2, VIEW_H / 2 - 30);
    ctx.font = '600 26px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#fff';
    const name = index_to_name(this.levelIndex);
    ctx.fillText(name, VIEW_W / 2, VIEW_H / 2 + 20);
    ctx.restore();
  }

  renderPause() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,18,0.82)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.font = '700 48px Bungee, sans-serif';
    ctx.fillStyle = '#ffb020';
    ctx.fillText('PAUSED', VIEW_W / 2, 220);
    drawButton(ctx, VIEW_W / 2 - 140, 320, 280, 56, 'RESUME', this._resumeHover);
    drawButton(ctx, VIEW_W / 2 - 140, 396, 280, 56, 'RESTART LEVEL', this._restartHover);
    drawButton(ctx, VIEW_W / 2 - 140, 472, 280, 56, this.muted ? 'UNMUTE AUDIO' : 'MUTE AUDIO', this._muteHover);
    ctx.font = '500 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Esc / P to resume', VIEW_W / 2, 560);
    ctx.restore();
  }

  renderGameOver() {
    const ctx = this.ctx;
    const img = Assets.images.screenGameOver;
    ctx.save();
    if (img && img.complete) {
      ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = 'rgba(10,6,18,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else {
      ctx.fillStyle = '#1a0a0a';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.textAlign = 'center';
    ctx.font = '700 56px Bungee, sans-serif';
    ctx.fillStyle = '#ff3b3b';
    ctx.fillText('GAME OVER', VIEW_W / 2, 120);
    ctx.font = '600 24px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`Final Score: ${this.player ? this.player.score : 0}`, VIEW_W / 2, 170);
    drawButton(ctx, VIEW_W / 2 - 140, 480, 280, 60, 'TRY AGAIN', this._retryHover);
    drawButton(ctx, VIEW_W / 2 - 140, 556, 280, 56, 'TITLE SCREEN', this._titleHover);
    ctx.restore();
  }

  renderVictory() {
    const ctx = this.ctx;
    const img = Assets.images.screenVictory;
    ctx.save();
    if (img && img.complete) {
      ctx.drawImage(img, 0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = 'rgba(10,6,18,0.35)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else {
      ctx.fillStyle = '#0a1a0a';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.textAlign = 'center';
    ctx.font = '700 56px Bungee, sans-serif';
    ctx.fillStyle = '#9be327';
    ctx.fillText('VICTORY!', VIEW_W / 2, 110);
    ctx.font = '600 22px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('Mutatron the Catfish has been scrapped. The galaxy is safe... for now.', VIEW_W / 2, 155);
    ctx.font = '700 26px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#ff5fa2';
    ctx.fillText(`Final Score: ${this.player ? this.player.score : 0}`, VIEW_W / 2, 195);
    drawButton(ctx, VIEW_W / 2 - 140, 500, 280, 60, 'PLAY AGAIN', this._playAgainHover);
    ctx.restore();
  }

  handleClick(mx, my) {
    if (this.mode === GameMode.TITLE) {
      if (pointInRect(mx, my, VIEW_W / 2 - 140, 430, 280, 60)) { Audio.playMenuSelect(); this.startNewGame(); }
      else if (pointInRect(mx, my, VIEW_W / 2 - 140, 510, 280, 56)) { Audio.playMenuSelect(); this.mode = GameMode.INSTRUCTIONS; }
    } else if (this.mode === GameMode.INSTRUCTIONS) {
      if (pointInRect(mx, my, VIEW_W / 2 - 130, VIEW_H - 100, 260, 56)) { Audio.playMenuSelect(); this.mode = GameMode.TITLE; }
    } else if (this.mode === GameMode.PAUSED) {
      if (pointInRect(mx, my, VIEW_W / 2 - 140, 320, 280, 56)) { Audio.playMenuSelect(); this.mode = GameMode.PLAYING; }
      else if (pointInRect(mx, my, VIEW_W / 2 - 140, 396, 280, 56)) { Audio.playMenuSelect(); this.loadLevel(this.levelIndex, false); this.mode = GameMode.PLAYING; }
      else if (pointInRect(mx, my, VIEW_W / 2 - 140, 472, 280, 56)) { this.muted = Audio.toggleMute(); }
    } else if (this.mode === GameMode.GAME_OVER) {
      if (pointInRect(mx, my, VIEW_W / 2 - 140, 480, 280, 60)) { Audio.playMenuSelect(); this.startNewGame(); }
      else if (pointInRect(mx, my, VIEW_W / 2 - 140, 556, 280, 56)) { Audio.playMenuSelect(); this.mode = GameMode.TITLE; }
    } else if (this.mode === GameMode.VICTORY) {
      if (pointInRect(mx, my, VIEW_W / 2 - 140, 500, 280, 60)) { Audio.playMenuSelect(); this.startNewGame(); }
    }
  }
}

function index_to_name(i) { return ['Junkyard Planet', 'Toxic Swamp', 'Alien Factory'][i] || ''; }

function pointInRect(px, py, x, y, w, h) { return px >= x && px <= x + w && py >= y && py <= y + h; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBar(ctx, x, y, w, h, pct, colorFull, colorBg) {
  pct = Utils.clamp(pct, 0, 1);
  ctx.fillStyle = colorBg;
  roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = colorFull;
  roundRect(ctx, x, y, Math.max(h, w * pct), h, h / 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, h / 2); ctx.stroke();
}

function drawButton(ctx, x, y, w, h, label, hover) {
  ctx.save();
  ctx.fillStyle = hover ? '#7fc71a' : '#9be327';
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = '#0d0714';
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.fillStyle = '#0d0714';
  ctx.font = '700 20px "Space Grotesk", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  ctx.restore();
}
// ===================================================================
// TURBO WORM — Bootstrap: wiring, gesture gate, main loop, testing hooks
// ===================================================================

(function () {
  const canvas = document.getElementById('gameCanvas');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  Input.init(canvas);

  const game = new Game(canvas);
  window.__game = game;

  // Hover tracking for title/menu buttons (mouse move updates hover flags used purely for visuals)
  canvas.addEventListener('mousemove', () => {
    const mx = Input.mouse.x, my = Input.mouse.y;
    game._startHover = pointInRect(mx, my, VIEW_W / 2 - 140, 430, 280, 60);
    game._instrHover = pointInRect(mx, my, VIEW_W / 2 - 140, 510, 280, 56);
    game._backHover = pointInRect(mx, my, VIEW_W / 2 - 130, VIEW_H - 100, 260, 56);
    game._resumeHover = pointInRect(mx, my, VIEW_W / 2 - 140, 320, 280, 56);
    game._restartHover = pointInRect(mx, my, VIEW_W / 2 - 140, 396, 280, 56);
    game._muteHover = pointInRect(mx, my, VIEW_W / 2 - 140, 472, 280, 56);
    game._retryHover = pointInRect(mx, my, VIEW_W / 2 - 140, 480, 280, 60);
    game._titleHover = pointInRect(mx, my, VIEW_W / 2 - 140, 556, 280, 56);
    game._playAgainHover = pointInRect(mx, my, VIEW_W / 2 - 140, 500, 280, 60);
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const my = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    game.handleClick(mx, my);
  });

  // Keyboard shortcuts for menu nav (accessibility / testability)
  window.addEventListener('keydown', (e) => {
    if (game.mode === GameMode.TITLE) {
      if (e.code === 'Enter') game.startNewGame();
      if (e.code === 'KeyH') game.mode = GameMode.INSTRUCTIONS;
    } else if (game.mode === GameMode.INSTRUCTIONS) {
      if (e.code === 'Enter' || e.code === 'Escape') game.mode = GameMode.TITLE;
    } else if (game.mode === GameMode.PAUSED) {
      if (e.code === 'Enter') game.mode = GameMode.PLAYING;
    } else if (game.mode === GameMode.GAME_OVER) {
      if (e.code === 'Enter') game.startNewGame();
    } else if (game.mode === GameMode.VICTORY) {
      if (e.code === 'Enter') game.startNewGame();
    }
    if (e.code === 'KeyF') toggleFullscreenLike();
  });

  // "Fullscreen" toggle — sandbox blocks real Fullscreen API, so simulate by maximizing canvas box
  let simFullscreen = false;
  function toggleFullscreenLike() {
    simFullscreen = !simFullscreen;
    document.getElementById('game-root').style.background = simFullscreen ? '#000' : '';
  }

  // ---------- Gesture gate (Click to Play) ----------
  const gate = document.getElementById('gestureGate');
  const gateBtn = document.getElementById('gateBtn');
  function startAudioAndGame() {
    Audio.init();
    Audio.resume();
    gate.style.display = 'none';
    started = true;
  }
  gateBtn.addEventListener('click', startAudioAndGame);
  gate.addEventListener('click', (e) => { if (e.target === gate) startAudioAndGame(); });

  let started = false;

  // ---------- Main loop (fixed timestep) ----------
  let lastTime = 0;
  let accumulator = 0;
  let rafId = null;

  function loop(timestamp) {
    rafId = requestAnimationFrame(loop);
    if (!started) return; // wait for gesture
    if (!Assets.ready) { return; }
    if (typeof window.__isRotateBlocking === 'function' && window.__isRotateBlocking()) {
      // Rotate-device overlay is covering the screen — pause the game loop
      // (no update/render, and reset lastTime so dt doesn't spike on resume).
      lastTime = timestamp;
      return;
    }
    const dt = Math.min((timestamp - (lastTime || timestamp)) / 1000, 0.1);
    lastTime = timestamp;
    accumulator += dt;
    while (accumulator >= TICK) {
      game.update(TICK);
      accumulator -= TICK;
    }
    game.render();
    Input.endFrame();
  }
  rafId = requestAnimationFrame(loop);

  // ---------- Testing / Debug hooks (per game-testing.md) ----------
  window.advanceTime = function (ms) {
    if (!started) { startAudioAndGame(); }
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) {
      game.update(TICK);
      Input.endFrame();
    }
    game.render();
  };

  window.render_game_to_text = function () {
    const p = game.player;
    const payload = {
      coordinateSystem: 'origin top-left, x increases right, y increases down. World-space x/y for player & entities; camera.x is world scroll offset.',
      mode: game.mode,
      levelIndex: game.levelIndex,
      levelName: game.level ? game.level.name : null,
      camera: game.camera ? { x: Math.round(game.camera.x) } : null,
      player: p ? {
        x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy),
        health: Math.round(p.health), energy: Math.round(p.energy), lives: p.lives,
        score: p.score, state: p.state, grounded: p.grounded, facing: p.facing,
        invuln: Number(p.invuln.toFixed(2)),
      } : null,
      enemies: game.enemies.filter(e => !e.dead).map(e => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), health: e.health })),
      boss: game.boss ? { x: Math.round(game.boss.x), y: Math.round(game.boss.y), health: game.boss.health, maxHealth: game.boss.maxHealth, phase: game.boss.phase, dead: game.boss.dead } : null,
      collectibles: game.collectibles.map(c => ({ type: c.type, x: Math.round(c.x), y: Math.round(c.y) })),
      bullets: game.bullets.length,
      fps: Number(game.fps.toFixed(1)),
    };
    return JSON.stringify(payload);
  };

  // simulateInput: { keys: {code: true/false}, mouse: {x,y,down,rightDown}, click: {x,y} }
  window.simulateInput = function (opts) {
    opts = opts || {};
    if (opts.keys) {
      for (const [code, down] of Object.entries(opts.keys)) {
        if (down) { if (!Input.keys[code]) Input.justPressed[code] = true; Input.keys[code] = true; }
        else { Input.keys[code] = false; }
      }
    }
    if (opts.mouse) {
      if (typeof opts.mouse.x === 'number') Input.mouse.x = opts.mouse.x;
      if (typeof opts.mouse.y === 'number') Input.mouse.y = opts.mouse.y;
      if (typeof opts.mouse.down === 'boolean') {
        if (opts.mouse.down && !Input.mouse.down) Input.justPressed['MouseLeft'] = true;
        Input.mouse.down = opts.mouse.down;
      }
      if (typeof opts.mouse.rightDown === 'boolean') {
        if (opts.mouse.rightDown && !Input.mouse.rightDown) Input.justPressed['MouseRight'] = true;
        Input.mouse.rightDown = opts.mouse.rightDown;
      }
    }
    if (opts.click) {
      if (!started) startAudioAndGame();
      game.handleClick(opts.click.x, opts.click.y);
    }
    if (opts.startGame) { if (!started) startAudioAndGame(); game.startNewGame(); }
  };

  window.__toggleDebug = function () { game.debugVisible = !game.debugVisible; };

  // Kick off asset loading
  loadImages().then(() => { console.log('Assets loaded'); });


  // ===================================================================
  // MOBILE TOUCH CONTROLS + LANDSCAPE LOCK
  // ===================================================================

  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  // ---------- Touch controls: wire on-screen buttons into Input.keys ----------
  // Multi-touch safe: each button tracks its own active pointer/touch identifiers
  // via separate touchstart/touchend/touchcancel (and pointer events as a fallback
  // for devices that report touch capability but fire pointer events), so holding
  // move + jump + shoot simultaneously all register independently.
  function setupTouchControls() {
    const touchLayer = document.getElementById('touchControls');
    if (!isTouchDevice) {
      touchLayer.hidden = true;
      return;
    }
    touchLayer.hidden = false;

    const buttons = touchLayer.querySelectorAll('.touch-btn[data-key]');
    buttons.forEach((btn) => {
      const code = btn.getAttribute('data-key');
      // Track active touch/pointer ids on this specific button so releasing one
      // finger doesn't cancel a different finger held on the same button.
      const activeIds = new Set();

      function press(id) {
        if (activeIds.size === 0) {
          if (!Input.keys[code]) Input.justPressed[code] = true;
          Input.keys[code] = true;
        }
        activeIds.add(id);
        btn.classList.add('is-pressed');
      }
      function release(id) {
        activeIds.delete(id);
        if (activeIds.size === 0) {
          Input.keys[code] = false;
          btn.classList.remove('is-pressed');
        }
      }

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) press('t' + t.identifier);
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) release('t' + t.identifier);
      }, { passive: false });
      btn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) release('t' + t.identifier);
      }, { passive: false });

      // Pointer events fallback (covers stylus / hybrid touch+mouse devices).
      // Guarded so it never double-fires alongside touch events on the same interaction.
      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return; // handled by touchstart above
        e.preventDefault();
        press('p' + e.pointerId);
      });
      btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch') return;
        release('p' + e.pointerId);
      });
      btn.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'touch') return;
        release('p' + e.pointerId);
      });

      // Prevent long-press context menu / callout on action buttons
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
  setupTouchControls();

  // ---------- Orientation lock (best-effort; safe no-op if blocked) ----------
  function attemptOrientationLock() {
    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (err) {
      // Fullscreen/Orientation APIs are commonly blocked in sandboxed/cross-origin
      // iframes — this is expected and non-fatal; the CSS rotate overlay is the
      // real mechanism for enforcing landscape play.
    }
  }
  window.addEventListener('pointerdown', attemptOrientationLock, { once: true });
  window.addEventListener('touchstart', attemptOrientationLock, { once: true, passive: true });

  // ---------- Rotate-device overlay ----------
  // Shown whenever the device is touch-capable AND currently in portrait.
  // Never shown on desktop/non-touch devices, regardless of window aspect ratio.
  const rotateOverlay = document.getElementById('rotateOverlay');
  const rotateContinueBtn = document.getElementById('rotateContinueBtn');
  const portraitQuery = window.matchMedia('(orientation: portrait)');
  let rotateBlocking = false;
  let rotateManuallyDismissed = false;

  // Some embedded/preview contexts (e.g. an iframe card that doesn't actually
  // resize when the physical device rotates) can report a stale orientation
  // forever, which would permanently block play. Use the iframe's own
  // width/height ratio as the primary signal (more reliable across embedding
  // contexts than matchMedia alone), and always give the player a manual
  // "Continue Anyway" escape hatch so they can never get stuck.
  function computeShouldBlock() {
    if (rotateManuallyDismissed) return false;
    if (!isTouchDevice) return false;
    const aspectPortrait = window.innerHeight > window.innerWidth;
    return aspectPortrait || portraitQuery.matches;
  }

  function updateRotateOverlay() {
    const shouldBlock = computeShouldBlock();
    if (shouldBlock === rotateBlocking) return;
    rotateBlocking = shouldBlock;
    rotateOverlay.hidden = !shouldBlock;
  }
  updateRotateOverlay();

  if (rotateContinueBtn) {
    const dismissRotateOverlay = (e) => {
      e.preventDefault();
      rotateManuallyDismissed = true;
      rotateBlocking = false;
      rotateOverlay.hidden = true;
    };
    rotateContinueBtn.addEventListener('click', dismissRotateOverlay);
    rotateContinueBtn.addEventListener('touchend', dismissRotateOverlay, { passive: false });
  }

  // iOS Safari fires orientationchange/resize inconsistently around the actual
  // layout settle point, so listen to all three signals for reliability.
  if (portraitQuery.addEventListener) {
    portraitQuery.addEventListener('change', updateRotateOverlay);
  } else if (portraitQuery.addListener) {
    portraitQuery.addListener(updateRotateOverlay); // older Safari fallback
  }
  window.addEventListener('orientationchange', () => {
    // Re-check after the viewport actually settles on iOS.
    setTimeout(updateRotateOverlay, 50);
    setTimeout(updateRotateOverlay, 300);
  });
  window.addEventListener('resize', updateRotateOverlay);

  // Expose for testing
  window.__isTouchDevice = isTouchDevice;
  window.__isRotateBlocking = () => rotateBlocking;

  // ---------- Prevent iOS default gestures interfering with gameplay ----------
  // Pinch-zoom / double-tap-zoom / pull-to-refresh / overscroll bounce.
  document.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());


  console.log('Turbo Worm bootstrapped. Testing hooks: window.advanceTime, window.render_game_to_text, window.simulateInput');
})();
