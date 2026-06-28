'use strict';

// ── Constants ───────────────────────────────────────────────────────────────

let CANVAS_W = window.innerWidth;
let CANVAS_H = window.innerHeight;

const ROTATION_SPEED = 2.5;   // rad/s
const THRUST         = 220;   // px/s²
const FRICTION       = 0.985; // velocity multiplier per frame
const MAX_SPEED      = 320;   // px/s
const BULLET_SPEED   = 520;   // px/s
const MAX_BULLETS    = 5;
const SHOOT_COOLDOWN = 0.25;  // seconds

const SIZE_CONFIG = {
    large:  { radius: 40, points: 20,  rotSpeed: 0.6 },
    medium: { radius: 22, points: 50,  rotSpeed: 1.0 },
    small:  { radius: 11, points: 100, rotSpeed: 2.0 },
};

const ENEMY_POINTS        = 500;
const ENEMY_RADIUS        = 26;
const ENEMY_SPAWN_BASE    = 7;  // seconds between enemy spawns at level 1
const ENEMY_HOMING_LEVEL  = 3;  // level at which enemies start homing

const POWERUP_RADIUS      = 14;
const POWERUP_LIFETIME    = 12; // seconds before powerup disappears
const WEAPON_DURATION     = 15; // seconds a weapon upgrade lasts
const MAX_BOMBS           = 3;
const LASER_DRAIN         = 0.38; // charge/sec while firing
const LASER_REGEN         = 0.22; // charge/sec while not firing
const LASER_DAMAGE_RATE   = 0.15; // seconds between laser hits on a target

const POWERUP_COLORS = { rapid: '#ffdd00', spread: '#00ccff', laser: '#ff44ff', bomb: '#ff8800' };
const POWERUP_LABELS = { rapid: 'R', spread: 'S', laser: 'L', bomb: 'B' };

const SPACEMAN_RADIUS     = 16;
const ISS_RADIUS          = 42;
const SPACEMAN_PENALTY    = 250;
const ISS_PENALTY         = 1000;
const ASSIST_DURATION     = 15;   // seconds auto-fire lasts
const SPACEMAN_FIRE_RATE  = 0.5;  // seconds between auto-shots (spaceman)
const ISS_FIRE_RATE       = 0.28; // seconds between auto-shots (ISS)
const FRIENDLY_SPAWN_BASE = 28;   // seconds between friendly spawns

// Unit-scale polygon vertices for three irregular rock shapes
const DEBRIS_SHAPES = [
    [[ 0,-1],[0.5,-0.7],[0.9,-0.3],[0.85,0.4],[0.3,0.9],[-0.5,0.8],[-0.9,0.2],[-0.6,-0.6]],
    [[ 0,-0.9],[0.7,-0.5],[1,0.1],[0.4,0.85],[-0.4,0.9],[-0.9,0.3],[-0.75,-0.5],[0.1,-0.7]],
    [[ 0,-1],[0.65,-0.6],[0.85,0.25],[0.5,0.9],[-0.3,1],[-0.95,0.4],[-0.8,-0.45],[0.15,-0.65]],
];

// ── Canvas / Context ────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
    CANVAS_W = canvas.width  = window.innerWidth;
    CANVAS_H = canvas.height = window.innerHeight;
    generateStars();
}
window.addEventListener('resize', resizeCanvas);

// ── Input ───────────────────────────────────────────────────────────────────

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    const blocked = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (blocked.includes(e.code)) e.preventDefault();
    ensureAudio();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function isLeft()    { return keys['KeyA']     || keys['ArrowLeft'];  }
function isRight()   { return keys['KeyD']     || keys['ArrowRight']; }
function isForward() { return keys['KeyW']     || keys['ArrowUp'];    }
function isBack()    { return keys['KeyS']     || keys['ArrowDown'];  }
function isShoot()   { return keys['Space']; }
function isStart()   { return keys['Space'] || keys['Enter']; }

// ── Audio ───────────────────────────────────────────────────────────────────

let audioCtx = null;

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playLaser() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.13);
}

function playExplosion(size) {
    if (!audioCtx) return;
    const durations = { large: 0.5, medium: 0.3, small: 0.15 };
    const dur = durations[size] || 0.3;
    const bufLen = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src    = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain   = audioCtx.createGain();
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    filter.type = 'bandpass';
    filter.frequency.value = size === 'large' ? 120 : size === 'medium' ? 200 : 350;
    filter.Q.value = 0.8;

    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.01);
}

function playLevelUp() {
    if (!audioCtx) return;
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.15;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.2);
    });
}

function playGameOver() {
    if (!audioCtx) return;
    const notes = [440, 311]; // A4, D#4
    notes.forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.45;
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.45);
    });
}

function playShipHit() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'square';
    osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.11);
}

function playEnemyExplosion() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.31);
}

function playEnemySpawn() {
    if (!audioCtx) return;
    // Two-tone rising chirp — unmistakable alert
    [0, 0.12].forEach((delay, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + delay;
        osc.type = 'square';
        osc.frequency.setValueAtTime(300 + i * 200, t);
        osc.frequency.exponentialRampToValueAtTime(600 + i * 200, t + 0.1);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.11);
    });
}

function playPowerupCollect() {
    if (!audioCtx) return;
    // Rising three-note chime
    [523, 784, 1047].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.07;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.start(t); osc.stop(t + 0.16);
    });
}

function playBomb() {
    if (!audioCtx) return;
    // Deep low boom with rumble
    const bufLen = Math.floor(audioCtx.sampleRate * 0.8);
    const buffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    src.buffer = buffer;
    src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    filter.type = 'lowpass'; filter.frequency.value = 180;
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    src.start(t); src.stop(t + 0.81);
}

function playLaserTick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.start(t); osc.stop(t + 0.07);
}

function playFriendlyDestroyed() {
    if (!audioCtx) return;
    // Descending alarmed beeps — "oh no!"
    [880, 660, 440].forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.13;
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.12);
    });
}

function playAssistActivate() {
    if (!audioCtx) return;
    // Warm ascending chord — friendly rescue
    [330, 415, 523, 660].forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.06;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t); osc.stop(t + 0.26);
    });
}

// ── Factory Functions ────────────────────────────────────────────────────────

function createShip() {
    return {
        x: CANVAS_W / 2,
        y: CANVAS_H / 2,
        vx: 0,
        vy: 0,
        rotation: 0,       // radians; 0 = pointing up
        radius: 16,
        invulnerable: false,
        invulnerableTimer: 0,
        thrustOn: false,
        shootCooldown: 0,
        active: true,
    };
}

function createBullet(x, y, angle) {
    return {
        x,
        y,
        vx: Math.sin(angle) * BULLET_SPEED,
        vy: -Math.cos(angle) * BULLET_SPEED,
        radius: 3,
        lifetime: 1.5,
        active: true,
    };
}

function createDebris(x, y, size, vx, vy) {
    const cfg = SIZE_CONFIG[size];
    return {
        x, y, vx, vy,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * cfg.rotSpeed,
        radius: cfg.radius,
        size,
        points: cfg.points,
        shapeVariant: Math.floor(Math.random() * DEBRIS_SHAPES.length),
        active: true,
    };
}

function createEnemy(x, y, vx, vy) {
    return {
        x, y, vx, vy,
        radius: ENEMY_RADIUS,
        points: ENEMY_POINTS,
        active: true,
        pulseTimer: 0,
        spawnAge: 0,   // used for entrance flash effect
    };
}

function createFriendly(x, y, vx, vy, type) {
    return {
        x, y, vx, vy,
        radius:   type === 'iss' ? ISS_RADIUS : SPACEMAN_RADIUS,
        type,     // 'spaceman' | 'iss'
        rotation: Math.random() * Math.PI * 2,
        bobTimer: Math.random() * Math.PI * 2,
        active:   true,
    };
}

function createPowerup(x, y, type) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 35 + Math.random() * 30;
    return {
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        radius:   POWERUP_RADIUS,
        type,                          // 'rapid' | 'spread' | 'laser' | 'bomb'
        lifetime: POWERUP_LIFETIME,
        rotation: Math.random() * Math.PI * 2,
        active:   true,
    };
}

// ── Level Config ─────────────────────────────────────────────────────────────

function getLevelConfig(level) {
    return {
        spawnInterval: Math.max(0.5, 3.0 - (level - 1) * 0.25),
        maxDebris:     Math.min(25, 5 + level * 2),
        speedMult:     Math.min(3.0, 1.0 + (level - 1) * 0.15),
        debrisCount:   Math.min(8, 2 + level),
    };
}

// ── Game State ───────────────────────────────────────────────────────────────

let state;          // 'menu' | 'playing' | 'game_over'
let score;
let lives;
let level;
let hiScore;

let ship;
let bullets;
let debris;
let enemies;
let powerups;
let stars;
let floatingTexts;

let spawnTimer;
let enemySpawnTimer;
let powerupSpawnTimer;
let levelCfg;
let waveDebrisRemaining;
let levelTransitionTimer;
let gameOverLockout;
let particleExplosions;

// Weapon upgrade state
let weaponMode;         // 'normal' | 'rapid' | 'spread' | 'laser'
let weaponTimer;        // remaining seconds for current upgrade
let bombs;              // stored bomb count
let laserCharge;        // 0.0 – 1.0
let laserOverheat;      // seconds of overheat lockout
let laserDamageTimer;   // rate-limits laser hits
let laserBeam;          // {sx,sy,ex,ey} set each frame while laser fires
let screenFlash;        // 0-1, used for bomb visual flash
let notification;       // {text, color, timer} for pickup announcements

// Friendly entity state
let friendlies;
let friendlySpawnTimer;
let assistActive;
let assistSource;
let assistTimer;
let assistFireRate;
let assistFireTimer;

// ── Stars ────────────────────────────────────────────────────────────────────

function generateStars() {
    stars = [];
    for (let i = 0; i < 150; i++) {
        stars.push({
            x:          Math.random() * CANVAS_W,
            y:          Math.random() * CANVAS_H,
            brightness: 0.3 + Math.random() * 0.7,
            size:       Math.random() < 0.1 ? 2 : 1,
        });
    }
}

// ── Spawning ─────────────────────────────────────────────────────────────────

function spawnDebrisFromEdge(speedMult) {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 60;
    if (edge === 0) { x = Math.random() * CANVAS_W; y = -margin; }
    else if (edge === 1) { x = CANVAS_W + margin; y = Math.random() * CANVAS_H; }
    else if (edge === 2) { x = Math.random() * CANVAS_W; y = CANVAS_H + margin; }
    else                 { x = -margin; y = Math.random() * CANVAS_H; }

    const targetX = 120 + Math.random() * (CANVAS_W - 240);
    const targetY = 100 + Math.random() * (CANVAS_H - 200);
    const dx   = targetX - x;
    const dy   = targetY - y;
    const dist = Math.hypot(dx, dy);
    const spd  = (50 + Math.random() * 80) * speedMult;
    return createDebris(x, y, 'large', (dx / dist) * spd, (dy / dist) * spd);
}

function splitDebris(d) {
    const childMap = { large: 'medium', medium: 'small', small: null };
    const next = childMap[d.size];
    if (!next) return [];

    const count    = 2 + Math.floor(Math.random() * 2);
    const children = [];
    const parentAngle = Math.atan2(d.vy, d.vx);
    const parentSpeed = Math.hypot(d.vx, d.vy);

    for (let i = 0; i < count; i++) {
        const scatter = (Math.random() - 0.5) * Math.PI;
        const angle   = parentAngle + scatter;
        const spd     = (parentSpeed * (0.8 + Math.random() * 0.7)) + 30;
        const ox      = Math.cos(angle) * (d.radius * 0.6);
        const oy      = Math.sin(angle) * (d.radius * 0.6);
        children.push(createDebris(d.x + ox, d.y + oy, next, Math.cos(angle) * spd, Math.sin(angle) * spd));
    }
    return children;
}

function spawnEnemyFromEdge(speedMult) {
    const edge = Math.floor(Math.random() * 4);
    let x, y, vx, vy;
    const margin = 60;
    const spd = (80 + Math.random() * 60) * speedMult;

    // Pick an entry edge and aim toward the opposite side with some scatter
    if (edge === 0) {
        x = Math.random() * CANVAS_W; y = -margin;
        vx = (Math.random() - 0.5) * spd * 0.5; vy = spd;
    } else if (edge === 1) {
        x = CANVAS_W + margin; y = Math.random() * CANVAS_H;
        vx = -spd; vy = (Math.random() - 0.5) * spd * 0.5;
    } else if (edge === 2) {
        x = Math.random() * CANVAS_W; y = CANVAS_H + margin;
        vx = (Math.random() - 0.5) * spd * 0.5; vy = -spd;
    } else {
        x = -margin; y = Math.random() * CANVAS_H;
        vx = spd; vy = (Math.random() - 0.5) * spd * 0.5;
    }
    return createEnemy(x, y, vx, vy);
}

function enemySpawnInterval() {
    return Math.max(5, ENEMY_SPAWN_BASE - (level - 1) * 0.8) + (Math.random() * 4 - 2);
}

function spawnPowerupAt(x, y) {
    const roll = Math.random();
    let type;
    if      (roll < 0.28) type = 'rapid';
    else if (roll < 0.56) type = 'spread';
    else if (roll < 0.78) type = 'laser';
    else                  type = 'bomb';
    powerups.push(createPowerup(x, y, type));
}

function spawnPowerupFromEdge() {
    const edge = Math.floor(Math.random() * 4);
    const margin = 30;
    let x, y;
    if      (edge === 0) { x = Math.random() * CANVAS_W; y = -margin; }
    else if (edge === 1) { x = CANVAS_W + margin; y = Math.random() * CANVAS_H; }
    else if (edge === 2) { x = Math.random() * CANVAS_W; y = CANVAS_H + margin; }
    else                 { x = -margin; y = Math.random() * CANVAS_H; }
    spawnPowerupAt(x, y);
}

function spawnFriendlyFromEdge() {
    const type  = Math.random() < 0.75 ? 'spaceman' : 'iss';
    const edge  = Math.floor(Math.random() * 4);
    const margin = 60;
    let x, y, vx, vy;
    const spd = type === 'iss' ? 28 + Math.random() * 18 : 40 + Math.random() * 30;

    if (edge === 0) {
        x = Math.random() * CANVAS_W; y = -margin;
        vx = (Math.random() - 0.5) * spd * 0.4; vy = spd * (0.6 + Math.random() * 0.4);
    } else if (edge === 1) {
        x = CANVAS_W + margin; y = Math.random() * CANVAS_H;
        vx = -spd * (0.6 + Math.random() * 0.4); vy = (Math.random() - 0.5) * spd * 0.4;
    } else if (edge === 2) {
        x = Math.random() * CANVAS_W; y = CANVAS_H + margin;
        vx = (Math.random() - 0.5) * spd * 0.4; vy = -spd * (0.6 + Math.random() * 0.4);
    } else {
        x = -margin; y = Math.random() * CANVAS_H;
        vx = spd * (0.6 + Math.random() * 0.4); vy = (Math.random() - 0.5) * spd * 0.4;
    }
    friendlies.push(createFriendly(x, y, vx, vy, type));
}

function friendlySpawnInterval() {
    return Math.max(18, FRIENDLY_SPAWN_BASE - level * 1.2) + (Math.random() * 8 - 4);
}

function debrisWeight(d) {
    if (d.size === 'large')  return 1.0;
    if (d.size === 'medium') return 0.5;
    return 0.25;
}

function totalDebrisWeight() {
    return debris.reduce((sum, d) => sum + debrisWeight(d), 0);
}

// ── Particles ────────────────────────────────────────────────────────────────

function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd   = 30 + Math.random() * 120;
        particleExplosions.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            life: 0.4 + Math.random() * 0.4,
            maxLife: 0.4 + Math.random() * 0.4,
            color,
            active: true,
        });
    }
}

// ── Level / Game Start ───────────────────────────────────────────────────────

function resetWeapon() {
    weaponMode      = 'normal';
    weaponTimer     = 0;
    laserCharge     = 1.0;
    laserOverheat   = 0;
    laserDamageTimer = 0;
    laserBeam       = null;
}

function startLevel(n) {
    level    = n;
    levelCfg = getLevelConfig(n);
    debris   = [];
    bullets  = [];
    enemies  = [];
    powerups = [];
    floatingTexts      = [];
    particleExplosions = [];
    spawnTimer          = levelCfg.spawnInterval;
    enemySpawnTimer     = 4;
    powerupSpawnTimer   = 10 + Math.random() * 5;
    friendlySpawnTimer  = friendlySpawnInterval();
    waveDebrisRemaining = levelCfg.debrisCount * 3;
    screenFlash         = 0;
    notification        = null;
    friendlies          = [];

    for (let i = 0; i < levelCfg.debrisCount; i++) {
        debris.push(spawnDebrisFromEdge(levelCfg.speedMult));
    }
    waveDebrisRemaining -= levelCfg.debrisCount;
    levelTransitionTimer = 0;
}

function startGame() {
    score  = 0;
    lives  = 3;
    bombs  = 0;
    ship   = createShip();
    enemies      = [];
    powerups     = [];
    friendlies   = [];
    floatingTexts = [];
    screenFlash  = 0;
    notification = null;
    assistActive    = false;
    assistSource    = null;
    assistTimer     = 0;
    assistFireTimer = 0;
    resetWeapon();
    startLevel(1);
    state  = 'playing';
}

// ── Update ───────────────────────────────────────────────────────────────────

function update(dt) {
    if (state === 'menu')      updateMenu(dt);
    else if (state === 'playing')   updatePlaying(dt);
    else if (state === 'game_over') updateGameOver(dt);
}

function updateMenu() {
    if (isStart()) startGame();
}

function updateGameOver(dt) {
    gameOverLockout -= dt;
    if (gameOverLockout <= 0 && isStart()) {
        state = 'menu';
    }
}

function updatePlaying(dt) {
    if (levelTransitionTimer > 0) {
        levelTransitionTimer -= dt;
        if (levelTransitionTimer <= 0) {
            startLevel(level + 1);
            ship.invulnerable = true;
            ship.invulnerableTimer = 2.0;
        }
        return;
    }

    updateShip(dt);
    updateBullets(dt);
    updateDebris(dt);
    updateEnemies(dt);
    updateFriendlies(dt);
    updateAssist(dt);
    updateParticles(dt);
    updateFloatingTexts(dt);
    updatePowerups(dt);
    updateWeaponState(dt);
    checkCollisions();
    checkLevelComplete();

    if (screenFlash > 0) screenFlash -= dt * 3;
    if (notification && (notification.timer -= dt) <= 0) notification = null;
}

function updateShip(dt) {
    // Rotation
    if (isLeft())  ship.rotation -= ROTATION_SPEED * dt;
    if (isRight()) ship.rotation += ROTATION_SPEED * dt;

    // Thrust
    const thrusting = isForward();
    const reversing = isBack();
    ship.thrustOn = thrusting;

    if (thrusting) {
        ship.vx += Math.sin(ship.rotation) * THRUST * dt;
        ship.vy -= Math.cos(ship.rotation) * THRUST * dt;
    }
    if (reversing) {
        ship.vx -= Math.sin(ship.rotation) * THRUST * 0.5 * dt;
        ship.vy += Math.cos(ship.rotation) * THRUST * 0.5 * dt;
    }

    // Friction & speed cap
    ship.vx *= FRICTION;
    ship.vy *= FRICTION;
    const spd = Math.hypot(ship.vx, ship.vy);
    if (spd > MAX_SPEED) {
        ship.vx = (ship.vx / spd) * MAX_SPEED;
        ship.vy = (ship.vy / spd) * MAX_SPEED;
    }

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    // Wrap around screen edges
    if (ship.x < -ship.radius) ship.x = CANVAS_W + ship.radius;
    if (ship.x > CANVAS_W + ship.radius) ship.x = -ship.radius;
    if (ship.y < -ship.radius) ship.y = CANVAS_H + ship.radius;
    if (ship.y > CANVAS_H + ship.radius) ship.y = -ship.radius;

    // Invulnerability countdown
    if (ship.invulnerable) {
        ship.invulnerableTimer -= dt;
        if (ship.invulnerableTimer <= 0) ship.invulnerable = false;
    }

    // Bomb (B key)
    if (keys['KeyB'] && !keys['_bUsed'] && bombs > 0) {
        keys['_bUsed'] = true;
        detonateBomb();
    }
    if (!keys['KeyB']) keys['_bUsed'] = false;

    // Shooting — laser is handled in updateWeaponState; others here
    if (weaponMode !== 'laser') {
        ship.shootCooldown -= dt;
        const cooldown = weaponMode === 'rapid' ? 0.08 : SHOOT_COOLDOWN;
        if (isShoot() && ship.shootCooldown <= 0) {
            const nx = ship.x + Math.sin(ship.rotation) * ship.radius;
            const ny = ship.y - Math.cos(ship.rotation) * ship.radius;
            if (weaponMode === 'spread') {
                if (bullets.length + 3 <= 15) {
                    [-0.32, 0, 0.32].forEach(offset => {
                        bullets.push(createBullet(nx, ny, ship.rotation + offset));
                    });
                    ship.shootCooldown = SHOOT_COOLDOWN + 0.05;
                    playLaser();
                }
            } else {
                if (bullets.length < 12) {
                    bullets.push(createBullet(nx, ny, ship.rotation));
                    ship.shootCooldown = cooldown;
                    playLaser();
                }
            }
        }
    }
}

function updateBullets(dt) {
    for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.lifetime -= dt;
        if (b.lifetime <= 0 || b.x < 0 || b.x > CANVAS_W || b.y < 0 || b.y > CANVAS_H) {
            b.active = false;
        }
    }
    bullets = bullets.filter(b => b.active);
}

function updateDebris(dt) {
    for (const d of debris) {
        d.x        += d.vx * dt;
        d.y        += d.vy * dt;
        d.rotation += d.rotationSpeed * dt;

        const margin = d.radius + 20;
        if (d.x < -margin || d.x > CANVAS_W + margin ||
            d.y < -margin || d.y > CANVAS_H + margin) {
            d.active = false;
        }
    }
    debris = debris.filter(d => d.active);

    // Continuous spawning
    if (waveDebrisRemaining > 0 && totalDebrisWeight() < levelCfg.maxDebris) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            debris.push(spawnDebrisFromEdge(levelCfg.speedMult));
            waveDebrisRemaining--;
            spawnTimer = levelCfg.spawnInterval;
        }
    }
}

function updateParticles(dt) {
    for (const p of particleExplosions) {
        p.x    += p.vx * dt;
        p.y    += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) p.active = false;
    }
    particleExplosions = particleExplosions.filter(p => p.active);
}

function updateEnemies(dt) {
    for (const e of enemies) {
        e.pulseTimer += dt;
        e.spawnAge   += dt;

        // At higher levels, nudge velocity slightly toward the player (homing)
        if (level >= ENEMY_HOMING_LEVEL) {
            const dx   = ship.x - e.x;
            const dy   = ship.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const strength = 20 * levelCfg.speedMult; // homing pull, px/s²
            e.vx += (dx / dist) * strength * dt;
            e.vy += (dy / dist) * strength * dt;
            // Cap enemy speed
            const spd = Math.hypot(e.vx, e.vy);
            const maxSpd = 160 * levelCfg.speedMult;
            if (spd > maxSpd) { e.vx = e.vx / spd * maxSpd; e.vy = e.vy / spd * maxSpd; }
        }

        e.x += e.vx * dt;
        e.y += e.vy * dt;

        const margin = ENEMY_RADIUS + 30;
        if (e.x < -margin || e.x > CANVAS_W + margin ||
            e.y < -margin || e.y > CANVAS_H + margin) {
            e.active = false;
        }
    }
    enemies = enemies.filter(e => e.active);

    // Spawn new enemy on timer
    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0) {
        enemies.push(spawnEnemyFromEdge(levelCfg.speedMult));
        enemySpawnTimer = enemySpawnInterval();
        playEnemySpawn();
    }
}

function updateFloatingTexts(dt) {
    for (const t of floatingTexts) {
        t.y    -= 40 * dt;
        t.life -= dt;
        if (t.life <= 0) t.active = false;
    }
    floatingTexts = floatingTexts.filter(t => t.active);
}

function updatePowerups(dt) {
    for (const p of powerups) {
        p.x        += p.vx * dt;
        p.y        += p.vy * dt;
        p.rotation += 2.0 * dt;
        p.lifetime -= dt;

        // Wrap at edges so powerups don't vanish immediately off-screen
        if (p.x < -POWERUP_RADIUS) p.x = CANVAS_W + POWERUP_RADIUS;
        if (p.x > CANVAS_W + POWERUP_RADIUS) p.x = -POWERUP_RADIUS;
        if (p.y < -POWERUP_RADIUS) p.y = CANVAS_H + POWERUP_RADIUS;
        if (p.y > CANVAS_H + POWERUP_RADIUS) p.y = -POWERUP_RADIUS;

        if (p.lifetime <= 0) p.active = false;
    }
    powerups = powerups.filter(p => p.active);

    // Spawn powerup on timer
    powerupSpawnTimer -= dt;
    if (powerupSpawnTimer <= 0) {
        spawnPowerupFromEdge();
        powerupSpawnTimer = 12 + Math.random() * 8;
    }
}

function findNearestTarget() {
    let nearest = null, bestDist = Infinity;
    for (const obj of [...debris, ...enemies]) {
        if (!obj.active) continue;
        const d = Math.hypot(obj.x - ship.x, obj.y - ship.y);
        if (d < bestDist) { bestDist = d; nearest = obj; }
    }
    return nearest;
}

function updateFriendlies(dt) {
    for (const f of friendlies) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.bobTimer += dt;

        // Wrap at canvas edges so they stay in play
        const r = f.type === 'iss' ? ISS_RADIUS : SPACEMAN_RADIUS;
        if (f.x < -r)          f.x = CANVAS_W + r;
        if (f.x > CANVAS_W + r) f.x = -r;
        if (f.y < -r)          f.y = CANVAS_H + r;
        if (f.y > CANVAS_H + r) f.y = -r;
    }
    friendlies = friendlies.filter(f => f.active);

    // Spawn timer
    friendlySpawnTimer -= dt;
    if (friendlySpawnTimer <= 0) {
        spawnFriendlyFromEdge();
        friendlySpawnTimer = friendlySpawnInterval();
    }
}

function updateAssist(dt) {
    if (!assistActive) return;

    // If the source friendly was shot, end assist early
    if (!assistSource || !assistSource.active) {
        assistActive = false;
        assistSource = null;
        return;
    }

    assistTimer -= dt;
    if (assistTimer <= 0) {
        assistActive = false;
        assistSource = null;
        notification = { text: 'AUTO-FIRE ENDED', color: '#88ddff', timer: 2 };
        return;
    }

    assistFireTimer -= dt;
    if (assistFireTimer <= 0) {
        assistFireTimer = assistFireRate;
        const target = findNearestTarget();
        if (target) {
            const sx    = assistSource.x;
            const sy    = assistSource.y;
            const angle = Math.atan2(target.x - sx, -(target.y - sy));
            const b = createBullet(sx, sy, angle);
            b.color = '#00eeff';
            bullets.push(b);
            playLaser();
        }
    }
}

function updateWeaponState(dt) {
    laserBeam = null;

    if (weaponMode !== 'normal') {
        weaponTimer -= dt;
        if (weaponTimer <= 0) {
            resetWeapon();
            notification = { text: 'WEAPON EXPIRED', color: '#aaaaaa', timer: 2 };
            return;
        }
    }

    if (weaponMode === 'laser') {
        if (laserOverheat > 0) laserOverheat -= dt;

        if (isShoot() && laserCharge > 0 && laserOverheat <= 0) {
            laserCharge -= LASER_DRAIN * dt;
            if (laserCharge <= 0) {
                laserCharge   = 0;
                laserOverheat = 1.8;
            }
            const beam = laserRaycast();
            laserBeam = beam;

            // Damage first hit target at a controlled rate
            laserDamageTimer -= dt;
            if (beam.target && laserDamageTimer <= 0) {
                laserDamageTimer = LASER_DAMAGE_RATE;
                const obj = beam.target;
                obj.active = false;
                if (obj.size !== undefined) {
                    // Debris
                    score += obj.points;
                    const children = splitDebris(obj);
                    debris = debris.filter(d => d.active);
                    debris.push(...children);
                    spawnParticles(obj.x, obj.y, 4, debrisColor(obj.size));
                    playExplosion(obj.size);
                } else {
                    // Enemy
                    score += obj.points;
                    enemies = enemies.filter(e => e.active);
                    spawnParticles(obj.x, obj.y, 12, '#44ff44');
                    floatingTexts.push({ x: obj.x, y: obj.y, text: `+${obj.points}`, life: 1.0, maxLife: 1.0, active: true });
                    playEnemyExplosion();
                }
            }
            // Throttled laser sound
            laserDamageTimer <= LASER_DAMAGE_RATE - 0.05 && playLaserTick();
        } else {
            laserCharge = Math.min(1, laserCharge + LASER_REGEN * dt);
        }
    }
}

function laserRaycast() {
    const dx = Math.sin(ship.rotation);
    const dy = -Math.cos(ship.rotation);
    const ox = ship.x + dx * (ship.radius + 2);
    const oy = ship.y + dy * (ship.radius + 2);

    let target = null, bestT = Infinity;
    for (const obj of [...debris, ...enemies]) {
        if (!obj.active) continue;
        const fx = obj.x - ox, fy = obj.y - oy;
        const b2 = fx * dx + fy * dy;
        const disc = b2 * b2 - (fx * fx + fy * fy - obj.radius * obj.radius);
        if (disc < 0 || b2 < 0) continue;
        const t = b2 - Math.sqrt(disc);
        if (t < bestT) { bestT = t; target = obj; }
    }

    const reach = Math.min(target ? bestT : 900, 900);
    return { sx: ox, sy: oy, ex: ox + dx * reach, ey: oy + dy * reach, target };
}

function detonateBomb() {
    if (bombs <= 0) return;
    bombs--;
    playBomb();
    screenFlash = 1.0;

    // Split all debris one size down, destroy smalls
    const survivors = [];
    for (const d of debris) {
        if (!d.active) continue;
        score += d.points;
        const children = splitDebris(d);
        if (children.length > 0) {
            survivors.push(...children);
        }
        spawnParticles(d.x, d.y, 6, debrisColor(d.size));
    }
    debris = survivors;

    // Destroy all enemies
    for (const e of enemies) {
        if (!e.active) continue;
        score += e.points;
        spawnParticles(e.x, e.y, 14, '#44ff44');
        floatingTexts.push({ x: e.x, y: e.y, text: `+${e.points}`, life: 1.0, maxLife: 1.0, active: true });
    }
    enemies = [];

    notification = { text: 'BOMB!', color: '#ff8800', timer: 1.5 };
}

function checkCollisions() {
    const newDebris = [];

    // Bullets vs Debris
    for (const b of bullets) {
        if (!b.active) continue;
        for (const d of debris) {
            if (!d.active) continue;
            if (circlesOverlap(b, d)) {
                b.active = false;
                d.active = false;
                score += d.points;
                const children = splitDebris(d);
                newDebris.push(...children);
                const pCount = d.size === 'large' ? 10 : d.size === 'medium' ? 6 : 3;
                spawnParticles(d.x, d.y, pCount, debrisColor(d.size));
                playExplosion(d.size);
                if (d.size === 'large' && Math.random() < 0.15) spawnPowerupAt(d.x, d.y);
                break;
            }
        }
    }

    bullets = bullets.filter(b => b.active);
    debris  = debris.filter(d => d.active);
    debris.push(...newDebris);

    // Bullets vs Enemies
    for (const b of bullets) {
        if (!b.active) continue;
        for (const e of enemies) {
            if (!e.active) continue;
            if (circlesOverlap(b, e)) {
                b.active = false;
                e.active = false;
                score += e.points;
                spawnParticles(e.x, e.y, 16, '#44ff44');
                floatingTexts.push({ x: e.x, y: e.y, text: `+${e.points}`, life: 1.0, maxLife: 1.0, active: true });
                playEnemyExplosion();
                break;
            }
        }
    }

    bullets = bullets.filter(b => b.active);
    enemies = enemies.filter(e => e.active);

    // Ship vs Debris or Enemies
    if (!ship.invulnerable) {
        let hit = false;
        for (const d of debris) {
            if (!d.active) continue;
            if (circlesOverlap(ship, d)) { hit = true; break; }
        }
        if (!hit) {
            for (const e of enemies) {
                if (!e.active) continue;
                if (circlesOverlap(ship, e)) {
                    e.active = false;
                    spawnParticles(e.x, e.y, 12, '#44ff44');
                    hit = true;
                    break;
                }
            }
            enemies = enemies.filter(e => e.active);
        }

        if (hit) {
            lives--;
            spawnParticles(ship.x, ship.y, 15, '#ff4444');
            playShipHit();

            if (lives <= 0) {
                if (score > hiScore) {
                    hiScore = score;
                    localStorage.setItem('spaceRocksHiScore', hiScore);
                }
                playGameOver();
                state = 'game_over';
                gameOverLockout = 2.0;
                return;
            }

            ship.x  = CANVAS_W / 2;
            ship.y  = CANVAS_H / 2;
            ship.vx = 0;
            ship.vy = 0;
            ship.invulnerable      = true;
            ship.invulnerableTimer = 3.0;
        }
    }

    // Ship vs Powerups (collect on touch)
    for (const p of powerups) {
        if (!p.active) continue;
        if (circlesOverlap(ship, p)) {
            p.active = false;
            collectPowerup(p.type);
        }
    }
    powerups = powerups.filter(p => p.active);

    // Bullets vs Friendlies (penalty + friendly fire alert)
    for (const b of bullets) {
        if (!b.active) continue;
        for (const f of friendlies) {
            if (!f.active) continue;
            if (circlesOverlap(b, f)) {
                b.active = false;
                f.active = false;
                const penalty = f.type === 'iss' ? ISS_PENALTY : SPACEMAN_PENALTY;
                score = Math.max(0, score - penalty);
                spawnParticles(f.x, f.y, 10, '#ffaaaa');
                floatingTexts.push({ x: f.x, y: f.y, text: `-${penalty}`, life: 1.2, maxLife: 1.2, active: true });
                notification = { text: 'FRIENDLY FIRE!', color: '#ff4444', timer: 2.5 };
                playFriendlyDestroyed();
                break;
            }
        }
    }
    bullets    = bullets.filter(b => b.active);
    friendlies = friendlies.filter(f => f.active);

    // Ship vs Friendlies — activate assist on touch; friendly stays in play
    for (const f of friendlies) {
        if (!f.active) continue;
        if (circlesOverlap(ship, f) && assistTimer <= 0) {
            collectFriendly(f);
        }
    }
}

function collectPowerup(type) {
    playPowerupCollect();
    if (type === 'bomb') {
        bombs = Math.min(MAX_BOMBS, bombs + 1);
        notification = { text: `BOMB +1  (${bombs}/${MAX_BOMBS})  press B`, color: POWERUP_COLORS.bomb, timer: 2.5 };
    } else {
        weaponMode  = type;
        weaponTimer = WEAPON_DURATION;
        const labels = { rapid: 'RAPID FIRE!', spread: 'SPREAD SHOT!', laser: 'LASER BEAM!' };
        notification = { text: labels[type], color: POWERUP_COLORS[type], timer: 2.5 };
        if (type === 'laser') { laserCharge = 1.0; laserOverheat = 0; }
    }
}

function collectFriendly(f) {
    playAssistActivate();
    assistActive    = true;
    assistSource    = f;
    assistTimer     = ASSIST_DURATION;
    assistFireRate  = f.type === 'iss' ? ISS_FIRE_RATE : SPACEMAN_FIRE_RATE;
    assistFireTimer = 0;
    const label = f.type === 'iss' ? 'ISS ESCORT' : 'SPACEMAN RESCUE';
    notification = { text: `${label} — AUTO-FIRE ${ASSIST_DURATION}s`, color: '#00eeff', timer: 3 };
    spawnParticles(f.x, f.y, 12, '#00eeff');
}

function checkLevelComplete() {
    if (debris.length === 0 && waveDebrisRemaining === 0) {
        levelTransitionTimer = 2.5;
        playLevelUp();
    }
}

function circlesOverlap(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r  = a.radius + b.radius;
    return dx * dx + dy * dy < r * r;
}

function debrisColor(size) {
    if (size === 'large')  return '#aaaaaa';
    if (size === 'medium') return '#bbaa88';
    return '#ddccaa';
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    renderStars();

    if (state === 'menu')           renderMenu();
    else if (state === 'playing')   renderPlaying();
    else if (state === 'game_over') renderGameOver();
}

function renderStars() {
    for (const s of stars) {
        ctx.fillStyle = `rgba(255,255,255,${s.brightness})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
    }
}

function renderMenu() {
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font = 'bold 64px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur = 20;
    ctx.fillText('SPACE ROCKS', CANVAS_W / 2, 200);

    ctx.shadowBlur = 0;
    ctx.font = '20px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('A/D or ← → to rotate', CANVAS_W / 2, 290);
    ctx.fillText('W/S or ↑ ↓ to thrust', CANVAS_W / 2, 320);
    ctx.fillText('SPACE to shoot', CANVAS_W / 2, 350);

    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) ctx.fillText('PRESS SPACE TO START', CANVAS_W / 2, 430);

    if (hiScore > 0) {
        ctx.font = '18px monospace';
        ctx.fillStyle = '#ffcc44';
        ctx.fillText(`HI-SCORE: ${hiScore}`, CANVAS_W / 2, 490);
    }

    ctx.restore();
}

function renderPlaying() {
    renderParticles();
    renderDebris();
    renderPowerups();
    renderFriendlies();
    renderEnemies();
    renderLaserBeam();
    renderBullets();
    renderShip();
    renderFloatingTexts();
    renderHUD();
    renderNotification();

    // Bomb screen flash
    if (screenFlash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, screenFlash);
        ctx.fillStyle   = '#ff8800';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
    }

    if (levelTransitionTimer > 0) renderLevelTransition();
}

function renderDebris() {
    for (const d of debris) {
        const shape = DEBRIS_SHAPES[d.shapeVariant];
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.scale(d.radius, d.radius);

        ctx.beginPath();
        ctx.moveTo(shape[0][0], shape[0][1]);
        for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i][0], shape[i][1]);
        ctx.closePath();

        ctx.strokeStyle = debrisColor(d.size);
        ctx.lineWidth   = 2 / d.radius;
        ctx.stroke();

        ctx.restore();
    }
}

function renderFriendlies() {
    for (const f of friendlies) {
        ctx.save();
        ctx.translate(f.x, f.y);

        // Glow ring when this friendly is the active assist source
        if (f === assistSource && assistActive) {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
            const r = f.type === 'iss' ? ISS_RADIUS + 8 : SPACEMAN_RADIUS + 8;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0,238,255,${0.4 + 0.5 * pulse})`;
            ctx.lineWidth   = 3;
            ctx.shadowColor = '#00eeff';
            ctx.shadowBlur  = 14;
            ctx.stroke();
            ctx.shadowBlur  = 0;
        }

        if (f.type === 'spaceman') {
            const bob = Math.sin(f.bobTimer * 1.8) * 2;
            ctx.translate(0, bob);

            ctx.shadowColor = '#88ffee';
            ctx.shadowBlur  = 10;

            // Body (suit torso)
            ctx.fillStyle = '#ddddff';
            ctx.fillRect(-5, 2, 10, 10);
            ctx.strokeStyle = '#aabbff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-5, 2, 10, 10);

            // Helmet
            ctx.beginPath();
            ctx.arc(0, -4, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#ccddff';
            ctx.fill();
            ctx.strokeStyle = '#88aaff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Visor (gold tinted)
            ctx.beginPath();
            ctx.ellipse(0, -4, 4, 3, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,220,80,0.75)';
            ctx.fill();

            // Arms
            ctx.strokeStyle = '#ccddff';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(-5, 4);  ctx.lineTo(-10, 8);  ctx.stroke();
            ctx.beginPath(); ctx.moveTo(5, 4);   ctx.lineTo(10, 8);   ctx.stroke();

            // Legs
            ctx.beginPath(); ctx.moveTo(-3, 12); ctx.lineTo(-4, 18);  ctx.stroke();
            ctx.beginPath(); ctx.moveTo(3, 12);  ctx.lineTo(4, 18);   ctx.stroke();

        } else {
            // ISS
            ctx.shadowColor = '#aaddff';
            ctx.shadowBlur  = 14;

            // Central truss bar (horizontal)
            ctx.fillStyle   = '#cccccc';
            ctx.strokeStyle = '#aaaaaa';
            ctx.lineWidth   = 2;
            ctx.fillRect(-ISS_RADIUS, -4, ISS_RADIUS * 2, 8);
            ctx.strokeRect(-ISS_RADIUS, -4, ISS_RADIUS * 2, 8);

            // Habitat module (center cylinder)
            ctx.fillStyle   = '#ddeeff';
            ctx.fillRect(-14, -9, 28, 18);
            ctx.strokeStyle = '#88aacc';
            ctx.lineWidth   = 1.5;
            ctx.strokeRect(-14, -9, 28, 18);

            // Module windows
            [-5, 5].forEach(ox => {
                ctx.beginPath();
                ctx.arc(ox, 0, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#aaddff';
                ctx.fill();
            });

            // Solar panel arrays (left + right)
            [[-ISS_RADIUS - 2, -12], [ISS_RADIUS - 18, -12]].forEach(([px, py]) => {
                ctx.fillStyle   = '#2255aa';
                ctx.strokeStyle = '#4488ff';
                ctx.lineWidth   = 1;
                ctx.fillRect(px, py, 18, 24);
                ctx.strokeRect(px, py, 18, 24);
                // Panel lines
                ctx.strokeStyle = '#6699cc';
                ctx.lineWidth = 0.5;
                for (let j = 1; j < 4; j++) {
                    ctx.beginPath();
                    ctx.moveTo(px, py + j * 6);
                    ctx.lineTo(px + 18, py + j * 6);
                    ctx.stroke();
                }
            });
        }

        ctx.restore();
    }
}

function renderEnemies() {
    for (const e of enemies) {
        const pulse = 0.5 + 0.5 * Math.sin(e.pulseTimer * 5);

        // Entrance strobe: flash brightly for first 0.8 seconds
        const strobing = e.spawnAge < 0.8 && Math.floor(e.spawnAge * 12) % 2 === 0;
        if (strobing) {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.beginPath();
            ctx.arc(0, 0, e.radius + 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,255,120,0.35)';
            ctx.fill();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(e.x, e.y);

        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur  = 16 + 8 * pulse;

        // ── Saucer body ──
        ctx.beginPath();
        ctx.ellipse(0, 5, 26, 9, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth   = 2.5;
        ctx.stroke();

        // Solid body fill (dark tinted)
        ctx.beginPath();
        ctx.ellipse(0, 5, 26, 9, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,80,40,0.7)';
        ctx.fill();

        // ── Dome ──
        ctx.beginPath();
        ctx.ellipse(0, 2, 14, 12, 0, Math.PI, 0, false);
        ctx.strokeStyle = '#44ffcc';
        ctx.lineWidth   = 2;
        ctx.stroke();

        // Dome fill (tinted so it reads as a separate surface)
        ctx.beginPath();
        ctx.ellipse(0, 2, 14, 12, 0, Math.PI, 0, false);
        ctx.fillStyle = `rgba(0,${Math.floor(120 + 80 * pulse)},80,0.5)`;
        ctx.fill();

        // ── Rim lights ──
        const rimColors = ['#ff4444', '#ffff00', '#00ffff'];
        [-16, 0, 16].forEach((ox, i) => {
            ctx.beginPath();
            ctx.arc(ox, 5, 3.5, 0, Math.PI * 2);
            ctx.fillStyle  = rimColors[i];
            ctx.shadowColor = rimColors[i];
            ctx.shadowBlur  = 8;
            ctx.fill();
        });

        ctx.restore();
    }
}

function renderPowerups() {
    for (const p of powerups) {
        const color = POWERUP_COLORS[p.type];
        const flash = p.lifetime < 3 && Math.floor(p.lifetime * 6) % 2 === 0; // blink when expiring
        if (flash) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        ctx.shadowColor = color;
        ctx.shadowBlur  = 14;

        // Diamond (rotated square)
        const r = POWERUP_RADIUS;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.fillStyle = `${color}33`; // translucent fill
        ctx.fill();

        // Inner icon letter (not rotated so it's always readable)
        ctx.rotate(-p.rotation);
        ctx.shadowBlur  = 0;
        ctx.font        = 'bold 11px monospace';
        ctx.fillStyle   = color;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(POWERUP_LABELS[p.type], 0, 0);
        ctx.textBaseline = 'alphabetic';

        ctx.restore();
    }
}

function renderLaserBeam() {
    if (!laserBeam) return;
    const { sx, sy, ex, ey } = laserBeam;

    ctx.save();
    // Outer glow
    ctx.strokeStyle = 'rgba(255,80,255,0.25)';
    ctx.lineWidth   = 10;
    ctx.shadowColor = '#ff44ff';
    ctx.shadowBlur  = 20;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    // Core beam
    ctx.strokeStyle = '#ff88ff';
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 8;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    // Bright center line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = 0;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
}

function renderNotification() {
    if (!notification) return;
    ctx.save();
    ctx.textAlign  = 'center';
    ctx.font       = 'bold 28px monospace';
    ctx.fillStyle  = notification.color;
    ctx.shadowColor = notification.color;
    ctx.shadowBlur  = 16;
    ctx.globalAlpha = Math.min(1, notification.timer);
    ctx.fillText(notification.text, CANVAS_W / 2, CANVAS_H / 2 - 80);
    ctx.restore();
}

function renderFloatingTexts() {
    for (const t of floatingTexts) {
        const alpha = t.life / t.maxLife;
        ctx.save();
        ctx.globalAlpha  = alpha;
        ctx.font         = 'bold 18px monospace';
        ctx.fillStyle    = '#44ff44';
        ctx.textAlign    = 'center';
        ctx.shadowColor  = '#00ff50';
        ctx.shadowBlur   = 10;
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
    }
}

function renderBullets() {
    for (const b of bullets) {
        const color = b.color || '#ffee44';
        ctx.save();
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function renderShip() {
    if (!ship.active) return;

    if (ship.invulnerable) {
        // Blink: hide every other 0.1s interval
        if (Math.floor(ship.invulnerableTimer * 10) % 2 === 0) return;
    }

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.rotation);

    // Engine flame (when thrusting)
    if (ship.thrustOn) {
        const flameLen = 8 + Math.random() * 10;
        ctx.beginPath();
        ctx.moveTo(-6, 12);
        ctx.lineTo(0, 12 + flameLen);
        ctx.lineTo(6, 12);
        ctx.strokeStyle = `rgba(255, ${100 + Math.floor(Math.random() * 155)}, 0, 0.9)`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Ship body (triangle)
    ctx.beginPath();
    ctx.moveTo(0, -16);    // nose
    ctx.lineTo(12, 14);    // bottom-right
    ctx.lineTo(0, 9);      // inner notch
    ctx.lineTo(-12, 14);   // bottom-left
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Cockpit dot
    ctx.beginPath();
    ctx.arc(0, -4, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#88ccff';
    ctx.fill();

    ctx.restore();
}

function renderParticles() {
    for (const p of particleExplosions) {
        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function renderHUD() {
    ctx.save();
    ctx.font      = 'bold 20px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${score}`, 16, 32);

    ctx.font      = '16px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`LVL ${level}`, 16, 56);

    if (hiScore > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffcc44';
        ctx.font      = '14px monospace';
        ctx.fillText(`BEST: ${hiScore}`, CANVAS_W / 2, 22);
    }

    // Lives as small ship icons (top-right)
    for (let i = 0; i < lives; i++) {
        const lx = CANVAS_W - 24 - i * 28;
        const ly = 22;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.beginPath();
        ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // Weapon mode + timer bar (bottom-left)
    if (weaponMode !== 'normal') {
        const color  = POWERUP_COLORS[weaponMode];
        const label  = { rapid: 'RAPID FIRE', spread: 'SPREAD', laser: 'LASER' }[weaponMode];
        const barW   = 120;
        const barFill = (weaponTimer / WEAPON_DURATION) * barW;
        const bx = 16, by = CANVAS_H - 36;

        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.textAlign = 'left';
        ctx.fillText(label, bx, by - 6);
        ctx.shadowBlur = 0;

        // Background bar
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bx, by, barW, 6);
        // Fill bar
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barFill, 6);

        // Laser charge sub-bar
        if (weaponMode === 'laser') {
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(bx, by + 10, barW, 4);
            ctx.fillStyle = laserOverheat > 0 ? '#ff4444' : '#ff88ff';
            ctx.fillRect(bx, by + 10, laserCharge * barW, 4);
        }
    }

    // Bomb count (bottom-left, below weapon or at bottom if no weapon)
    if (bombs > 0) {
        const by = weaponMode !== 'normal' ? CANVAS_H - 70 : CANVAS_H - 36;
        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = POWERUP_COLORS.bomb;
        ctx.shadowColor = POWERUP_COLORS.bomb;
        ctx.shadowBlur  = 6;
        ctx.textAlign = 'left';
        ctx.fillText(`BOMB x${bombs}  [B]`, 16, by);
        ctx.shadowBlur = 0;
    }

    // Auto-aim assist indicator (bottom-right)
    if (assistActive) {
        const barW = 110;
        const bx   = CANVAS_W - barW - 16;
        const by   = CANVAS_H - 36;
        const pct  = assistTimer / ASSIST_DURATION;

        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = '#00eeff';
        ctx.shadowColor = '#00eeff';
        ctx.shadowBlur  = 8;
        ctx.textAlign = 'right';
        ctx.fillText(`AUTO-FIRE  ${Math.ceil(assistTimer)}s`, CANVAS_W - 16, by - 6);
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, barW, 6);
        ctx.fillStyle = '#00eeff';
        ctx.fillRect(bx, by, pct * barW, 6);
    }

    ctx.restore();
}

function renderLevelTransition() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, levelTransitionTimer * 0.8);
    ctx.textAlign   = 'center';
    ctx.font        = 'bold 56px monospace';
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur  = 30;
    ctx.fillText(`LEVEL ${level + 1}`, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.font      = '22px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.shadowBlur = 0;
    ctx.fillText('INCOMING!', CANVAS_W / 2, CANVAS_H / 2 + 30);
    ctx.restore();
}

function renderGameOver() {
    renderParticles();

    ctx.save();
    ctx.textAlign = 'center';

    ctx.font      = 'bold 56px monospace';
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 20;
    ctx.fillText('GAME OVER', CANVAS_W / 2, 220);

    ctx.shadowBlur = 0;
    ctx.font      = '24px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`SCORE: ${score}`, CANVAS_W / 2, 300);

    if (score >= hiScore && score > 0) {
        ctx.font      = '20px monospace';
        ctx.fillStyle = '#ffcc44';
        ctx.fillText('NEW HIGH SCORE!', CANVAS_W / 2, 340);
    } else if (hiScore > 0) {
        ctx.font      = '18px monospace';
        ctx.fillStyle = '#ffcc44';
        ctx.fillText(`BEST: ${hiScore}`, CANVAS_W / 2, 340);
    }

    ctx.font      = '18px monospace';
    ctx.fillStyle = '#aaaaaa';
    if (gameOverLockout <= 0) {
        const blink = Math.floor(Date.now() / 500) % 2 === 0;
        if (blink) ctx.fillText('PRESS SPACE TO PLAY AGAIN', CANVAS_W / 2, 420);
    }

    ctx.restore();
}

// ── Game Loop ────────────────────────────────────────────────────────────────

let lastTime = 0;

function gameLoop(timestamp) {
    const raw   = timestamp - lastTime;
    lastTime    = timestamp;
    const delta = Math.min(raw, 50); // cap at 50ms
    const dt    = delta / 1000;

    update(dt);
    render();
    requestAnimationFrame(gameLoop);
}

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
    hiScore = parseInt(localStorage.getItem('spaceRocksHiScore') || '0', 10);
    resizeCanvas();
    state   = 'menu';
    score   = 0;
    lives   = 3;
    level   = 1;
    bombs   = 0;
    bullets = [];
    debris  = [];
    enemies = [];
    powerups = [];
    floatingTexts = [];
    particleExplosions = [];
    screenFlash  = 0;
    notification = null;
    resetWeapon();
    requestAnimationFrame(gameLoop);
}

init();
