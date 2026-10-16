/* QuizVideo v0.1. Renders quiz videos and carousel slides entirely in the browser.
   Nothing is uploaded: rendering, encoding, and packaging all happen on this device. */

const W = 1080, H = 1920, FPS = 30;
const INLINE = window.QV_INLINE || null;          // set by the single-file preview build
const VERSION = '0.1.0';

/* ------------------------------------------------------------------ utils */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
const prog = (t, start, dur) => clamp((t - start) / dur, 0, 1);
function rng(seed) {
  let s = seed >>> 0;
  return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const newSeed = () => (Math.random() * 2 ** 31) | 0;
function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; }

/* ------------------------------------------------------------------ data */
const DATA = { countries: [], byIso: {}, outlines: {}, paths: {}, flags: {} };
async function loadData() {
  let countries, outlines;
  let flags;
  if (INLINE) { countries = INLINE.countries; outlines = INLINE.outlines; flags = INLINE.flags; }
  else {
    [countries, outlines, flags] = await Promise.all([
      fetch('/countries.json').then(r => r.json()),
      fetch('/outlines.json').then(r => r.json()),
      fetch('/flags.json').then(r => r.json()),
    ]);
  }
  DATA.flags = flags || {};
  DATA.countries = countries;
  DATA.outlines = outlines;
  countries.forEach(c => { DATA.byIso[c.iso] = c; });
}
function outlinePath(iso) {
  if (!DATA.paths[iso] && DATA.outlines[iso]) DATA.paths[iso] = new Path2D(DATA.outlines[iso].d);
  return DATA.paths[iso];
}
function flagURL(iso) {
  iso = iso.toLowerCase();
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DATA.flags[iso] || '');
}
const IMG = new Map();     // iso -> HTMLImageElement (loaded)
const IMG_P = new Map();   // iso -> Promise
function loadFlag(iso) {
  if (IMG_P.has(iso)) return IMG_P.get(iso);
  const p = new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG.set(iso, im); res(im); };
    im.onerror = () => res(null);
    im.src = flagURL(iso);
  });
  IMG_P.set(iso, p);
  return p;
}

/* ------------------------------------------------------------------ formats + question generation */
const FORMATS = {
  country: { label: 'Guess the Country', short: 'Country', title: 'GUESS THE COUNTRY', sub: 'BY ITS SHAPE' },
  flag: { label: 'Guess the Flag', short: 'Flag', title: 'GUESS THE FLAG', sub: '' },
  capital: { label: 'Guess the Capital', short: 'Capital', title: 'GUESS THE CAPITAL', sub: '' },
  wyr: { label: 'Would You Rather', short: 'Would You Rather', title: 'WOULD YOU RATHER', sub: '' },
  trivia: { label: 'Trivia', short: 'Trivia', title: 'TRIVIA TIME', sub: '' },
};
const TIERS = ['easy', 'medium', 'hard', 'extreme'];
const TIER_LABEL = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD', extreme: 'EXTREME' };
const REGIONS = ['World', 'Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'];

function eligible(fmt, c) {
  if (fmt === 'country') return !!c.outline;
  if (fmt === 'capital') return !!c.capital;
  return true;
}
function rampCounts(n) {
  // spread n questions across tiers, easy first, ending on extreme
  const w = [0.3, 0.3, 0.22, 0.18];
  const out = w.map(x => Math.floor(x * n));
  let left = n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % 4) { out[i]++; left--; }
  return out;
}
function genGeo(fmt, opts) {
  const rnd = rng(opts.seed);
  let pool = DATA.countries.filter(c => eligible(fmt, c) && (opts.region === 'World' || c.region === opts.region));
  if (pool.length < 4) pool = DATA.countries.filter(c => eligible(fmt, c));
  const byTier = {}; TIERS.forEach(t => { byTier[t] = shuffled(pool.filter(c => c.tier === t), rnd); });
  let picks = [];
  if (opts.difficulty === 'ramp') {
    const counts = rampCounts(opts.count);
    TIERS.forEach((t, i) => {
      let take = byTier[t].splice(0, counts[i]);
      // borrow from the nearest tier when a region runs short
      for (let k = 1; take.length < counts[i] && k < 4; k++) {
        for (const nb of [TIERS[i - k], TIERS[i + k]]) {
          if (nb && take.length < counts[i]) take = take.concat(byTier[nb].splice(0, counts[i] - take.length));
        }
      }
      picks = picks.concat(take.map(c => ({ c, tier: t })));
    });
  } else {
    const order = [opts.difficulty, ...TIERS.filter(t => t !== opts.difficulty)];
    for (const t of order) for (const c of byTier[t]) if (picks.length < opts.count) picks.push({ c, tier: opts.difficulty });
  }
  picks = picks.slice(0, opts.count);
  return picks.map(({ c, tier }, i) => makeGeoItem(fmt, c, tier, opts.mode, rng(opts.seed + i * 7919)));
}
function makeGeoItem(fmt, c, tier, mode, rnd) {
  const item = { kind: fmt, iso: c.iso, tier, answer: fmt === 'capital' ? c.capital : c.name, note: fmt === 'capital' ? (c.capitalNote || '') : '' };
  if (mode === 'choice') {
    let wrong = [];
    if (fmt === 'capital') {
      wrong = (c.cities || []).slice(0, 3);
      const banned = new Set([c.capital, ...(c.capitalAlt || [])]);
      if (wrong.length < 3) {
        const near = shuffled(DATA.countries.filter(x => x.iso !== c.iso && x.capital && x.subregion === c.subregion), rnd);
        for (const x of near.concat(shuffled(DATA.countries.filter(x => x.capital && x.iso !== c.iso), rnd))) {
          if (wrong.length >= 3) break;
          if (!banned.has(x.capital) && !wrong.includes(x.capital)) wrong.push(x.capital);
        }
      }
    } else {
      const same = shuffled(DATA.countries.filter(x => x.iso !== c.iso && eligible(fmt, x) && x.subregion === c.subregion), rnd);
      const region = shuffled(DATA.countries.filter(x => x.iso !== c.iso && eligible(fmt, x) && x.region === c.region), rnd);
      const any = shuffled(DATA.countries.filter(x => x.iso !== c.iso && eligible(fmt, x)), rnd);
      for (const x of same.concat(region, any)) { if (wrong.length >= 3) break; if (!wrong.includes(x.name)) wrong.push(x.name); }
    }
    item.options = shuffled([{ label: item.answer, correct: true }, ...wrong.map(w => ({ label: w, correct: false }))], rnd);
  }
  return item;
}
const SAMPLE_WYR = `Be able to fly | Be able to read minds
Live without music | Live without movies
Always be 10 minutes late | Always be 20 minutes early
Have free flights for life | Have free food for life
Explore space | Explore the deep ocean
Speak every language | Play every instrument
Never use social media again | Never watch TV again
Live in the mountains | Live by the beach`;
const SAMPLE_TRIVIA = `What is the largest planet in our solar system? | Jupiter | Saturn | Neptune | Earth
How many continents are there? | 7 | 5 | 6 | 8
Which ocean is the largest? | Pacific | Atlantic | Indian | Arctic
The Great Wall of China is visible from the Moon with the naked eye. | False
What is the hardest natural substance? | Diamond | Quartz | Iron | Granite
Which country has the most people? | India | China | United States | Indonesia`;
function parseWyr(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const p = l.split('|').map(s => s.trim());
    const it = { kind: 'wyr', a: p[0] || '', b: p[1] || '' };
    const pa = parseFloat(p[2]), pb = parseFloat(p[3]);
    if (isFinite(pa) && isFinite(pb) && pa + pb > 0) { it.pa = Math.round(100 * pa / (pa + pb)); it.pb = 100 - it.pa; }
    return it;
  }).filter(it => it.a && it.b).slice(0, 20);
}
function parseTrivia(text, seed) {
  const rnd = rng(seed);
  return text.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
    const p = l.split('|').map(s => s.trim()).filter(s => s.length);
    if (p.length === 2 && /^(true|false)$/i.test(p[1])) {
      const ans = /^true$/i.test(p[1]);
      return { kind: 'trivia', q: p[0], tf: true, answer: ans ? 'TRUE' : 'FALSE', options: [{ label: 'TRUE', correct: ans }, { label: 'FALSE', correct: !ans }] };
    }
    if (p.length >= 3) {
      const r = rng(seed + i * 131);
      return { kind: 'trivia', q: p[0], answer: p[1], options: shuffled([{ label: p[1], correct: true }, ...p.slice(2, 5).map(w => ({ label: w, correct: false }))], r) };
    }
    if (p.length === 2) return { kind: 'trivia', q: p[0], answer: p[1] };
    return null;
  }).filter(Boolean).slice(0, 20);
}

/* ------------------------------------------------------------------ themes ("looks") */
const THEMES = [
  { id: 'midnight', name: 'Midnight', bg: ['radial', '#22348A', '#0A0F2A'], pattern: 'rays', ink: '#FFFFFF', soft: 'rgba(255,255,255,.72)', accent: '#FFC21A', accentInk: '#1E1600', card: 'rgba(255,255,255,.09)', shape: '#FFFFFF', a: '#E5484D', b: '#3B82F6', display: 'Anton', text: 'Montserrat' },
  { id: 'sunset', stroke: 'rgba(255,255,255,.55)', name: 'Sunset', bg: ['linear', '#FF5F6D', '#FFC371'], pattern: 'dots', ink: '#1F0B2E', soft: 'rgba(31,11,46,.72)', accent: '#1F0B2E', accentInk: '#FFFFFF', card: 'rgba(255,255,255,.32)', shape: '#1F0B2E', a: '#1F0B2E', b: '#FFFFFF', display: 'Luckiest Guy', text: 'Montserrat' },
  { id: 'ocean', name: 'Ocean', bg: ['linear', '#0B5F73', '#13A3B9'], pattern: 'waves', ink: '#FFFFFF', soft: 'rgba(255,255,255,.78)', accent: '#FFE066', accentInk: '#1D1A00', card: 'rgba(255,255,255,.14)', shape: '#FFFFFF', a: '#FF6B6B', b: '#0B3D91', display: 'Montserrat', text: 'Montserrat' },
  { id: 'chalk', name: 'Chalkboard', bg: ['solid', '#1E3A2F'], pattern: 'grid', ink: '#F4F0E4', soft: 'rgba(244,240,228,.75)', accent: '#FFD166', accentInk: '#1E1600', card: 'rgba(244,240,228,.08)', shape: '#F4F0E4', a: '#EF8354', b: '#4F8FBF', display: 'Bricolage Grotesque', text: 'Bricolage Grotesque' },
  { id: 'grape', name: 'Grape', bg: ['radial', '#8B3DFF', '#2A0866'], pattern: 'rays', ink: '#FFFFFF', soft: 'rgba(255,255,255,.75)', accent: '#00E5A0', accentInk: '#00241A', card: 'rgba(255,255,255,.12)', shape: '#FFFFFF', a: '#FF4D8D', b: '#00B3FF', display: 'Anton', text: 'Montserrat' },
  { id: 'paper', stroke: 'rgba(255,255,255,.55)', name: 'Paper', bg: ['solid', '#F4EFE3'], pattern: 'dots', ink: '#141414', soft: 'rgba(20,20,20,.68)', accent: '#E63946', accentInk: '#FFFFFF', card: 'rgba(20,20,20,.06)', shape: '#141414', a: '#E63946', b: '#1D3557', display: 'Bricolage Grotesque', text: 'Bricolage Grotesque' },
  { id: 'neon', name: 'Neon', bg: ['solid', '#090A12'], pattern: 'grid', ink: '#FFFFFF', soft: 'rgba(255,255,255,.7)', accent: '#2CF6B3', accentInk: '#00261A', card: 'rgba(255,255,255,.07)', shape: '#2CF6B3', a: '#FF3DA5', b: '#3D7BFF', display: 'Montserrat', text: 'Montserrat' },
  { id: 'candy', stroke: 'rgba(255,255,255,.55)', name: 'Candy', bg: ['linear', '#FF9A9E', '#FECFEF'], pattern: 'dots', ink: '#3A0F3D', soft: 'rgba(58,15,61,.72)', accent: '#3A0F3D', accentInk: '#FFFFFF', card: 'rgba(255,255,255,.4)', shape: '#3A0F3D', a: '#3A0F3D', b: '#C2185B', display: 'Luckiest Guy', text: 'Montserrat' },
];
const TIER_COLOR = { easy: '#22C55E', medium: '#FACC15', hard: '#F97316', extreme: '#EF4444' };
const CORRECT = '#22C55E';
function makeLook(themeId, seed) {
  const r = rng(seed);
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  return {
    ...theme,
    timer: r() < 0.5 ? 'ring' : 'bar',
    transition: ['wipe', 'zoom', 'slide'][Math.floor(r() * 3)],
    tilt: (r() - 0.5) * 6,          // degrees, per-video variety in the title tilt
    patternShift: r() * 1000,
  };
}

/* ------------------------------------------------------------------ text helpers */
function font(look, kind, size, weight) {
  const fam = kind === 'display' ? look.display : look.text;
  const w = weight || (fam === 'Montserrat' ? 900 : fam === 'Bricolage Grotesque' ? 800 : 400);
  return `${w} ${size}px "${fam}", "Arial Black", system-ui, sans-serif`;
}
function fitSize(ctx, text, maxW, size, min, fontFn) {
  let s = size;
  ctx.font = fontFn(s);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = fontFn(s); }
  return s;
}
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
function fitWrap(ctx, text, maxW, maxLines, size, min, fontFn) {
  let s = size, lines;
  for (;;) {
    ctx.font = fontFn(s);
    lines = wrapLines(ctx, text, maxW);
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if ((lines.length <= maxLines && widest <= maxW) || s <= min) break;
    s -= 2;
  }
  return { size: s, lines };
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

/* ------------------------------------------------------------------ drawing primitives */
function drawBackground(ctx, look, t) {
  const [type, c1, c2] = look.bg;
  if (type === 'radial') {
    const g = ctx.createRadialGradient(W / 2, H * 0.36, 60, W / 2, H * 0.5, H * 0.8);
    g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g;
  } else if (type === 'linear') {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g;
  } else ctx.fillStyle = c1;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  const p = look.pattern, drift = (t * 14 + look.patternShift) % 120;
  if (p === 'dots') {
    ctx.fillStyle = look.ink; ctx.globalAlpha = 0.07;
    for (let y = -120 + drift; y < H + 120; y += 60) for (let x = (Math.floor(y / 60) % 2) * 30; x < W; x += 60) { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
  } else if (p === 'grid') {
    ctx.strokeStyle = look.ink; ctx.globalAlpha = 0.06; ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = -90 + (drift % 90); y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (p === 'rays') {
    ctx.translate(W / 2, H * 0.36); ctx.rotate(t * 0.05 + look.patternShift);
    ctx.fillStyle = look.ink; ctx.globalAlpha = 0.045;
    for (let i = 0; i < 16; i++) { ctx.rotate(Math.PI / 8); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -H); ctx.lineTo(90, -H); ctx.closePath(); ctx.fill(); }
  } else if (p === 'waves') {
    ctx.strokeStyle = look.ink; ctx.globalAlpha = 0.08; ctx.lineWidth = 3;
    for (let y = 80; y < H; y += 110) { ctx.beginPath(); for (let x = 0; x <= W; x += 20) { const yy = y + Math.sin((x + drift * 3) / 70) * 14; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
  }
  ctx.restore();
}
function pill(ctx, look, text, cx, cy, opts = {}) {
  const size = opts.size || 34;
  ctx.font = font(look, 'text', size, 800); setSpacing(ctx, 2);
  const w = ctx.measureText(text).width + size * 1.3, h = size * 1.75;
  ctx.save();
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = opts.fill || look.card; ctx.fill();
  ctx.fillStyle = opts.ink || look.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 2);
  ctx.restore(); setSpacing(ctx, 0);
  return w;
}
function drawTitle(ctx, look, text, cy, size, appear) {
  const a = ease.outBack(appear);
  ctx.save();
  ctx.translate(W / 2, cy); ctx.rotate((look.tilt * Math.PI) / 180 * 0.3); ctx.scale(lerp(0.6, 1, a), lerp(0.6, 1, a));
  ctx.globalAlpha = clamp(appear * 2, 0, 1);
  const s = fitSize(ctx, text, 900, size, 40, z => font(look, 'display', z));
  ctx.font = font(look, 'display', s); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  setSpacing(ctx, look.display === 'Anton' ? 2 : 0);
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(8, s * 0.14); ctx.strokeStyle = look.stroke || 'rgba(0,0,0,.28)'; ctx.strokeText(text, 0, 6);
  ctx.fillStyle = look.ink; ctx.fillText(text, 0, 0);
  setSpacing(ctx, 0); ctx.restore();
}
function drawHeader(ctx, look, title, i, n, tier, appear) {
  drawTitle(ctx, look, title, 200, 92, appear);
  const y = 300, a = ease.outCubic(appear);
  ctx.save(); ctx.globalAlpha = a;
  if (tier) {
    pill(ctx, look, `LEVEL ${i + 1}`, W / 2, y, { size: 36 });
  } else {
    pill(ctx, look, `${i + 1} / ${n}`, W / 2, y, { size: 30 });
  }
  ctx.restore();
}
function drawTierBadge(ctx, look, tier, cx, cy, appear) {
  if (!tier) return;
  ctx.save(); ctx.globalAlpha = ease.outCubic(appear);
  pill(ctx, look, TIER_LABEL[tier], cx, cy, { size: 32, fill: TIER_COLOR[tier], ink: '#111' });
  ctx.restore();
}
function drawTimer(ctx, look, style, frac, secsLeft, cx, cy) {
  if (secsLeft > 60) return; // carousel slides: no timer
  const urgent = secsLeft <= 3 && frac > 0;
  const col = urgent ? '#EF4444' : look.accent;
  ctx.save();
  if (style === 'ring') {
    const r = 70;
    ctx.lineWidth = 16; ctx.strokeStyle = look.card; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    const pulse = urgent ? 1 + 0.08 * Math.sin(frac * 60) : 1;
    ctx.translate(cx, cy); ctx.scale(pulse, pulse);
    ctx.fillStyle = look.ink; ctx.font = font(look, 'display', 64); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.ceil(secsLeft))), 0, 4);
  } else {
    const w = 720, h = 26, x = cx - w / 2, y = cy - h / 2;
    roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = look.card; ctx.fill();
    if (frac > 0) { roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fillStyle = col; ctx.fill(); }
    ctx.fillStyle = look.ink; ctx.font = font(look, 'display', 56); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.ceil(secsLeft))), x + w + 26, cy + 3);
  }
  ctx.restore();
}
function drawOutline(ctx, look, iso, cx, cy, maxW, maxH, appear, reveal) {
  const o = DATA.outlines[iso]; const path = outlinePath(iso);
  if (!o || !path) return;
  const s = Math.min(maxW / o.w, maxH / o.h);
  const k = lerp(0.82, 1, ease.outBack(appear));
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s * k, s * k); ctx.translate(-o.w / 2, -o.h / 2);
  ctx.globalAlpha = clamp(appear * 2, 0, 1);
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 40 / s; ctx.shadowOffsetY = 14 / s;
  ctx.fillStyle = look.shape; ctx.fill(path, 'evenodd');
  ctx.shadowColor = 'transparent';
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.5 / s; ctx.strokeStyle = look.shape; ctx.stroke(path);
  if (reveal > 0) {
    const img = IMG.get(iso);
    if (img) {
      ctx.save(); ctx.clip(path, 'evenodd'); ctx.globalAlpha = ease.outCubic(reveal);
      const ar = 4 / 3, bw = o.w, bh = o.h; let dw = bw, dh = bw / ar; if (dh < bh) { dh = bh; dw = bh * ar; }
      ctx.drawImage(img, (bw - dw) / 2, (bh - dh) / 2, dw, dh); ctx.restore();
    }
    ctx.globalAlpha = ease.outCubic(reveal); ctx.lineWidth = 7 / s; ctx.strokeStyle = look.accent; ctx.stroke(path);
  }
  ctx.restore();
}
function drawFlagBox(ctx, look, iso, cx, cy, w, appear, opts = {}) {
  const img = IMG.get(iso); const h = w * 0.75;
  const k = lerp(0.8, 1, ease.outBack(appear));
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.globalAlpha = clamp(appear * 2, 0, 1);
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
  roundRect(ctx, -w / 2, -h / 2, w, h, opts.radius ?? 22); ctx.fillStyle = '#ddd'; ctx.fill();
  ctx.shadowColor = 'transparent';
  if (img) { ctx.save(); roundRect(ctx, -w / 2, -h / 2, w, h, opts.radius ?? 22); ctx.clip(); ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore(); }
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.18)'; roundRect(ctx, -w / 2, -h / 2, w, h, opts.radius ?? 22); ctx.stroke();
  ctx.restore();
}
function drawBigText(ctx, look, text, cx, cy, maxW, size, appear, color, kind = 'display') {
  if (!text) return;
  const a = ease.outBack(clamp(appear, 0, 1));
  ctx.save(); ctx.translate(cx, cy); ctx.scale(lerp(0.5, 1, a), lerp(0.5, 1, a)); ctx.globalAlpha = clamp(appear * 2, 0, 1);
  const s = fitSize(ctx, text, maxW, size, 34, z => font(look, kind, z));
  ctx.font = font(look, kind, s); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(8, s * 0.14); ctx.strokeStyle = look.stroke || 'rgba(0,0,0,.3)'; ctx.strokeText(text, 0, 5);
  ctx.fillStyle = color || look.ink; ctx.fillText(text, 0, 0);
  ctx.restore();
}
function drawWrapped(ctx, look, text, cx, cy, maxW, maxLines, size, min, color, kind = 'text', weight) {
  const fit = fitWrap(ctx, text, maxW, maxLines, size, min, z => font(look, kind, z, weight));
  ctx.font = font(look, kind, fit.size, weight); ctx.fillStyle = color || look.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lh = fit.size * 1.18, y0 = cy - ((fit.lines.length - 1) * lh) / 2;
  fit.lines.forEach((l, i) => ctx.fillText(l, cx, y0 + i * lh));
  return { height: fit.lines.length * lh, size: fit.size };
}
function drawOptions(ctx, look, options, layout, t0, t, revealP) {
  const n = options.length;
  options.forEach((o, i) => {
    const appear = prog(t, t0 + 0.25 + i * 0.08, 0.35);
    let x, y, w, h;
    if (layout === 'grid') { w = 460; h = 124; x = i % 2 === 0 ? W / 2 - 475 : W / 2 + 15; y = 1150 + Math.floor(i / 2) * 140; }
    else if (layout === 'tf') { w = 420; h = 170; x = i === 0 ? W / 2 - 440 : W / 2 + 20; y = 1150; }
    else { w = 880; h = 104; x = W / 2 - 440; y = 1050 + i * 118; }
    const dim = revealP > 0 && !o.correct;
    const win = revealP > 0 && o.correct;
    const k = lerp(0.85, 1, ease.outBack(appear)) * (win ? 1 + 0.06 * Math.sin(Math.min(revealP, 1) * Math.PI) : 1);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(k, k); ctx.globalAlpha = clamp(appear * 2, 0, 1) * (dim ? lerp(1, 0.35, revealP) : 1);
    roundRect(ctx, -w / 2, -h / 2, w, h, 26);
    ctx.fillStyle = win ? CORRECT : look.card; ctx.fill();
    if (!win) { ctx.lineWidth = 4; ctx.strokeStyle = look.soft; ctx.globalAlpha *= 0.9; ctx.stroke(); ctx.globalAlpha /= 0.9; }
    const letter = layout === 'tf' ? '' : String.fromCharCode(65 + i);
    const ink = win ? '#FFFFFF' : look.ink;
    if (letter) {
      ctx.fillStyle = win ? 'rgba(255,255,255,.25)' : look.accent; ctx.beginPath(); ctx.arc(-w / 2 + 56, 0, 32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = win ? '#FFFFFF' : look.accentInk; ctx.font = font(look, 'text', 34, 900); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, -w / 2 + 56, 2);
    }
    const tx = letter ? -w / 2 + 104 : 0, maxW = letter ? w - 130 : w - 40;
    const fit = fitWrap(ctx, o.label, maxW, 2, layout === 'tf' ? 64 : 42, 22, z => font(look, 'text', z, 800));
    ctx.font = font(look, 'text', fit.size, 800); ctx.fillStyle = ink; ctx.textAlign = letter ? 'left' : 'center'; ctx.textBaseline = 'middle';
    const lh = fit.size * 1.12, y0 = -((fit.lines.length - 1) * lh) / 2;
    fit.lines.forEach((l, j) => ctx.fillText(l, tx, y0 + j * lh + 2));
    ctx.restore();
  });
}
function drawWatermark(ctx, look) {
  ctx.save(); ctx.globalAlpha = 0.85;
  pill(ctx, look, 'made with quizvideo.app', W / 2, 1488, { size: 26 });
  ctx.restore();
}

/* ------------------------------------------------------------------ timeline */
const INTRO = 2.6, OUTRO = 3.6, TRANS = 0.36;
function buildTimeline(st) {
  const segs = []; let t = 0;
  segs.push({ type: 'intro', t0: 0, t1: INTRO }); t = INTRO;
  st.items.forEach((item, i) => {
    const t0 = t, tq = t + st.seconds, t1 = tq + st.reveal;
    segs.push({ type: 'q', i, item, t0, tq, t1 }); t = t1;
  });
  segs.push({ type: 'outro', t0: t, t1: t + OUTRO }); t += OUTRO;
  return { segs, duration: t };
}
function sfxEvents(tl, st) {
  const ev = [{ t: 0.05, k: 'whoosh' }, { t: 0.35, k: 'pop' }];
  for (const s of tl.segs) {
    if (s.type === 'q') {
      ev.push({ t: s.t0, k: 'whoosh' });
      for (let k = 1; k <= st.seconds; k++) ev.push({ t: s.t0 + k - 1 + 0.02, k: st.seconds - k + 1 <= 3 ? 'tickHi' : 'tick' });
      ev.push({ t: s.tq, k: 'ding' });
    } else if (s.type === 'outro') { ev.push({ t: s.t0, k: 'whoosh' }); ev.push({ t: s.t0 + 0.3, k: 'fanfare' }); }
  }
  return ev;
}

/* ------------------------------------------------------------------ scenes */
function titleFor(st) { return (st.title || FORMATS[st.format].title).toUpperCase(); }
function drawIntro(ctx, look, st, s, t) {
  const lt = t - s.t0;
  const f = FORMATS[st.format];
  const n = st.items.length;
  drawTitle(ctx, look, titleFor(st), 640, 150, prog(lt, 0.1, 0.5));
  if (f.sub && !st.title) drawBigText(ctx, look, f.sub, W / 2, 790, 860, 84, prog(lt, 0.35, 0.5), look.accent);
  const chips = st.format === 'wyr' ? [`${n} QUESTIONS`, 'PICK ONE'] : st.format === 'trivia' ? [`${n} QUESTIONS`, `${st.seconds} SECONDS EACH`]
    : st.difficulty === 'ramp' ? [`${n} LEVELS`, 'EASY TO EXTREME'] : [`${n} QUESTIONS`, TIER_LABEL[st.difficulty] || ''];
  const y = 960;
  ctx.save(); ctx.globalAlpha = ease.outCubic(prog(lt, 0.6, 0.4));
  pill(ctx, look, chips[0], W / 2, y, { size: 36, fill: look.accent, ink: look.accentInk });
  if (chips[1]) pill(ctx, look, chips[1], W / 2, y + 90, { size: 32 });
  ctx.restore();
  const p = prog(lt, 1.1, 0.4);
  ctx.save(); ctx.globalAlpha = ease.outCubic(p);
  drawWrapped(ctx, look, st.format === 'wyr' ? 'Comment your picks!' : 'Pause the video to answer!', W / 2, 1230, 820, 2, 46, 30, look.soft, 'text', 800);
  ctx.restore();
}
function drawQuestion(ctx, look, st, s, t) {
  const it = s.item, lt = t - s.t0, qlen = s.tq - s.t0;
  const left = Math.max(0, s.tq - t), frac = clamp(left / qlen, 0, 1);
  const revealP = prog(t, s.tq, 0.45);
  const appear = prog(lt, 0.05, 0.4);
  const choice = !!it.options;
  if (it.kind === 'wyr') return drawWyr(ctx, look, st, s, t);
  drawHeader(ctx, look, titleFor(st), s.i, st.items.length, it.tier, appear);
  if (it.tier) drawTierBadge(ctx, look, it.tier, W / 2, 384, prog(lt, 0.15, 0.4));
  const vy = choice ? 690 : 740;
  if (it.kind === 'country') drawOutline(ctx, look, it.iso, W / 2, vy, 820, choice ? 540 : 620, appear, revealP);
  else if (it.kind === 'flag') drawFlagBox(ctx, look, it.iso, W / 2, vy, 760, appear);
  else if (it.kind === 'capital') {
    drawFlagBox(ctx, look, it.iso, W / 2, choice ? 600 : 640, 420, appear, { radius: 16 });
    const c = DATA.byIso[it.iso];
    drawBigText(ctx, look, c.name.toUpperCase(), W / 2, choice ? 880 : 920, 900, 96, prog(lt, 0.2, 0.4));
  } else if (it.kind === 'trivia') {
    const a = ease.outCubic(appear);
    ctx.save(); ctx.globalAlpha = a;
    roundRect(ctx, 80, 430, W - 160, 520, 40); ctx.fillStyle = look.card; ctx.fill();
    drawWrapped(ctx, look, it.q, W / 2, 690, W - 240, 6, 64, 34, look.ink, 'text', 800);
    ctx.restore();
  }
  // timer + answer
  if (choice) {
    if (look.timer === 'ring') drawTimer(ctx, look, 'ring', frac, left, W / 2, 1040 - (it.kind === 'trivia' ? 10 : 0));
    else drawTimer(ctx, look, 'bar', frac, left, W / 2 - 40, 1040);
    const layout = it.kind === 'trivia' ? (it.tf ? 'tf' : 'list') : 'grid';
    if (it.kind === 'trivia' && !it.tf) { /* list sits lower; timer above it */ }
    drawOptions(ctx, look, it.options, layout, s.t0, t, revealP);
  } else {
    if (revealP <= 0) {
      if (look.timer === 'ring') drawTimer(ctx, look, 'ring', frac, left, W / 2, 1180);
      else drawTimer(ctx, look, 'bar', frac, left, W / 2 - 40, 1180);
    } else {
      drawBigText(ctx, look, String(it.answer).toUpperCase(), W / 2, 1170, 900, it.kind === 'trivia' ? 96 : 120, revealP, look.accent);
      if (it.note) { ctx.save(); ctx.globalAlpha = ease.outCubic(prog(t, s.tq + 0.25, 0.4)); drawWrapped(ctx, look, it.note, W / 2, 1300, 860, 2, 36, 26, look.soft, 'text', 700); ctx.restore(); }
    }
  }
  if (choice && revealP > 0 && it.note) {
    ctx.save(); ctx.globalAlpha = ease.outCubic(prog(t, s.tq + 0.3, 0.4));
    drawWrapped(ctx, look, it.note, W / 2, 1440, 860, 1, 30, 22, look.soft, 'text', 700); ctx.restore();
  }
}
function drawWyr(ctx, look, st, s, t) {
  const it = s.item, lt = t - s.t0, qlen = s.tq - s.t0;
  const left = Math.max(0, s.tq - t), frac = clamp(left / qlen, 0, 1);
  const revealP = prog(t, s.tq, 0.5);
  const appear = prog(lt, 0.05, 0.45);
  const mid = 960, top = 380, bot = 1460;
  const slide = ease.outCubic(appear);
  // halves
  ctx.save();
  ctx.fillStyle = look.a; roundRect(ctx, 60 - (1 - slide) * W, top, W - 120, mid - top - 24, 44); ctx.fill();
  ctx.fillStyle = look.b; roundRect(ctx, 60 + (1 - slide) * W, mid + 24, W - 120, bot - mid - 24, 44); ctx.fill();
  ctx.restore();
  const ia = look.a === '#FFFFFF' ? '#111' : '#FFFFFF', ib = look.b === '#FFFFFF' ? '#111' : '#FFFFFF';
  ctx.save(); ctx.globalAlpha = clamp(appear * 1.6, 0, 1);
  ctx.fillStyle = ia; drawWrapped(ctx, look, it.a, W / 2, (top + mid - 24) / 2, W - 260, 4, 70, 36, ia, 'text', 900);
  drawWrapped(ctx, look, it.b, W / 2, (mid + 24 + bot) / 2, W - 260, 4, 70, 36, ib, 'text', 900);
  ctx.restore();
  // OR badge + timer ring
  const k = ease.outBack(prog(lt, 0.25, 0.4));
  ctx.save(); ctx.translate(W / 2, mid); ctx.scale(k, k);
  ctx.fillStyle = look.accent; ctx.beginPath(); ctx.arc(0, 0, 86, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(0, 0, 86, 0, Math.PI * 2); ctx.stroke();
  if (revealP <= 0) { ctx.strokeStyle = look.accentInk; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke(); }
  ctx.fillStyle = look.accentInk; ctx.font = font(look, 'display', 70); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('OR', 0, 5);
  ctx.restore();
  drawTitle(ctx, look, titleFor(st), 230, 92, appear);
  const askComment = revealP > 0 && it.pa == null;
  ctx.save(); ctx.globalAlpha = ease.outCubic(appear);
  if (askComment) pill(ctx, look, 'COMMENT YOUR PICK', W / 2, 318, { size: 32, fill: look.accent, ink: look.accentInk });
  else pill(ctx, look, `${s.i + 1} / ${st.items.length}`, W / 2, 316, { size: 30 });
  ctx.restore();
  if (revealP > 0) {
    if (it.pa != null) {
      const p = ease.outCubic(revealP);
      drawBigText(ctx, look, `${Math.round(it.pa * p)}%`, W / 2, top + 80, 400, 84, revealP, ia);
      drawBigText(ctx, look, `${Math.round(it.pb * p)}%`, W / 2, bot - 80, 400, 84, revealP, ib);
    }
  }
}
function scoreBands(n) {
  const a = Math.round(n * 0.3), b = Math.round(n * 0.7);
  const r = (lo, hi) => (lo >= hi ? `${hi}` : `${lo} to ${hi}`);
  return [`${r(0, a)}: KEEP TRYING`, `${r(a + 1, b)}: NOT BAD`, `${r(b + 1, n)}: GENIUS`];
}
function drawOutro(ctx, look, st, s, t) {
  const lt = t - s.t0, n = st.items.length;
  if (st.format === 'wyr') {
    drawTitle(ctx, look, 'WHICH DID YOU PICK?', 620, 120, prog(lt, 0.05, 0.5));
    ctx.save(); ctx.globalAlpha = ease.outCubic(prog(lt, 0.5, 0.4));
    pill(ctx, look, 'COMMENT YOUR ANSWERS', W / 2, 860, { size: 40, fill: look.accent, ink: look.accentInk });
    pill(ctx, look, 'FOLLOW FOR MORE', W / 2, 970, { size: 34 });
    ctx.restore();
    return;
  }
  drawTitle(ctx, look, 'HOW MANY', 520, 150, prog(lt, 0.05, 0.45));
  drawTitle(ctx, look, 'DID YOU GET?', 680, 150, prog(lt, 0.2, 0.45));
  scoreBands(n).forEach((b, i) => {
    ctx.save(); ctx.globalAlpha = ease.outCubic(prog(lt, 0.6 + i * 0.15, 0.35));
    pill(ctx, look, b, W / 2, 880 + i * 96, { size: 34, fill: i === 2 ? look.accent : look.card, ink: i === 2 ? look.accentInk : look.ink });
    ctx.restore();
  });
  ctx.save(); ctx.globalAlpha = ease.outCubic(prog(lt, 1.2, 0.4));
  drawWrapped(ctx, look, 'Comment your score below!', W / 2, 1240, 860, 1, 50, 30, look.ink, 'text', 900);
  drawWrapped(ctx, look, 'Follow for part 2', W / 2, 1320, 860, 1, 38, 26, look.soft, 'text', 800);
  ctx.restore();
}
function drawTransition(ctx, look, tl, t) {
  for (const s of tl.segs) {
    if (s.t0 === 0) continue;
    const p = (t - (s.t0 - TRANS / 2)) / TRANS;
    if (p <= 0 || p >= 1) continue;
    ctx.save();
    ctx.fillStyle = look.accent;
    if (look.transition === 'wipe') {
      const x = lerp(-W * 1.6, W * 1.6, ease.inOut(p));
      ctx.beginPath(); ctx.moveTo(x - 300, 0); ctx.lineTo(x + W + 300, 0); ctx.lineTo(x + W - 300, H); ctx.lineTo(x - 900, H); ctx.closePath(); ctx.fill();
    } else if (look.transition === 'zoom') {
      const r = Math.sin(p * Math.PI) * H * 0.75; ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.fill();
    } else {
      const y = lerp(H, -H, ease.inOut(p)); ctx.fillRect(0, y, W, H);
    }
    ctx.restore();
  }
}
function renderFrame(ctx, tl, t, st, look, opts = {}) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, look, t);
  let seg = tl.segs[tl.segs.length - 1];
  for (const s of tl.segs) if (t >= s.t0 && t < s.t1) { seg = s; break; }
  if (seg.type === 'intro') drawIntro(ctx, look, st, seg, t);
  else if (seg.type === 'q') drawQuestion(ctx, look, st, seg, t);
  else drawOutro(ctx, look, st, seg, t);
  if (!opts.noTransitions) drawTransition(ctx, look, tl, t);
  if (st.watermark) drawWatermark(ctx, look);
  ctx.restore();
}

/* ------------------------------------------------------------------ carousel slides */
function slidePlan(st) {
  const items = st.items;
  const slides = [{ kind: 'cover' }];
  items.forEach((it, i) => slides.push({ kind: 'q', i }));
  if (st.format !== 'wyr') for (let k = 0; k < items.length; k += 10) slides.push({ kind: 'answers', from: k, to: Math.min(items.length, k + 10) });
  slides.push({ kind: 'end' });
  return slides;
}
function renderSlide(ctx, st, look, sl) {
  const tl = buildTimeline(st);
  if (sl.kind === 'cover') return renderFrame(ctx, tl, 2.4, st, look, { noTransitions: true });
  if (sl.kind === 'end') return renderFrame(ctx, tl, tl.duration - 0.05, st, look, { noTransitions: true });
  if (sl.kind === 'q') {
    const s = tl.segs.find(x => x.type === 'q' && x.i === sl.i);
    const frozen = { ...st, seconds: st.seconds };
    // draw the question fully appeared, with the timer hidden: render at a time just after the intro animations
    ctx.save(); ctx.clearRect(0, 0, W, H); drawBackground(ctx, look, s.t0 + 1);
    const it = s.item;
    if (it.kind === 'wyr') drawWyr(ctx, look, frozen, { ...s, tq: Infinity }, s.t0 + 1.2);
    else {
      drawQuestion(ctx, look, frozen, { ...s, tq: s.t0 + 1e6 }, s.t0 + 1.2);
      // cover the timer area with a "swipe" hint for carousels
      ctx.save();
      const y = it.options ? 1040 : 1180;
      ctx.fillStyle = look.bg[0] === 'solid' ? look.bg[1] : 'rgba(0,0,0,0)';
      ctx.restore();
      ctx.save(); pill(ctx, look, 'SWIPE FOR THE ANSWERS', W / 2, y + (it.options ? 470 : 140), { size: 30 }); ctx.restore();
    }
    if (st.watermark) drawWatermark(ctx, look);
    ctx.restore();
    return;
  }
  if (sl.kind === 'answers') {
    ctx.save(); ctx.clearRect(0, 0, W, H); drawBackground(ctx, look, 3);
    drawTitle(ctx, look, 'ANSWERS', 210, 110, 1);
    const rows = items_slice(st.items, sl.from, sl.to);
    const top = 340, rowH = Math.min(108, Math.floor(1080 / rows.length));
    rows.forEach((it, j) => {
      const y = top + j * rowH + rowH / 2, i = sl.from + j;
      ctx.save();
      roundRect(ctx, 70, y - rowH / 2 + 8, W - 140, rowH - 16, 22); ctx.fillStyle = look.card; ctx.fill();
      ctx.fillStyle = look.accent; ctx.font = font(look, 'display', Math.min(56, rowH * 0.52)); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 104, y + 3);
      let x = 190;
      if (it.iso && (it.kind === 'flag' || it.kind === 'country' || it.kind === 'capital')) {
        const img = IMG.get(it.iso); const fh = Math.min(60, rowH * 0.56), fw = fh * 4 / 3;
        if (img) { ctx.save(); roundRect(ctx, x, y - fh / 2, fw, fh, 8); ctx.clip(); ctx.drawImage(img, x, y - fh / 2, fw, fh); ctx.restore(); }
        x += fw + 26;
      }
      const label = it.kind === 'capital' ? `${it.answer} (${DATA.byIso[it.iso].name})` : String(it.answer || '');
      const sz = fitSize(ctx, label, W - 70 - x - 30, Math.min(48, rowH * 0.42), 22, z => font(look, 'text', z, 800));
      ctx.font = font(look, 'text', sz, 800); ctx.fillStyle = look.ink; ctx.fillText(label, x, y + 2);
      ctx.restore();
    });
    drawWrapped(ctx, look, 'How many did you get? Comment below!', W / 2, 1440, 860, 1, 40, 26, look.soft, 'text', 800);
    if (st.watermark) drawWatermark(ctx, look);
    ctx.restore();
  }
}
function items_slice(items, a, b) { return items.slice(a, b); }

/* ------------------------------------------------------------------ sound (synthesized, nothing to license) */
async function renderSfx(tl, st, sampleRate = 48000) {
  const len = Math.ceil(tl.duration * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, sampleRate, sampleRate); const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const tone = (t, f, dur, type = 'sine', vol = 0.5, f2) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  const whoosh = (t) => {
    const src = ctx.createBufferSource(); src.buffer = noise; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t, Math.random() * 0.5, 0.4);
  };
  for (const e of sfxEvents(tl, st)) {
    const t = Math.max(0, e.t);
    if (e.k === 'tick') tone(t, 1100, 0.05, 'square', 0.12);
    else if (e.k === 'tickHi') tone(t, 1600, 0.06, 'square', 0.16);
    else if (e.k === 'ding') { tone(t, 880, 0.5, 'sine', 0.45); tone(t + 0.07, 1320, 0.6, 'sine', 0.35); tone(t + 0.14, 1760, 0.7, 'triangle', 0.2); }
    else if (e.k === 'whoosh') whoosh(t);
    else if (e.k === 'pop') tone(t, 300, 0.18, 'sine', 0.5, 900);
    else if (e.k === 'fanfare') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.11, f, 0.45 + i * 0.05, 'triangle', 0.3));
  }
  return ctx.startRendering();
}

/* ------------------------------------------------------------------ export: MP4 */
async function saveBlob(blob, filename) {
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename, data: blob }); return 'saved'; }
    } catch (e) { if (e && e.code === 'declined') return 'declined'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'saved';
}
async function exportVideo(st, look, onProgress, signal) {
  await prepareAssets(st);
  const MB = await import('mediabunny');
  const tl = buildTimeline(st);
  let codec = 'avc', fmt = 'mp4';
  if (!(await MB.canEncodeVideo('avc', { width: W, height: H }))) {
    if (await MB.canEncodeVideo('vp9', { width: W, height: H })) { codec = 'vp9'; fmt = 'webm'; }
    else throw new Error('This browser cannot encode video. Try Chrome, Edge, or Safari 16.4 or newer.');
  }
  let audioCodec = fmt === 'mp4' ? 'aac' : 'opus';
  let withAudio = st.sound;
  if (withAudio && !(await MB.canEncodeAudio(audioCodec))) {
    if (audioCodec === 'aac') {
      try { const aac = await import('@mediabunny/aac-encoder'); aac.registerAacEncoder(); } catch (e) { withAudio = false; }
    } else withAudio = false;
  }
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const output = new MB.Output({ format: fmt === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat(), target: new MB.BufferTarget() });
  const vsrc = new MB.CanvasSource(canvas, { codec, quality: MB.QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  let asrc = null;
  if (withAudio) { asrc = new MB.AudioBufferSource({ codec: audioCodec, quality: MB.QUALITY_HIGH }); output.addAudioTrack(asrc); }
  await output.start();
  const frames = Math.ceil(tl.duration * FPS);
  for (let f = 0; f < frames; f++) {
    if (signal && signal.aborted) { await output.cancel(); throw new DOMException('Export canceled', 'AbortError'); }
    const t = f / FPS;
    renderFrame(ctx, tl, t, st, look);
    await vsrc.add(t, 1 / FPS);
    if (f % 6 === 0) onProgress(f / frames * (withAudio ? 0.95 : 1));
  }
  vsrc.close();
  if (asrc) { const buf = await renderSfx(tl, st); await asrc.add(buf); asrc.close(); }
  await output.finalize();
  onProgress(1);
  const mime = fmt === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([output.target.buffer], { type: mime }), ext: fmt, withAudio, duration: tl.duration };
}

/* ------------------------------------------------------------------ export: slides (zip of PNGs) */
async function exportSlides(st, look, onProgress) {
  await prepareAssets(st);
  const { zipSync } = await import('fflate');
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const plan = slidePlan(st); const files = {}; const blobs = [];
  for (let i = 0; i < plan.length; i++) {
    renderSlide(ctx, st, look, plan[i]);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    blobs.push(blob);
    files[`slide-${String(i + 1).padStart(2, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
    onProgress((i + 1) / plan.length);
  }
  const zip = zipSync(files, { level: 0 });
  return { zip: new Blob([zip], { type: 'application/zip' }), pngs: blobs, count: plan.length };
}

/* ------------------------------------------------------------------ assets */
async function prepareAssets(st) {
  const isos = new Set();
  st.items.forEach(it => { if (it.iso) isos.add(it.iso); });
  await Promise.all([...isos].map(loadFlag));
}
async function loadFonts() {
  const specs = ['400 80px "Anton"', '400 80px "Luckiest Guy"', '900 80px "Montserrat"', '800 80px "Montserrat"', '700 80px "Montserrat"', '800 80px "Bricolage Grotesque"'];
  try { await Promise.all(specs.map(s => document.fonts.load(s, 'AÁÇÉÑÖÜßİŞ'))); } catch (e) { /* fall back to system fonts */ }
}

/* ------------------------------------------------------------------ app state + UI */
const state = {
  format: 'country', count: 10, difficulty: 'ramp', region: 'World', mode: 'reveal',
  seconds: 5, reveal: 2, title: '', themeId: 'midnight', lookSeed: newSeed(), seed: newSeed(),
  sound: true, watermark: true, wyrText: SAMPLE_WYR, triviaText: SAMPLE_TRIVIA, items: [],
};
let look = makeLook(state.themeId, state.lookSeed);
let timeline = buildTimeline(state);
const player = { playing: false, t: 1.6, last: 0, raf: 0, audio: null, audioCtx: null, audioSrc: null, audioDirty: true };

function regenerate(keepSeed) {
  if (!keepSeed) state.seed = newSeed();
  if (state.format === 'wyr') state.items = parseWyr(state.wyrText);
  else if (state.format === 'trivia') state.items = parseTrivia(state.triviaText, state.seed);
  else state.items = genGeo(state.format, { seed: state.seed, count: state.count, difficulty: state.difficulty, region: state.region, mode: state.mode });
  if (state.format === 'trivia' && state.items.some(it => !it.options)) state.items = state.items.map(it => it.options ? it : it);
  refresh();
}
function refresh() {
  timeline = buildTimeline(state);
  player.audioDirty = true;
  player.t = Math.min(player.t, timeline.duration - 0.01);
  prepareAssets(state).then(drawPreview);
  renderItemList();
  updateMeta();
  drawPreview();
}
function setLook() { look = makeLook(state.themeId, state.lookSeed); player.audioDirty = true; drawPreview(); }

const preview = { canvas: null, ctx: null };
function drawPreview() {
  if (!preview.ctx) return;
  const c = preview.canvas, k = c.width / W;
  preview.ctx.setTransform(k, 0, 0, k, 0, 0);
  renderFrame(preview.ctx, timeline, player.t, state, look);
  const scrub = $('#scrub'); if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round(player.t / timeline.duration * 1000));
  const tm = $('#time'); if (tm) tm.textContent = `${fmtTime(player.t)} / ${fmtTime(timeline.duration)}`;
}
function tick(now) {
  if (!player.playing) return;
  const dt = (now - player.last) / 1000; player.last = now;
  player.t += dt;
  if (player.t >= timeline.duration) { player.t = 0; restartAudio(); }
  drawPreview();
  player.raf = requestAnimationFrame(tick);
}
async function ensureAudio() {
  if (!state.sound) return null;
  if (!player.audioCtx) { try { player.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (player.audioDirty || !player.audio) { player.audio = await renderSfx(timeline, state, 44100); player.audioDirty = false; }
  return player.audio;
}
function stopAudio() { try { if (player.audioSrc) player.audioSrc.stop(); } catch (e) {} player.audioSrc = null; }
async function restartAudio() {
  stopAudio();
  if (!player.playing || !state.sound) return;
  const buf = await ensureAudio(); if (!buf || !player.playing) return;
  const src = player.audioCtx.createBufferSource(); src.buffer = buf; src.connect(player.audioCtx.destination);
  if (player.audioCtx.state === 'suspended') await player.audioCtx.resume();
  src.start(0, Math.min(player.t, buf.duration - 0.01)); player.audioSrc = src;
}
function play() { if (player.playing) return; player.playing = true; player.last = performance.now(); $('#play').setAttribute('aria-pressed', 'true'); $('#play').textContent = 'Pause'; restartAudio(); player.raf = requestAnimationFrame(tick); }
function pause() { player.playing = false; cancelAnimationFrame(player.raf); stopAudio(); $('#play').setAttribute('aria-pressed', 'false'); $('#play').textContent = 'Play'; }

function updateMeta() {
  const d = timeline.duration;
  const el = $('#meta');
  if (el) el.textContent = `${state.items.length} questions, ${Math.round(d)} seconds${d >= 60 ? ' (long enough for TikTok Creator Rewards)' : ''}`;
}
function renderItemList() {
  const list = $('#items'); if (!list) return;
  list.textContent = '';
  const geo = !['wyr', 'trivia'].includes(state.format);
  $('#geo-controls').hidden = !geo;
  $('#wyr-controls').hidden = state.format !== 'wyr';
  $('#trivia-controls').hidden = state.format !== 'trivia';
  if (!geo) return;
  state.items.forEach((it, i) => {
    const li = document.createElement('li');
    const c = DATA.byIso[it.iso];
    const img = document.createElement('img'); img.alt = ''; img.width = 28; img.height = 21; img.src = flagURL(it.iso);
    const name = document.createElement('span'); name.className = 'it-name'; name.textContent = state.format === 'capital' ? `${c.capital} (${c.name})` : c.name;
    const tier = document.createElement('span'); tier.className = 'tier tier-' + it.tier; tier.textContent = it.tier;
    const swap = document.createElement('button'); swap.type = 'button'; swap.className = 'mini'; swap.textContent = 'Swap'; swap.setAttribute('aria-label', `Swap ${c.name} for another country`);
    swap.addEventListener('click', () => swapItem(i));
    li.append(img, name, tier, swap); list.appendChild(li);
  });
}
function swapItem(i) {
  const it = state.items[i]; const used = new Set(state.items.map(x => x.iso));
  const pool = DATA.countries.filter(c => eligible(state.format, c) && c.tier === it.tier && !used.has(c.iso) && (state.region === 'World' || c.region === state.region));
  if (!pool.length) return;
  const c = pool[Math.floor(Math.random() * pool.length)];
  state.items[i] = makeGeoItem(state.format, c, it.tier, state.mode, rng(newSeed()));
  refresh();
}

function setStatus(msg, kind) { const el = $('#status'); el.textContent = msg; el.dataset.kind = kind || ''; }
let exporting = null;
async function onExportVideo() {
  if (exporting) { exporting.abort(); return; }
  pause();
  const btn = $('#export-video'); const bar = $('#progress');
  exporting = new AbortController(); btn.textContent = 'Cancel'; bar.hidden = false; bar.value = 0;
  setStatus('Rendering your video on this device...');
  const started = performance.now();
  try {
    const res = await exportVideo(state, look, p => { bar.value = p; }, exporting.signal);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const name = `quizvideo-${state.format}-${Date.now().toString(36)}.${res.ext}`;
    const outcome = await saveBlob(res.blob, name);
    setStatus(outcome === 'declined' ? 'Download canceled.' : `Done in ${secs}s: ${(res.blob.size / 1e6).toFixed(1)} MB ${res.ext.toUpperCase()}${res.withAudio ? '' : ' (no sound in this browser, add music in TikTok)'}.`, 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') setStatus('Export canceled.');
    else { console.error(e); setStatus('Export failed: ' + (e && e.message ? e.message : 'unknown error'), 'err'); }
  } finally { exporting = null; btn.textContent = 'Download video'; bar.hidden = true; }
}
async function onExportSlides() {
  pause();
  const bar = $('#progress'); bar.hidden = false; bar.value = 0; setStatus('Rendering slides...');
  try {
    const res = await exportSlides(state, look, p => { bar.value = p; });
    const files = res.pngs.map((b, i) => new File([b], `slide-${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' }));
    if (navigator.canShare && navigator.canShare({ files }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files, title: 'Quiz slides' }); setStatus(`Shared ${res.count} slides.`, 'ok'); return; } catch (e) { /* fall through to zip */ }
    }
    const outcome = await saveBlob(res.zip, `quizvideo-slides-${Date.now().toString(36)}.zip`);
    setStatus(outcome === 'declined' ? 'Download canceled.' : `Saved ${res.count} slides (1080x1920 PNG) in a zip. TikTok photo mode takes 4 to 35.`, 'ok');
  } catch (e) { console.error(e); setStatus('Slide export failed: ' + (e && e.message ? e.message : 'unknown error'), 'err'); }
  finally { bar.hidden = true; }
}

function bindUI() {
  preview.canvas = $('#preview'); preview.ctx = preview.canvas.getContext('2d');
  const sizeCanvas = () => {
    const r = preview.canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(270, Math.round(r.width * dpr)); if (preview.canvas.width !== w) { preview.canvas.width = w; preview.canvas.height = Math.round(w * H / W); }
    drawPreview();
  };
  new ResizeObserver(sizeCanvas).observe(preview.canvas);
  $$('[data-format]').forEach(b => b.addEventListener('click', () => {
    state.format = b.dataset.format; state.title = ''; $('#title').value = '';
    $$('[data-format]').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    $('#title').placeholder = FORMATS[state.format].title;
    player.t = 1.6; regenerate();
  }));
  $('#count').addEventListener('change', e => { state.count = +e.target.value; regenerate(); });
  $('#difficulty').addEventListener('change', e => { state.difficulty = e.target.value; regenerate(); });
  $('#region').addEventListener('change', e => { state.region = e.target.value; regenerate(); });
  $('#mode').addEventListener('change', e => { state.mode = e.target.value; regenerate(true); });
  $('#new-set').addEventListener('click', () => regenerate());
  $('#seconds').addEventListener('input', e => { state.seconds = +e.target.value; $('#seconds-out').textContent = `${state.seconds}s`; refresh(); });
  $('#title').addEventListener('input', e => { state.title = e.target.value.slice(0, 40); drawPreview(); });
  $('#wyr-text').value = state.wyrText; $('#trivia-text').value = state.triviaText;
  let deb; const later = fn => { clearTimeout(deb); deb = setTimeout(fn, 350); };
  $('#wyr-text').addEventListener('input', e => { state.wyrText = e.target.value; later(() => regenerate(true)); });
  $('#trivia-text').addEventListener('input', e => { state.triviaText = e.target.value; later(() => regenerate(true)); });
  const themes = $('#themes');
  THEMES.forEach(th => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', th.id === state.themeId ? 'true' : 'false'); b.setAttribute('aria-label', th.name); b.title = th.name;
    const [type, c1, c2] = th.bg; b.style.background = type === 'solid' ? c1 : `linear-gradient(160deg, ${c1}, ${c2 || c1})`;
    const dot = document.createElement('span'); dot.style.background = th.accent; b.appendChild(dot);
    b.addEventListener('click', () => { state.themeId = th.id; $$('.swatch').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false')); setLook(); });
    themes.appendChild(b);
  });
  $('#shuffle-style').addEventListener('click', () => {
    const th = THEMES[Math.floor(Math.random() * THEMES.length)]; state.themeId = th.id; state.lookSeed = newSeed();
    $$('.swatch').forEach(x => x.setAttribute('aria-checked', x.getAttribute('aria-label') === th.name ? 'true' : 'false')); setLook();
  });
  $('#sound').addEventListener('change', e => { state.sound = e.target.checked; if (!state.sound) stopAudio(); else if (player.playing) restartAudio(); });
  $('#play').addEventListener('click', () => (player.playing ? pause() : play()));
  $('#scrub').addEventListener('input', e => { player.t = (+e.target.value / 1000) * timeline.duration; drawPreview(); if (player.playing) restartAudio(); });
  $('#export-video').addEventListener('click', onExportVideo);
  $('#export-slides').addEventListener('click', onExportSlides);
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); player.playing ? pause() : play(); } });
}

function applyPreset() {
  const q = new URLSearchParams(location.search);
  const p = Object.assign({}, window.QV_PRESET || {});
  ['format', 'mode', 'difficulty', 'region'].forEach(k => { if (q.get(k)) p[k] = q.get(k); });
  if (p.format && FORMATS[p.format]) state.format = p.format;
  if (p.mode === 'choice' || p.mode === 'reveal') state.mode = p.mode;
  if (p.difficulty === 'ramp' || TIERS.includes(p.difficulty)) state.difficulty = p.difficulty;
  if (REGIONS.includes(p.region)) state.region = p.region;
  $$('[data-format]').forEach(x => x.setAttribute('aria-checked', x.dataset.format === state.format ? 'true' : 'false'));
  $('#mode').value = state.mode; $('#difficulty').value = state.difficulty; $('#region').value = state.region;
  $('#title').placeholder = FORMATS[state.format].title;
}
/* ------------------------------------------------------------------ Pro (license keys checked with Polar) */
const CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_yu9iZnBG5k6kThYf0rdj0xjXujoTaq2DApM3X0rv9dl';
const POLAR_ORG = '042c4856-6ce6-47f7-8480-26cb886ec391';
const LIC_KEY = 'qv-license';
function readLicense() { try { const v = JSON.parse(localStorage.getItem(LIC_KEY) || 'null'); return v && typeof v.key === 'string' ? v : null; } catch (e) { return null; } }
function writeLicense(v) { try { if (v) localStorage.setItem(LIC_KEY, JSON.stringify(v)); else localStorage.removeItem(LIC_KEY); } catch (e) {} }
async function validateLicense(key) {
  const r = await fetch('https://api.polar.sh/v1/customer-portal/license-keys/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, organization_id: POLAR_ORG }) });
  if (r.status === 404 || r.status === 422) return { ok: false, reason: 'That key was not found. Check it against your receipt email.' };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const ok = d.status === 'granted' && (!d.expires_at || new Date(d.expires_at) > new Date());
  return { ok, reason: ok ? '' : 'This key is no longer active. If your subscription ended, you can renew from your receipt email.' };
}
function setPro(on) { state.pro = !!on; state.watermark = !state.pro; renderPro(); drawPreview(); }
function renderPro() {
  const box = document.querySelector('.group.pro'); if (!box) return;
  const lic = readLicense();
  box.textContent = '';
  const h = document.createElement('h2'); h.textContent = 'Pro';
  if (state.pro) {
    const s = document.createElement('span'); s.className = 'soon'; s.textContent = 'active'; h.appendChild(s); box.appendChild(h);
    const lab = document.createElement('label'); lab.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'wm'; cb.checked = state.watermark;
    cb.addEventListener('change', () => { state.watermark = cb.checked; drawPreview(); });
    lab.append(cb, document.createTextNode(' Show the quizvideo.app mark')); box.appendChild(lab);
    const p = document.createElement('p'); p.className = 'fine'; p.textContent = 'License ending in ' + (lic ? lic.key.slice(-4) : '????') + '. ';
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'mini'; rm.textContent = 'Remove from this device';
    rm.addEventListener('click', () => { writeLicense(null); setPro(false); });
    p.appendChild(rm); box.appendChild(p);
    return;
  }
  box.appendChild(h);
  const p1 = document.createElement('p'); p1.textContent = 'Remove the made with quizvideo.app mark from every video and slide. Batch mode and a brand kit are coming soon, and Pro includes them when they ship.'; box.appendChild(p1);
  const p2 = document.createElement('p'); p2.className = 'price'; p2.textContent = '$9 a month, $59 a year, or $49 once (launch deal for the first 100 buyers).'; box.appendChild(p2);
  const a = document.createElement('a'); a.className = 'btn primary'; a.href = CHECKOUT_URL; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Get Pro'; box.appendChild(a);
  const det = document.createElement('details'); det.className = 'lic';
  const sum = document.createElement('summary'); sum.textContent = 'I have a license key'; det.appendChild(sum);
  const row = document.createElement('div'); row.className = 'lic-row';
  const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'lic-key'; inp.placeholder = 'QV-...'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('aria-label', 'License key');
  const go = document.createElement('button'); go.type = 'button'; go.className = 'btn'; go.textContent = 'Unlock';
  const st = document.createElement('p'); st.className = 'lic-status'; st.setAttribute('role', 'status');
  go.addEventListener('click', async () => {
    const key = inp.value.trim(); if (!key) { st.textContent = 'Paste your license key first.'; return; }
    go.disabled = true; st.textContent = 'Checking your key...';
    try { const res = await validateLicense(key); if (res.ok) { writeLicense({ key, ok: true, at: Date.now() }); setPro(true); } else { st.textContent = res.reason; } }
    catch (e) { st.textContent = 'Could not reach the license server. Check your connection and try again.'; }
    finally { go.disabled = false; }
  });
  row.append(inp, go); det.append(row, st); box.appendChild(det);
  const fine = document.createElement('p'); fine.className = 'fine'; fine.textContent = '14-day refunds, no questions asked. Payments are handled by Polar.'; box.appendChild(fine);
  if (new URLSearchParams(location.search).get('pro') === 'thanks') { det.open = true; st.textContent = 'Thanks for buying Pro! Your license key is in your receipt email. Paste it here to unlock.'; setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400); }
}
async function initPro() {
  const lic = readLicense();
  if (lic && lic.ok && Date.now() - (lic.at || 0) < 14 * 864e5) { state.pro = true; state.watermark = false; }
  renderPro();
  if (lic) {
    try { const res = await validateLicense(lic.key); if (res.ok) { writeLicense({ key: lic.key, ok: true, at: Date.now() }); if (!state.pro) setPro(true); } else { writeLicense(null); if (state.pro) setPro(false); } }
    catch (e) { /* offline: keep the cached result until it is 14 days old */ }
  }
}

async function main() {
  try {
    await Promise.all([loadData(), loadFonts()]);
    bindUI();
    applyPreset();
    initPro();
    regenerate(true);
    setStatus('Ready. Everything renders on this device; nothing is uploaded.');
  } catch (e) {
    console.error(e); const el = $('#status'); if (el) { el.textContent = 'Could not load the app data. Reload the page to try again.'; el.dataset.kind = 'err'; }
  }
}
window.QV = { state, get timeline() { return timeline; }, get look() { return look; }, renderFrame, renderSlide, slidePlan, buildTimeline, exportVideo, exportSlides, prepareAssets, DATA, VERSION, W, H };
main();
