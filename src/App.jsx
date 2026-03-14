import { useState, useRef, useCallback, useEffect } from 'react';
import { useTagData } from './TagDataContext';
import { stores, quests, badges, leaderboard, initialQuestProgress } from './mockDb';
import LeafletMap from './LeafletMap';

/* ─── Tag label map ─── */
const TAG_LABELS = {
  bakery: 'Bakery', veggie: 'Veggie', dairy: 'Dairy', hot_meal: 'Hot Meal',
  drinks: 'Drinks', pastry: 'Pastry', savory: 'Savory', organic: 'Organic',
};
const TAG_EMOJI = {
  bakery: '🥐', veggie: '🥗', hot_meal: '🍱', pastry: '🍰',
  dairy: '🧀', savory: '🥙', organic: '🌿', drinks: '☕',
};
const TAG_KEYS = Object.keys(TAG_LABELS);

/* ─── Colors ─── */
const TEAL = '#5BAD92';
const DARK_TEAL = '#1A3C34';
const ORANGE = '#F59316';
const INACTIVE = '#9CA3AF';
const BG = '#F5F3EE';

/* ─── Current time in minutes for urgency logic ─── */
function getNowMins() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
const SYS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/* ─── Helpers ─── */
function haptic(ms = 10) { try { navigator.vibrate?.(ms); } catch {} }
function parseMins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function isEndingSoon(store) {
  const diff = parseMins(store.collectTimeEnd) - getNowMins();
  return diff > 0 && diff <= 60;
}

function getTopTags(data, max = 3) {
  const entries = Object.entries(data || {});
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return [];
  return entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([k, v]) => ({ key: k, label: TAG_LABELS[k] || k, pct: Math.round((v / total) * 100) }));
}

function getAllTags(data) {
  const total = Object.values(data || {}).reduce((s, v) => s + v, 0);
  if (!total) return [];
  return Object.entries(data || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: TAG_LABELS[k] || k, pct: Math.round((v / total) * 100) }));
}

function matchesFilter(store, filter, tagData, bagCounts, nowMins) {
  if (filter === 'All') return true;
  if (filter === 'Available Now') {
    const bags = bagCounts?.[store.id] ?? store.bags;
    const startMins = parseMins(store.collectTimeStart);
    const endMins = parseMins(store.collectTimeEnd);
    return bags > 0 && nowMins >= startMins && nowMins <= endMins;
  }
  const fk = filter.toLowerCase().replace(' ', '_');
  return (tagData[store.id]?.[fk] || 0) > 0 || store.category.toLowerCase().includes(filter.toLowerCase());
}

function matchesSearch(store, q) {
  if (!q) return true;
  const lq = q.toLowerCase();
  return store.name.toLowerCase().includes(lq) || store.category.toLowerCase().includes(lq);
}

/* ─── CO₂ by category (FIX 7) ─── */
const CO2_BY_CATEGORY = {
  supermarket: { co2: 1.2, km: 4.5 },
  bakery: { co2: 0.8, km: 3 },
  confiserie: { co2: 0.8, km: 3 },
  chocolaterie: { co2: 0.8, km: 3 },
  restaurant: { co2: 1.5, km: 5.6 },
  coffee: { co2: 0.4, km: 1.5 },
  deli: { co2: 1.0, km: 3.8 },
  fine: { co2: 1.0, km: 3.8 },
  asian: { co2: 1.3, km: 4.8 },
  vegetarian: { co2: 1.4, km: 5.2 },
};
function getCo2ForStore(store) {
  const cat = (store.category || '').toLowerCase();
  for (const [key, val] of Object.entries(CO2_BY_CATEGORY)) {
    if (cat.includes(key)) return val;
  }
  return { co2: 0.8, km: 3 };
}

const LEVEL_NAMES = ['Eco Novice', 'Food Rescuer', 'Eco Hero', 'Eco Champion', 'Planet Saver'];

/* ─── Tier System ─── */
const TIERS = [
  { id: 'seedling', name: 'Seedling', emoji: '🌱', minPts: 0, color: '#9CA3AF', bonusPct: 0, perk: 'Base tier' },
  { id: 'sprout', name: 'Sprout', emoji: '🌿', minPts: 500, color: '#22C55E', bonusPct: 5, perk: '+5% bonus points on every save' },
  { id: 'tree', name: 'Tree', emoji: '🌳', minPts: 1500, color: '#16A34A', bonusPct: 10, perk: '+10% bonus pts + early access' },
  { id: 'forest', name: 'Forest', emoji: '🌍', minPts: 3000, color: '#047857', bonusPct: 15, perk: '+15% bonus + exclusive deals' },
];
function getTier(lifetimePts) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (lifetimePts >= TIERS[i].minPts) return { ...TIERS[i], index: i };
  }
  return { ...TIERS[0], index: 0 };
}
function getNextTier(lifetimePts) {
  const cur = getTier(lifetimePts);
  if (cur.index >= TIERS.length - 1) return null;
  return TIERS[cur.index + 1];
}

/* ─── Rewards Catalog ─── */
const REWARDS = [
  { id: 'r1', emoji: '🏷️', name: 'CHF 1 Off', description: 'Get CHF 1 off your next surprise bag', cost: 200, category: 'discount' },
  { id: 'r2', emoji: '💰', name: 'CHF 3 Off', description: 'Get CHF 3 off your next surprise bag', cost: 500, category: 'discount' },
  { id: 'r3', emoji: '🎁', name: 'Free Bag', description: 'Redeem a free surprise bag at any store', cost: 1000, category: 'discount' },
  { id: 'r4', emoji: '⚡', name: 'Priority Access', description: 'Get notified 30 min before others for 24h', cost: 400, category: 'perk' },
  { id: 'r5', emoji: '🍽️', name: 'Donate a Meal', description: 'We donate a meal to a local food bank', cost: 300, category: 'impact' },
  { id: 'r6', emoji: '✨', name: '2× Points Weekend', description: 'Earn double points all weekend long', cost: 600, category: 'perk' },
];
function getLevelName(level) {
  return LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)];
}

function formatTimeLeft(collectTimeEnd, nowMins) {
  const diff = parseMins(collectTimeEnd) - nowMins;
  if (diff <= 0) return 'Closed';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function getTimeColor(collectTimeEnd, nowMins) {
  const diff = parseMins(collectTimeEnd) - nowMins;
  if (diff <= 0) return { color: '#9CA3AF', weight: 400, pulse: false };
  if (diff <= 30) return { color: '#EF4444', weight: 700, pulse: true };
  if (diff <= 60) return { color: '#F97316', weight: 600, pulse: false };
  return { color: '#9CA3AF', weight: 400, pulse: false };
}

function getWeeklyReset() {
  const now = new Date();
  const daysUntilMon = ((8 - now.getDay()) % 7) || 7;
  const reset = new Date(now);
  reset.setDate(now.getDate() + daysUntilMon);
  reset.setHours(0, 0, 0, 0);
  const diff = Math.max(0, Math.floor((reset - now) / 1000));
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function randomTimeAgo() {
  const mins = Math.floor(Math.random() * 55) + 2;
  return mins < 60 ? `${mins} min ago` : '1h ago';
}
const CLASSMATE_FEED_BASE = [
  { id: 'cf1', name: 'Lukas G.', avatar: '🧑', color: '#DBEAFE', store: 'Barista Specialty Coffee', pts: 15 },
  { id: 'cf2', name: 'Nina T.', avatar: '👩', color: '#FCE7F3', store: 'Confiserie Roggwiller', pts: 15 },
  { id: 'cf3', name: 'Mateo O.', avatar: '🧔', color: '#D1FAE5', store: 'Migros Marktplatz', pts: 15 },
  { id: 'cf4', name: 'Ainhoa E.', avatar: '👱', color: '#FEF3C7', store: 'Esswerk', pts: 15 },
];
const CLASSMATE_FEED = CLASSMATE_FEED_BASE.map(c => ({ ...c, time: randomTimeAgo() }));

/* ─── Confetti ─── */
function fireConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const colors = [TEAL, '#FF6B35', '#FFD700', '#E91E63', '#00BCD4', '#8BC34A'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * W, y: Math.random() * -H,
    w: 6 + Math.random() * 6, h: 6 + Math.random() * 6,
    vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2, rv: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  let id;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.rot += p.rv;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    id = requestAnimationFrame(draw);
  };
  draw();
  const t = setTimeout(() => { cancelAnimationFrame(id); ctx.clearRect(0, 0, W, H); }, 2800);
  return () => { cancelAnimationFrame(id); clearTimeout(t); };
}

/* ══════════════════════════════════
   BOTTOM NAV ICONS — filled when active
   ══════════════════════════════════ */
function IconDiscover({ active }) {
  const c = active ? DARK_TEAL : INACTIVE;
  if (active) return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill={c} />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="rgba(255,255,255,0.88)" />
    </svg>
  );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" stroke={c} />
    </svg>
  );
}
function IconBrowse({ active }) {
  const c = active ? DARK_TEAL : INACTIVE;
  if (active) return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={c}>
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" stroke="#fff" strokeWidth="1.5" />
      <path d="M16 10a4 4 0 0 1-8 0" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
function IconQuest({ active }) {
  const c = active ? DARK_TEAL : INACTIVE;
  if (active) return <svg width="22" height="22" viewBox="0 0 24 24" fill={c}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
}
function IconHeart({ active }) {
  const c = active ? DARK_TEAL : INACTIVE;
  const heart = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
  if (active) return <svg width="22" height="22" viewBox="0 0 24 24" fill={c}><path d={heart} /></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={heart} /></svg>;
}
function IconProfile({ active }) {
  const c = active ? DARK_TEAL : INACTIVE;
  if (active) return <svg width="22" height="22" viewBox="0 0 24 24" fill={c}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
}

/* ─── Utility icons ─── */
const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
function HeartOutlineWhite() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={HEART_PATH} /></svg>;
}
function HeartSolidWhite() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" stroke="none"><path d={HEART_PATH} /></svg>;
}
function StarIcon({ size = 13, color = '#F59E0B' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>;
}
function SearchIcon({ color = '#9CA3AF' }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
function ChevronDown() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
}
function BellIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
}
function PinIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
}
function CloseIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}

/* ══════════════════════════════════
   STORE IMAGE AREA — shared component
   ══════════════════════════════════ */
function StoreImg({ store, height = 140, fontSize = 44 }) {
  return (
    <div style={{ position: 'relative', height, overflow: 'hidden', background: store.bgColor || '#888' }}>
      {store.image
        ? <img src={store.image} alt={store.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize, opacity: 0.85 }}>{store.emoji}</span>
        </div>
      }
    </div>
  );
}

/* ══════════════════════════════════
   STORE CARD — horizontal scroll (Home)
   ══════════════════════════════════ */
function StoreCardWide({ store, tagData, setReviewStore, ix }) {
  const { bagCounts, favourites, toggleFav, heartAnim, flashBags, openStore, nowMins, reservedStores, taggedStores } = ix;
  const bags = bagCounts[store.id] ?? store.bags;
  const isFav = favourites.has(store.id);
  const ending = isEndingSoon(store);
  const sold = bags === 0;
  const pillBg = sold ? '#9CA3AF' : bags <= 2 ? '#EF4444' : ORANGE;
  const topTags = getTopTags(tagData[store.id]);

  const [pressed, setPressed] = useState(false);

  return (
    <div
      onClick={() => openStore(store)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: 220, flexShrink: 0, background: sold ? '#F6F6F6' : '#fff',
        borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #F3F4F6',
        scrollSnapAlign: 'start', marginRight: 12,
        cursor: 'pointer', opacity: sold ? 0.7 : 1,
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.15s ease, opacity 0.3s',
      }}
    >
      {/* Image area */}
      <div style={{ height: 136, position: 'relative', overflow: 'hidden', background: store.bgColor }}>
        {store.image
          ? <img src={store.image} alt={store.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 44, opacity: 0.85 }}>{store.emoji}</span>
          </div>
        }
        {/* Gradient overlay for text readability */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, transparent 40%, transparent 55%, rgba(0,0,0,0.35) 100%)', pointerEvents: 'none' }} />
        {/* Bags left pill */}
        <div style={{
          position: 'absolute', top: 9, left: 9,
          background: pillBg, color: '#fff', fontSize: 11, fontWeight: 700,
          padding: '3px 9px', borderRadius: 999, fontFamily: SYS,
          transition: 'background-color 0.3s',
          animation: flashBags.has(store.id) ? 'pillFlash 0.45s ease' : 'none',
        }}>
          {sold ? 'Sold out' : `${bags} left`}
        </div>
        {/* Ending soon overlay */}
        {ending && !sold && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'linear-gradient(to top, rgba(239,68,68,0.88), transparent)',
            height: 30, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: SYS }}>⏰ Ending soon</span>
          </div>
        )}
        {/* Heart */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleFav(store.id); }}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: isFav ? 'rgba(239,68,68,0.85)' : 'rgba(0,0,0,0.28)',
            border: 'none', cursor: 'pointer', borderRadius: '50%', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: heartAnim.has(store.id) ? 'heartBounce 0.35s ease' : 'none',
            transition: 'background-color 0.2s',
          }}
        >
          {isFav ? <HeartSolidWhite /> : <HeartOutlineWhite />}
        </button>
        {/* Top tag pill */}
        {topTags[0] && (
          <div style={{
            position: 'absolute', bottom: 44, left: 8,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
            color: '#fff', fontSize: 10, fontWeight: 600,
            padding: '2px 8px', borderRadius: 999, fontFamily: SYS,
          }}>
            {TAG_EMOJI[topTags[0].key] || '🏷️'} Mostly {topTags[0].label}
          </div>
        )}
        {/* Store logo */}
        <div style={{
          position: 'absolute', bottom: 8, left: 8, width: 30, height: 30,
          borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
          overflow: 'hidden',
        }}>
          {store.logo
            ? <img src={store.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
            : store.emoji}
        </div>
        {/* Price */}
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', textDecoration: 'line-through', fontFamily: SYS }}>{store.originalPrice}</span>
          <span style={{
            background: DARK_TEAL, color: '#fff', fontSize: 13, fontWeight: 700,
            padding: '3px 8px', borderRadius: 7, fontFamily: SYS,
          }}>{store.salePrice}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px 12px' }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 2, fontFamily: SYS, lineHeight: 1.3 }}>{store.name}</h3>
        <p style={{ fontSize: 12, color: '#9CA3AF', fontFamily: SYS, marginBottom: 8 }}>
          {store.distance} · <span style={{ color: getTimeColor(store.collectTimeEnd, nowMins).color, fontWeight: getTimeColor(store.collectTimeEnd, nowMins).weight, animation: getTimeColor(store.collectTimeEnd, nowMins).pulse ? 'pulseGreen 1.5s ease-in-out infinite' : 'none' }}>{formatTimeLeft(store.collectTimeEnd, nowMins)}</span>
        </p>
        {topTags.length > 0 && (
          <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
            <p style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 5, fontFamily: SYS }}>Community Tags</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {topTags.map(t => (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#6B7280', width: 40, textAlign: 'right', fontFamily: SYS }}>{t.label}</span>
                  <div style={{ flex: 1, height: 4, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${t.pct}%`, background: TEAL, borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#9CA3AF', width: 26, fontFamily: SYS }}>{t.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {taggedStores.has(store.id) ? (
          <p style={{ width: '100%', marginTop: 10, fontSize: 11, color: '#9CA3AF', textAlign: 'center', fontFamily: SYS }}>
            ✓ Tagged · Thanks for contributing!
          </p>
        ) : reservedStores.has(store.id) ? (
          <button
            onClick={(e) => { e.stopPropagation(); setReviewStore(store); }}
            style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEAL, fontSize: 12, fontWeight: 600, textAlign: 'center', fontFamily: SYS }}
          >
            + Tag Bag
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   BROWSE / FAVOURITES LIST ITEM
   ══════════════════════════════════ */
function BrowseListItem({ store, ix, setReviewStore }) {
  const { bagCounts, favourites, toggleFav, heartAnim, flashBags, openStore, nowMins, tagData } = ix;
  const bags = bagCounts[store.id] ?? store.bags;
  const isFav = favourites.has(store.id);
  const sold = bags === 0;
  const pillBg = sold ? '#9CA3AF' : bags <= 2 ? '#EF4444' : ORANGE;
  const [pressed, setPressed] = useState(false);

  return (
    <div
      onClick={() => openStore(store)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: 'flex', gap: 12, alignItems: 'center',
        background: '#fff', borderRadius: 16, border: '1px solid #F3F4F6',
        padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer',
        opacity: sold ? 0.65 : 1,
        transform: pressed ? 'scale(0.98)' : 'scale(1)',
        transition: 'transform 0.15s ease, opacity 0.3s',
      }}
    >
      {/* Image square */}
      <div style={{ width: 82, height: 82, borderRadius: 12, flexShrink: 0, background: store.bgColor, position: 'relative', overflow: 'hidden' }}>
        {store.image
          ? <img src={store.image} alt={store.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 32, opacity: 0.85 }}>{store.emoji}</span>
          </div>
        }
        <div style={{
          position: 'absolute', top: 5, left: 5, background: pillBg, color: '#fff',
          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, fontFamily: SYS,
          transition: 'background-color 0.3s',
          animation: flashBags.has(store.id) ? 'pillFlash 0.45s ease' : 'none',
        }}>
          {sold ? 'Sold out' : `${bags} left`}
        </div>
        {store.logo && (
          <div style={{ position: 'absolute', bottom: 4, right: 4, width: 24, height: 24, borderRadius: 6, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={store.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 1, fontFamily: SYS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{store.name}</h3>
        <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2, fontFamily: SYS }}>{store.category} · {store.distance}</p>
        <p style={{ fontSize: 11, fontFamily: SYS, color: getTimeColor(store.collectTimeEnd, nowMins).color, fontWeight: getTimeColor(store.collectTimeEnd, nowMins).weight, animation: getTimeColor(store.collectTimeEnd, nowMins).pulse ? 'pulseGreen 1.5s ease-in-out infinite' : 'none' }}>{formatTimeLeft(store.collectTimeEnd, nowMins)}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
          <StarIcon size={11} color="#F59E0B" />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', fontFamily: SYS }}>{store.rating}</span>
        </div>
        {tagData && tagData[store.id] && (() => {
          const top = getTopTags(tagData[store.id], 2);
          return top.length > 0 ? (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {top.map(t => (
                <span key={t.key} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999, background: '#F0FDF4', color: '#065F46', fontFamily: SYS, fontWeight: 500 }}>
                  {TAG_EMOJI[t.key] || ''} {t.label}
                </span>
              ))}
            </div>
          ) : null;
        })()}
      </div>

      {/* Right side: price + heart */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: TEAL, fontFamily: SYS }}>{store.salePrice}</p>
          <p style={{ fontSize: 10, color: '#9CA3AF', textDecoration: 'line-through', fontFamily: SYS }}>{store.originalPrice}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFav(store.id); }}
          style={{
            background: isFav ? '#FEE2E2' : '#F3F4F6', border: 'none', cursor: 'pointer',
            borderRadius: '50%', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: heartAnim.has(store.id) ? 'heartBounce 0.35s ease' : 'none',
            transition: 'background-color 0.2s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFav ? '#EF4444' : 'none'} stroke={isFav ? '#EF4444' : '#9CA3AF'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={HEART_PATH} /></svg>
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   STORE DETAIL SHEET
   ══════════════════════════════════ */
function StoreDetailSheet({ store, tagData, bagCounts, onClose, onReserve, ix, setReviewStore }) {
  const [closing, setClosing] = useState(false);
  const animClose = useCallback(() => { setClosing(true); setTimeout(onClose, 280); }, [onClose]);
  const [reserveState, setReserveState] = useState('idle'); // 'idle' | 'confirming' | 'reserved' | 'impact'
  const confirmTimerRef = useRef(null);
  const [bagQty, setBagQty] = useState(1);
  /* Swipe-to-dismiss */
  const sheetTouchY = useRef(null);
  const [sheetDragY, setSheetDragY] = useState(0);
  const sheetDragging = useRef(false);
  const onSheetTouchStart = (e) => { sheetTouchY.current = e.touches[0].clientY; sheetDragging.current = true; };
  const onSheetTouchMove = (e) => {
    if (!sheetDragging.current || sheetTouchY.current === null) return;
    const dy = e.touches[0].clientY - sheetTouchY.current;
    if (dy > 0) setSheetDragY(dy);
  };
  const onSheetTouchEnd = () => {
    sheetDragging.current = false;
    sheetTouchY.current = null;
    if (sheetDragY > 85) { animClose(); }
    setSheetDragY(0);
  };
  const bags = bagCounts[store.id] ?? store.bags;
  const sold = bags === 0;
  const closed = parseMins(store.collectTimeEnd) <= getNowMins() || getNowMins() < parseMins(store.collectTimeStart);
  const cantReserve = sold || closed;
  const allTags = getAllTags(tagData[store.id]);
  const { favourites, toggleFav, heartAnim, reservedStores, taggedStores } = ix;
  const isFav = favourites.has(store.id);
  const isReserved = reservedStores.has(store.id);
  const isTagged = taggedStores.has(store.id);
  const success = reserveState === 'reserved' || reserveState === 'impact';
  const co2Data = getCo2ForStore(store);

  const handleReserve = () => {
    if (cantReserve) return;
    if (reserveState === 'idle') {
      setReserveState('confirming');
      confirmTimerRef.current = setTimeout(() => setReserveState('idle'), 3000);
    } else if (reserveState === 'confirming') {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      for (let i = 0; i < bagQty; i++) onReserve(store);
      setReserveState('reserved');
      setTimeout(() => setReserveState('impact'), 3500);
      setTimeout(() => animClose(), 10000);
    }
  };
  const totalPrice = (store.price * bagQty).toFixed(2);

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" style={{ opacity: closing ? 0 : 1, transition: 'opacity 0.28s ease' }}>
      <div className="absolute inset-0 bg-black/40" onClick={animClose} />
      <div
        onTouchStart={onSheetTouchStart}
        onTouchMove={onSheetTouchMove}
        onTouchEnd={onSheetTouchEnd}
        style={{
          position: 'relative', background: '#fff',
          borderRadius: '24px 24px 0 0', height: '87%', zIndex: 50,
          animation: sheetDragY > 0 ? 'none' : closing ? 'none' : 'slideUp 0.32s ease-out',
          transform: closing ? 'translateY(100%)' : sheetDragY > 0 ? `translateY(${sheetDragY}px)` : undefined,
          transition: closing ? 'transform 0.28s ease' : sheetDragging.current ? 'none' : 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
        }}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, background: '#D1D5DB', borderRadius: 999, margin: '10px auto 0', flexShrink: 0, cursor: 'grab' }} />

        {/* Scrollable content */}
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', paddingBottom: success ? 24 : 100 }}>
          {/* Image */}
          <div style={{ height: 240, position: 'relative', overflow: 'hidden', background: store.bgColor, borderRadius: '24px 24px 0 0' }}>
            {store.image
              ? <img src={store.image} alt={store.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 72, opacity: 0.85 }}>{store.emoji}</span>
              </div>
            }
            {/* Gradient overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, transparent 50%, transparent 60%, rgba(0,0,0,0.3) 100%)', pointerEvents: 'none' }} />
            {/* Close */}
            <button
              onClick={animClose}
              style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <CloseIcon />
            </button>
            {/* Heart */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFav(store.id); }}
              style={{
                position: 'absolute', top: 12, right: 50,
                background: isFav ? 'rgba(239,68,68,0.85)' : 'rgba(0,0,0,0.35)',
                border: 'none', cursor: 'pointer', borderRadius: '50%', width: 30, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: heartAnim.has(store.id) ? 'heartBounce 0.35s ease' : 'none',
                transition: 'background-color 0.2s',
              }}
            >
              {isFav ? <HeartSolidWhite /> : <HeartOutlineWhite />}
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '20px 20px 8px' }}>
            {success ? (
              reserveState === 'impact' ? (
                <div style={{ textAlign: 'center', padding: '24px 0 16px', animation: 'fadeIn 0.3s ease' }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, fontFamily: SYS }}>Your Impact</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                    {[
                      { icon: '🌫️', val: `${co2Data.co2}kg`, label: 'CO₂ prevented', color: TEAL },
                      { icon: '🚗', val: `${co2Data.km}km`, label: 'driving avoided', color: '#6B7280' },
                      { icon: '💧', val: '120L', label: 'water saved', color: '#3B82F6' },
                      { icon: '🍽️', val: '1 meal', label: 'rescued', color: ORANGE },
                    ].map((s, i) => (
                      <div key={s.label} style={{
                        background: '#F9FAFB', borderRadius: 14, padding: '14px 10px', textAlign: 'center',
                        animation: `countUp 0.4s ease ${0.1 * i}s both`,
                      }}>
                        <span style={{ fontSize: 22, display: 'block', marginBottom: 4 }}>{s.icon}</span>
                        <p style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: SYS }}>{s.val}</p>
                        <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { animClose(); ix.openStore(null); setTimeout(() => ix.switchTab('profile'), 100); }}
                    style={{ background: '#F3F4F6', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 12, fontFamily: SYS, padding: '8px 20px', borderRadius: 999, fontWeight: 600 }}
                  >
                    See your full impact →
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0 16px' }}>
                  {/* Animated checkmark circle */}
                  <div style={{ animation: 'scaleUpBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)', margin: '0 auto 16px', width: 72, height: 72 }}>
                    <svg width="72" height="72" viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r="32" fill="none" stroke={TEAL} strokeWidth="3"
                        strokeDasharray="201" strokeDashoffset="0"
                        style={{ animation: 'circleDraw 0.6s ease forwards' }} />
                      <path d="M22 36 L32 46 L50 28" fill="none" stroke={TEAL} strokeWidth="3.5"
                        strokeLinecap="round" strokeLinejoin="round"
                        strokeDasharray="50" strokeDashoffset="0"
                        style={{ animation: 'checkDraw 0.4s ease 0.3s both' }} />
                    </svg>
                  </div>
                  <p style={{ fontSize: 22, fontWeight: 800, color: '#111827', fontFamily: SYS, marginBottom: 4 }}>Bag Reserved!</p>
                  <p style={{ fontSize: 14, color: '#6B7280', fontFamily: SYS, marginBottom: 16 }}>{store.name}</p>

                  {/* Pickup reminder card */}
                  <div style={{
                    background: '#F0FDF4', borderRadius: 16, padding: '14px 16px', textAlign: 'left',
                    border: `1.5px solid ${TEAL}22`, animation: 'countUp 0.4s ease 0.3s both',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: store.bgColor, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {store.image
                          ? <img src={store.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 18 }}>{store.emoji}</span>}
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', fontFamily: SYS }}>Pickup Window</p>
                        <p style={{ fontSize: 16, fontWeight: 800, color: TEAL, fontFamily: SYS }}>{store.collectTimeStart} – {store.collectTimeEnd}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#6B7280', fontFamily: SYS }}>📍 {store.address}</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <button
                    onClick={() => { animClose(); ix.openStore(null); setTimeout(() => ix.switchTab('profile'), 100); }}
                    style={{
                      marginTop: 12, width: '100%', padding: '12px 0', borderRadius: 12,
                      background: TEAL, border: 'none', color: '#fff',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: SYS,
                      animation: 'countUp 0.4s ease 0.4s both',
                    }}
                  >
                    View My Reservations
                  </button>
                  <button
                    onClick={() => { animClose(); }}
                    style={{
                      marginTop: 8, width: '100%', padding: '10px 0', borderRadius: 12,
                      background: '#fff', border: `1.5px solid #E5E7EB`, color: '#6B7280',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: SYS,
                      animation: 'countUp 0.4s ease 0.5s both',
                    }}
                  >
                    Continue Browsing
                  </button>
                </div>
              )
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                    {store.logo && (
                      <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#fff', border: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={store.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', fontFamily: SYS, lineHeight: 1.2 }}>{store.name}</h2>
                      <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2, fontFamily: SYS }}>{store.category}</p>
                      <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 1, fontFamily: SYS }}>📍 {store.address}</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const addr = encodeURIComponent(store.address);
                      window.open(`https://www.google.com/maps/dir/?api=1&destination=${addr}`, '_blank');
                    }}
                    style={{
                      padding: '6px 12px', borderRadius: 10, flexShrink: 0,
                      background: '#F3F4F6', border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 600, color: '#6B7280', fontFamily: SYS,
                    }}
                  >📍 Directions</button>
                </div>

                {/* Chips row */}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div style={{ padding: '5px 12px', borderRadius: 999, border: '1.5px solid #EF4444', fontSize: 12, color: '#EF4444', fontWeight: 600, fontFamily: SYS }}>
                    ⏰ {formatTimeLeft(store.collectTimeEnd, ix.nowMins)} · {store.collectTimeStart} – {store.collectTimeEnd}
                  </div>
                  <div style={{ padding: '5px 12px', borderRadius: 999, border: '1.5px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500, fontFamily: SYS, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <StarIcon size={11} color="#F59E0B" /> {store.rating}
                  </div>
                  <div style={{ padding: '5px 12px', borderRadius: 999, border: '1.5px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500, fontFamily: SYS }}>
                    {store.distance}
                  </div>
                </div>

                {/* What you might get */}
                {store.whatYouMightGet && (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontFamily: SYS }}>What you might get</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {store.whatYouMightGet.map(item => (
                        <span key={item} style={{ padding: '5px 12px', borderRadius: 999, background: '#F0FDF4', border: `1.5px solid ${TEAL}22`, fontSize: 12, color: '#374151', fontFamily: SYS }}>{item}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bags urgency + quantity selector */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: sold ? '#9CA3AF' : bags <= 2 ? '#EF4444' : TEAL, fontFamily: SYS }}>
                    {sold ? 'Sold out — check back tomorrow' : bags <= 2 ? `⚠️ Only ${bags} bag${bags > 1 ? 's' : ''} left!` : `${bags} bags available`}
                  </p>
                  {!sold && bags > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => setBagQty(q => Math.max(1, q - 1))} style={{
                        width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${TEAL}`, background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, color: TEAL, fontWeight: 700, fontFamily: SYS,
                      }}>−</button>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#111827', fontFamily: SYS, minWidth: 16, textAlign: 'center' }}>{bagQty}</span>
                      <button onClick={() => setBagQty(q => Math.min(bags, q + 1))} style={{
                        width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${TEAL}`, background: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, color: TEAL, fontWeight: 700, fontFamily: SYS,
                      }}>+</button>
                    </div>
                  )}
                </div>

                {/* Community tags — all */}
                {allTags.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, fontFamily: SYS }}>Community Tags</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {allTags.map(t => (
                        <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#6B7280', width: 60, fontFamily: SYS }}>{t.label}</span>
                          <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${t.pct}%`, background: TEAL, borderRadius: 999 }} />
                          </div>
                          <span style={{ fontSize: 11, color: '#9CA3AF', width: 32, fontFamily: SYS }}>{t.pct}%</span>
                        </div>
                      ))}
                    </div>
                    {/* Tag CTA — state-dependent */}
                    {isTagged ? (
                      <p style={{ fontSize: 11, color: TEAL, fontWeight: 500, marginTop: 10, fontFamily: SYS }}>✓ You've tagged this bag</p>
                    ) : isReserved ? (
                      <button
                        onClick={() => { setReviewStore(store); }}
                        style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', color: TEAL, fontSize: 12, fontWeight: 600, fontFamily: SYS, padding: 0 }}
                      >+ Tag Bag</button>
                    ) : (
                      <p style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 10, fontFamily: SYS }}>Reserve this bag to add your tags</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* CTA fixed at bottom */}
        {!success && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 20px 28px', background: '#fff', borderTop: '1px solid #F3F4F6' }}>
            <button
              disabled={cantReserve}
              onClick={handleReserve}
              style={{
                width: '100%', padding: '15px 0', borderRadius: 16, fontSize: 15, fontWeight: 700,
                border: 'none', cursor: cantReserve ? 'not-allowed' : 'pointer',
                background: cantReserve ? '#E5E7EB' : reserveState === 'confirming' ? '#FF6B35' : TEAL,
                color: cantReserve ? '#9CA3AF' : '#fff', fontFamily: SYS,
                position: 'relative', overflow: 'hidden', transition: 'background 0.2s',
              }}
            >
              {sold ? 'Sold Out' : closed ? 'Store Closed' : reserveState === 'confirming' ? 'Confirm Reservation ✓' : `Reserve ${bagQty > 1 ? `${bagQty} Bags` : 'Bag'} · CHF ${totalPrice}`}
              {reserveState === 'confirming' && (
                <span style={{
                  position: 'absolute', bottom: 0, left: 0, height: 3,
                  background: 'rgba(255,255,255,0.5)', borderRadius: 999,
                  animation: 'confirmCountdown 3s linear forwards',
                }} />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   SKELETON LOADER
   ══════════════════════════════════ */
function SkeletonHome() {
  const card = (
    <div style={{ width: 220, flexShrink: 0, borderRadius: 16, overflow: 'hidden', border: '1px solid #F3F4F6', marginRight: 12 }}>
      <div className="skeleton" style={{ height: 136 }} />
      <div style={{ padding: '10px 12px 14px' }}>
        <div className="skeleton" style={{ height: 14, width: '75%', marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 10, width: '50%', marginBottom: 6 }} />
        <div className="skeleton" style={{ height: 10, width: '40%' }} />
      </div>
    </div>
  );
  return (
    <div style={{ padding: '14px 0' }}>
      <div style={{ padding: '0 16px', marginBottom: 12 }}><div className="skeleton" style={{ height: 18, width: 180 }} /></div>
      <div style={{ display: 'flex', padding: '0 16px 4px', overflow: 'hidden' }}>{card}{card}</div>
      <div style={{ padding: '20px 16px 12px' }}><div className="skeleton" style={{ height: 18, width: 220 }} /></div>
      <div style={{ display: 'flex', padding: '0 16px 4px', overflow: 'hidden' }}>{card}{card}</div>
    </div>
  );
}

function SkeletonBrowse() {
  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[80, 60, 60, 70].map((w, i) => <div key={i} className="skeleton" style={{ height: 30, width: w, borderRadius: 999 }} />)}
      </div>
      <div className="skeleton" style={{ height: '55vh', borderRadius: 16 }} />
    </div>
  );
}

function SkeletonQuest() {
  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <div className="skeleton" style={{ height: 140, borderRadius: 20, marginBottom: 20 }} />
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ width: 76, height: 80, borderRadius: 16, flexShrink: 0 }} />)}
      </div>
      {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 16, marginBottom: 10 }} />)}
    </div>
  );
}

function SkeletonFavourites() {
  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <div className="skeleton" style={{ height: 20, width: 120, marginBottom: 12, borderRadius: 8 }} />
      {[1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="skeleton" style={{ width: 82, height: 82, borderRadius: 12, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 10, width: '50%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 10, width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════
   ONBOARDING SCREEN
   ══════════════════════════════════ */
const ONBOARDING_SLIDES = [
  {
    emoji: '🌍',
    title: 'Save food, save the planet',
    body: 'Too Good To Go connects you with stores selling surplus food at a fraction of the price. Every bag you save keeps food out of the bin.',
    cta: 'Next',
  },
  {
    emoji: '🏆',
    title: 'Earn points & climb the ranks',
    body: 'Tag your bags, complete quests, and beat your friends on the weekly leaderboard. The more you save, the higher you rise.',
    cta: 'Next',
  },
  {
    emoji: '📍',
    title: 'St. Gallen is ready',
    body: '6 local stores are already on board — from Migros to Barista. Your first bag is waiting.',
    cta: 'Start saving',
  },
];

function OnboardingScreen({ onDone }) {
  const [slide, setSlide] = useState(0);
  const s = ONBOARDING_SLIDES[slide];
  const last = slide === ONBOARDING_SLIDES.length - 1;
  return (
    <div className="absolute inset-0 z-[70] flex flex-col" style={{ background: `linear-gradient(160deg, ${TEAL} 0%, ${DARK_TEAL} 100%)` }}>
      {/* dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, paddingTop: 52 }}>
        {ONBOARDING_SLIDES.map((_, i) => (
          <div key={i} style={{ width: i === slide ? 20 : 6, height: 6, borderRadius: 999, background: i === slide ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'all 0.3s' }} />
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 36px', textAlign: 'center' }}>
        <div style={{ fontSize: 96, lineHeight: 1, marginBottom: 32, animation: 'fadeIn 0.4s ease' }}>{s.emoji}</div>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 16, lineHeight: 1.2, fontFamily: SYS }}>{s.title}</h1>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, fontFamily: SYS }}>{s.body}</p>
      </div>

      {/* actions */}
      <div style={{ padding: '0 28px 52px' }}>
        <button
          onClick={() => last ? onDone() : setSlide(s => s + 1)}
          style={{ width: '100%', padding: '16px 0', borderRadius: 20, background: '#fff', color: DARK_TEAL, fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer', fontFamily: SYS, marginBottom: 12 }}
        >{s.cta}</button>
        {!last && (
          <button onClick={onDone} style={{ width: '100%', background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontSize: 13, cursor: 'pointer', fontFamily: SYS }}>Skip</button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   BADGE UNLOCK MODAL — enhanced with particles + glow
   ══════════════════════════════════ */
function BadgeUnlockModal({ badge, onClose }) {
  const canvasRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const animClose = useCallback(() => { setClosing(true); setTimeout(onClose, 280); }, [onClose]);
  useEffect(() => {
    if (!canvasRef.current) return;
    return fireConfetti(canvasRef.current);
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)', animation: closing ? 'none' : 'fadeIn 0.3s ease', opacity: closing ? 0 : 1, transition: 'opacity 0.28s ease' }}>
      {/* Confetti canvas */}
      <canvas ref={canvasRef} width={375} height={812} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }} />

      <div style={{ textAlign: 'center', padding: '0 32px', position: 'relative', zIndex: 2 }}>
        {/* Expanding glow rings */}
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 20px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(91,173,146,0.4)', animation: 'ringExpand 1.5s ease-out infinite' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(91,173,146,0.3)', animation: 'ringExpand 1.5s ease-out 0.5s infinite' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(91,173,146,0.2)', animation: 'ringExpand 1.5s ease-out 1s infinite' }} />
          {/* Badge emoji */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 80, lineHeight: 1,
            animation: 'badgeEntrance 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            {badge.emoji}
          </div>
        </div>

        {/* Shine text */}
        <p style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, fontFamily: SYS,
          background: 'linear-gradient(90deg, rgba(255,255,255,0.6) 0%, #fff 50%, rgba(255,255,255,0.6) 100%)',
          backgroundSize: '200% auto',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          animation: 'badgeShine 2s linear infinite',
        }}>
          Badge Unlocked!
        </p>

        <h2 style={{ fontSize: 32, fontWeight: 900, color: '#fff', marginBottom: 8, fontFamily: SYS }}>{badge.name}</h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', marginBottom: 36, fontFamily: SYS }}>
          You've earned the <strong style={{ color: TEAL }}>{badge.name}</strong> badge. Keep saving food!
        </p>

        {/* Glow button */}
        <button
          onClick={animClose}
          style={{
            padding: '14px 44px', borderRadius: 999, fontWeight: 700, fontSize: 15,
            border: 'none', cursor: 'pointer', fontFamily: SYS,
            background: `linear-gradient(135deg, ${TEAL}, ${DARK_TEAL})`,
            color: '#fff', boxShadow: `0 4px 24px rgba(91,173,146,0.5)`,
            animation: 'badgeGlow 2s ease-in-out infinite',
          }}
        >
          Collect Badge ✨
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   IMPACT CARD OVERLAY
   ══════════════════════════════════ */
function ImpactCard({ store, bagsTotal, onClose }) {
  const [closing, setClosing] = useState(false);
  const animClose = useCallback(() => { setClosing(true); setTimeout(onClose, 280); }, [onClose]);
  const co2 = (bagsTotal * 2.5).toFixed(1);
  const money = (bagsTotal * 8).toFixed(0);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', animation: closing ? 'none' : 'fadeIn 0.25s ease', opacity: closing ? 0 : 1, transition: 'opacity 0.28s ease' }}>
      <div style={{ background: '#fff', borderRadius: 28, padding: '28px 24px', width: 310, textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', animation: closing ? 'none' : 'slideUp 0.3s ease-out', transform: closing ? 'translateY(30px)' : 'translateY(0)', transition: 'transform 0.28s ease' }}>
        {/* store image strip */}
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: store.bgColor, overflow: 'hidden', margin: '0 auto 16px', border: `3px solid ${TEAL}` }}>
          {store.image
            ? <img src={store.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>{store.emoji}</div>
          }
        </div>
        <p style={{ fontSize: 13, color: TEAL, fontWeight: 700, marginBottom: 4, fontFamily: SYS }}>BAG RESERVED ✓</p>
        <h3 style={{ fontSize: 20, fontWeight: 900, color: '#111827', marginBottom: 4, fontFamily: SYS }}>{store.name}</h3>
        <p style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20, fontFamily: SYS }}>Pickup {store.collectTimeStart} – {store.collectTimeEnd}</p>

        {/* impact stats */}
        <div style={{ background: '#F0FDF4', borderRadius: 16, padding: '16px 12px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { icon: '🍽️', val: bagsTotal, label: 'Meals saved' },
            { icon: '🌫️', val: `${co2}kg`, label: 'CO₂ avoided' },
            { icon: '💰', val: `CHF ${money}`, label: 'Money saved' },
          ].map(s => (
            <div key={s.label}>
              <p style={{ fontSize: 18, marginBottom: 2 }}>{s.icon}</p>
              <p style={{ fontSize: 14, fontWeight: 900, color: '#111827', fontFamily: SYS }}>{s.val}</p>
              <p style={{ fontSize: 9, color: '#9CA3AF', fontFamily: SYS }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={animClose} style={{ flex: 1, padding: '13px 0', borderRadius: 16, background: TEAL, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: SYS }}>
            Awesome! 🌱
          </button>
          <button
            onClick={() => {
              const text = `I just saved a bag from ${store.name} and prevented ${co2}kg of CO₂! 🌍 #TooGoodToGo #FoodWaste`;
              if (navigator.share) {
                navigator.share({ text }).catch(() => {});
              } else {
                navigator.clipboard?.writeText(text);
              }
            }}
            style={{ padding: '13px 16px', borderRadius: 16, background: '#F3F4F6', border: 'none', fontSize: 14, cursor: 'pointer' }}
          >📤</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   MAIN APP
   ══════════════════════════════════ */
export default function App() {
  const { tagData, updateTagData, ecoPoints, addEcoPoints, lifetimePoints, claimedQuests, claimQuest, redeemedRewards, redeemReward, reservations, addReservation, updateReservationStatus, getActiveReservation } = useTagData();

  /* ─ Onboarding ─ */
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('tgtg_onboarded'));

  /* ─ Detect PWA standalone mode ─ */
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  /* ─ Loading shimmer ─ */
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setIsLoading(false), 1200); return () => clearTimeout(t); }, []);

  /* ─ Splash screen ─ */
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashFading(true), 1600);
    const hideTimer = setTimeout(() => setSplashVisible(false), 2200);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  /* ─ Daily login bonus ─ */
  const [loginBonus, setLoginBonus] = useState(false);
  useEffect(() => {
    const today = new Date().toDateString();
    const lastLogin = localStorage.getItem('tgtg_lastLogin');
    if (lastLogin !== today) {
      localStorage.setItem('tgtg_lastLogin', today);
      const t = setTimeout(() => {
        addEcoPoints(5);
        flashPts(5);
        setLoginBonus(true);
        haptic(12);
        setTimeout(() => setLoginBonus(false), 3000);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, []);

  /* ─ Nav & UI ─ */
  const [activeTab, setActiveTab] = useState('home');
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const contentRef = useRef(null);
  const scrollPositions = useRef({});

  const switchTab = useCallback((tab) => {
    // Save current scroll
    if (contentRef.current) scrollPositions.current[activeTab] = contentRef.current.scrollTop;
    setActiveTab(tab);
    // Restore scroll + retrigger animation
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = scrollPositions.current[tab] || 0;
        contentRef.current.style.animation = 'none';
        void contentRef.current.offsetHeight;
        contentRef.current.style.animation = 'tabEnter 0.25s ease';
      }
    });
  }, [activeTab]);
  const [xpAnimated, setXpAnimated] = useState(false);
  const [nowMins, setNowMins] = useState(getNowMins);
  useEffect(() => { const id = setInterval(() => setNowMins(getNowMins()), 60000); return () => clearInterval(id); }, []);

  /* ─ Store state ─ */
  const [bagCounts, setBagCounts] = useState(() => Object.fromEntries(stores.map(s => [s.id, s.bags])));
  const [selectedStore, setSelectedStore] = useState(null);

  /* ─ Favourites ─ */
  const [favourites, setFavourites] = useState(new Set());
  const [heartAnim, setHeartAnim] = useState(new Set());

  /* ─ Bag flash ─ */
  const [flashBags, setFlashBags] = useState(new Set());

  /* ─ Quests ─ */
  const [questProgress, setQuestProgress] = useState(initialQuestProgress);
  const [reservedStores, setReservedStores] = useState(new Set(['migros_sg', 'roggwiller']));
  const [taggedStores, setTaggedStores] = useState(new Set(['migros_sg', 'roggwiller']));

  /* ─ Tag modal ─ */
  const [reviewStore, setReviewStore] = useState(null);
  const [reviewClosing, setReviewClosing] = useState(false);
  const closeReview = useCallback(() => { setReviewClosing(true); setTimeout(() => { setReviewStore(null); setSelectedTags([]); setRating(0); setReviewClosing(false); }, 280); }, []);
  const [selectedTags, setSelectedTags] = useState([]);
  const [rating, setRating] = useState(0);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);

  /* Auto-suggest tags based on store category */
  const openReviewStore = useCallback((store) => {
    setReviewStore(store);
    const cat = (store.category || '').toLowerCase();
    const suggestions = [];
    if (cat.includes('bakery') || cat.includes('confiserie') || cat.includes('café')) suggestions.push('bakery', 'pastry');
    else if (cat.includes('coffee')) suggestions.push('bakery', 'drinks');
    else if (cat.includes('restaurant')) suggestions.push('hot_meal', 'veggie');
    else if (cat.includes('chocolat')) suggestions.push('pastry', 'bakery');
    else if (cat.includes('supermarket')) suggestions.push('bakery', 'veggie', 'dairy');
    else if (cat.includes('organic')) suggestions.push('veggie', 'organic');
    setSelectedTags(suggestions.filter(s => TAG_KEYS.includes(s)));
  }, []);

  /* ─ Activity feed ─ */
  const [activityFeed, setActivityFeed] = useState([
    { id: 'i1', emoji: '🏷️', store: 'Migros Marktplatz', tag: 'Bakery, Dairy', time: 'Today 18:45', pts: '+15 pts', type: 'tag' },
    { id: 'i0', emoji: '🛒', store: 'Migros Marktplatz', tag: 'Reserved', time: 'Today 18:30', pts: '', type: 'reserve' },
    { id: 'i3', emoji: '🏷️', store: 'Confiserie Roggwiller', tag: 'Pastry', time: 'Yesterday', pts: '+15 pts', type: 'tag' },
    { id: 'i2', emoji: '🛒', store: 'Confiserie Roggwiller', tag: 'Reserved', time: 'Yesterday', pts: '', type: 'reserve' },
  ]);
  const [bagsReservedCount, setBagsReservedCount] = useState(2);

  /* ─ Impact card ─ */
  const [impactStore, setImpactStore] = useState(null);
  const [lastImpactData, setLastImpactData] = useState(null);

  /* ─ Rewards shop ─ */
  const [showRewardsShop, setShowRewardsShop] = useState(false);

  /* ─ Badge unlock ─ */
  const [unlockedBadge, setUnlockedBadge] = useState(null);
  const QUEST_BADGE_MAP = { q1: { id: 'b4', name: 'Explorer', emoji: '🧭' }, q4: { id: 'b5', name: 'Champion', emoji: '🏆' } };

  /* ─ Notifications ─ */
  const [showNotif, setShowNotif] = useState(false);
  const [notifStore, setNotifStore] = useState(null);
  const [bellDot, setBellDot] = useState(true);

  /* ─ Confetti ─ */
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiRef = useRef(null);
  const pendingConfetti = useRef(false);

  /* ─ Points animation ─ */
  const ptsRef = useRef(null);
  const [floatingPts, setFloatingPts] = useState([]);

  /* ─── helpers ─── */
  const flashPts = useCallback((amt) => {
    // Animate header pill
    if (ptsRef.current) {
      ptsRef.current.style.animation = 'none';
      void ptsRef.current.offsetHeight;
      ptsRef.current.style.animation = 'ptsPop 0.4s ease';
    }
    // Floating text
    const id = Date.now() + Math.random();
    setFloatingPts(prev => [...prev, { id, amt }]);
    setTimeout(() => setFloatingPts(prev => prev.filter(f => f.id !== id)), 900);
  }, []);

  const toggleFav = useCallback((storeId) => {
    haptic();
    setFavourites(prev => { const n = new Set(prev); n.has(storeId) ? n.delete(storeId) : n.add(storeId); return n; });
    setHeartAnim(prev => new Set([...prev, storeId]));
    setTimeout(() => setHeartAnim(prev => { const n = new Set(prev); n.delete(storeId); return n; }), 400);
  }, []);

  /* ─── reserve ─── */
  const handleReserve = useCallback((store) => {
    const cur = bagCounts[store.id] ?? store.bags;
    if (cur === 0) return;
    haptic(20);
    setBagCounts(prev => ({ ...prev, [store.id]: Math.max(0, cur - 1) }));
    setFlashBags(prev => new Set([...prev, store.id]));
    setTimeout(() => setFlashBags(prev => { const n = new Set(prev); n.delete(store.id); return n; }), 550);
    setBagsReservedCount(c => c + 1);
    if (!reservedStores.has(store.id)) {
      setReservedStores(prev => new Set([...prev, store.id]));
      setQuestProgress(prev => ({ ...prev, q4: Math.min(quests.find(q => q.id === 'q4').total, (prev.q4 ?? 0) + 1) }));
    }
    setActivityFeed(prev => [
      { id: Date.now(), emoji: '🛒', store: store.name, tag: 'Reserved', time: 'Just now', pts: '', type: 'reserve' },
      ...prev,
    ].slice(0, 12));
    setImpactStore(store);
    setLastImpactData({ store, bags: bagsReservedCount + 1 });

    // Award eco points for saving food
    addEcoPoints(10);
    flashPts(10);

    // Increment streak quest progress
    setQuestProgress(prev => ({ ...prev, q3: Math.min(quests.find(q => q.id === 'q3').total, (prev.q3 ?? 0) + 1) }));

    // Create reservation object
    if (!getActiveReservation(store.id)) {
      const now = new Date();
      const startH = now.getHours() + 2;
      const pickupStart = new Date(now); pickupStart.setHours(startH, 0, 0, 0);
      const pickupEnd = new Date(now); pickupEnd.setHours(startH + 1, 30, 0, 0);
      const topTags = getTopTags(tagData[store.id], 3).map(t => t.label);
      addReservation({
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        bagId: store.id,
        storeName: store.name,
        storeAddress: store.address,
        storeLatitude: store.lat,
        storeLongitude: store.lng,
        pickupWindowStart: pickupStart.toISOString(),
        pickupWindowEnd: pickupEnd.toISOString(),
        status: 'reserved',
        reservedAt: now.toISOString(),
        communityTags: topTags.length > 0 ? topTags : ['Surprise Bag'],
        price: store.price,
        imageUrl: store.image || '',
        logo: store.logo || '',
        emoji: store.emoji || '🛒',
      });
    }

    // Show undo toast
    setUndoToast(prev => {
      if (prev?.timer) clearTimeout(prev.timer);
      const timer = setTimeout(() => setUndoToast(null), 5000);
      return { store, timer };
    });
  }, [bagCounts, reservedStores, tagData, getActiveReservation, addReservation, addEcoPoints, flashPts]);

  /* ─── tag submit ─── */
  const handleSubmitReview = useCallback(() => {
    if (!reviewStore || selectedTags.length === 0) return;
    haptic(15);
    updateTagData(reviewStore.id, selectedTags);
    addEcoPoints(15);
    flashPts(15);
    setTaggedStores(prev => new Set([...prev, reviewStore.id]));
    setQuestProgress(prev => ({
      ...prev,
      q1: Math.min(quests.find(q => q.id === 'q1').total, (prev.q1 ?? 0) + 1),
      q2: Math.min(quests.find(q => q.id === 'q2').total, (prev.q2 ?? 0) + 1),
    }));
    const tagNames = selectedTags.map(t => TAG_LABELS[t]).join(', ');
    setActivityFeed(prev => [
      { id: Date.now(), emoji: '🏷️', store: reviewStore.name, tag: tagNames, time: 'Just now', pts: '+15 pts', type: 'tag' },
      ...prev,
    ].slice(0, 12));
    setShowSubmitSuccess(true);
    setTimeout(() => { setShowSubmitSuccess(false); setReviewStore(null); setSelectedTags([]); setRating(0); }, 1400);
  }, [reviewStore, selectedTags, updateTagData, addEcoPoints, flashPts]);

  /* ─── quest claim ─── */
  const handleClaim = useCallback((quest) => {
    haptic(25);
    claimQuest(quest.id);
    addEcoPoints(quest.points);
    flashPts(quest.points);
    pendingConfetti.current = true;
    setShowConfetti(true);
    if (QUEST_BADGE_MAP[quest.id]) {
      setTimeout(() => setUnlockedBadge(QUEST_BADGE_MAP[quest.id]), 3000);
    }
  }, [claimQuest, addEcoPoints, flashPts, QUEST_BADGE_MAP]);

  /* ─── confetti effect ─── */
  useEffect(() => {
    if (showConfetti && confettiRef.current && pendingConfetti.current) {
      pendingConfetti.current = false;
      const cleanup = fireConfetti(confettiRef.current);
      const t = setTimeout(() => { setShowConfetti(false); cleanup(); }, 2800);
      return () => { clearTimeout(t); cleanup(); };
    }
  }, [showConfetti]);

  /* ─── xp bar on quest tab ─── */
  useEffect(() => {
    if (activeTab === 'quest') { setXpAnimated(false); const t = setTimeout(() => setXpAnimated(true), 50); return () => clearTimeout(t); }
  }, [activeTab]);

  /* ─── mock clock tick ─── */
  useEffect(() => {
    const id = setInterval(() => setNowMins(m => m + 1), 60000);
    return () => clearInterval(id);
  }, []);

  /* ─── notification types ─── */
  const NOTIF_TYPES = useRef([
    { type: 'ending_soon', icon: '⏰', getMsg: (s, bags) => ({ title: `${s.name} closing soon!`, body: `Only ${bags} bag${bags !== 1 ? 's' : ''} left · pickup ends ${s.closingTime}`, cta: 'Grab it now' }) },
    { type: 'low_stock', icon: '🔥', getMsg: (s, bags) => ({ title: `${bags} bag${bags !== 1 ? 's' : ''} left at ${s.name}`, body: `${s.distance} away · these go fast!`, cta: 'Reserve' }) },
    { type: 'new_bags', icon: '🆕', getMsg: (s, bags) => ({ title: `Fresh bags at ${s.name}!`, body: `${bags} surprise bag${bags !== 1 ? 's' : ''} just listed · ${s.salePrice}`, cta: 'View bags' }) },
    { type: 'friend_save', icon: '👥', getMsg: (s) => ({ title: `${CLASSMATE_FEED[Math.floor(Math.random() * CLASSMATE_FEED.length)].name} saved at ${s.name}`, body: `Your friend just rescued a bag nearby`, cta: 'Save one too' }) },
    { type: 'price_drop', icon: '💰', getMsg: (s) => ({ title: `Great deal at ${s.name}`, body: `Surprise bag for only ${s.salePrice} · save ${Math.round((1 - s.price / parseFloat(s.originalPrice.replace('CHF ', ''))) * 100)}%`, cta: 'View deal' }) },
  ]).current;
  const [notifType, setNotifType] = useState(null);
  const notifCounter = useRef(0);

  /* ─── auto notification ─── */
  useEffect(() => {
    const interval = setInterval(() => {
      if (showNotif) return;
      const eligible = stores.filter(s => (bagCounts[s.id] ?? s.bags) > 0);
      if (!eligible.length) return;
      // Cycle through notification types for variety
      const typeIdx = notifCounter.current % NOTIF_TYPES.length;
      notifCounter.current++;
      // Prefer ending-soon stores for urgency-type notifs
      let pick;
      if (typeIdx === 0) {
        pick = eligible.find(s => isEndingSoon(s)) || eligible[Math.floor(Math.random() * eligible.length)];
      } else if (typeIdx === 1) {
        pick = eligible.find(s => (bagCounts[s.id] ?? s.bags) <= 2) || eligible[Math.floor(Math.random() * eligible.length)];
      } else {
        pick = eligible[Math.floor(Math.random() * eligible.length)];
      }
      setNotifType(NOTIF_TYPES[typeIdx]);
      setNotifStore(pick); setShowNotif(true); setBellDot(true);
      haptic(8);
    }, 45000);
    return () => clearInterval(interval);
  }, [showNotif, bagCounts]);

  useEffect(() => {
    if (!showNotif) return;
    const t = setTimeout(() => setShowNotif(false), 14000);
    return () => clearTimeout(t);
  }, [showNotif]);

  const triggerNotif = useCallback(() => {
    if (showNotif) return;
    const eligible = stores.filter(s => (bagCounts[s.id] ?? s.bags) > 0);
    const pick = eligible[Math.floor(Math.random() * eligible.length)] || stores[0];
    const typeIdx = notifCounter.current % NOTIF_TYPES.length;
    notifCounter.current++;
    setNotifType(NOTIF_TYPES[typeIdx]);
    setNotifStore(pick); setShowNotif(true); setBellDot(true);
    haptic(8);
  }, [showNotif, bagCounts]);

  const dismissNotif = useCallback(() => { setShowNotif(false); setBellDot(false); }, []);

  /* ─── interaction bundle ─── */
  const ix = { bagCounts, favourites, toggleFav, heartAnim, flashBags, openStore: setSelectedStore, nowMins, reservedStores, taggedStores, handleReserve, reservations, switchTab, tagData };

  /* ─── undo reservation toast ─── */
  const [undoToast, setUndoToast] = useState(null); // { store, timer }
  const [locationToast, setLocationToast] = useState(false);
  const locationToastTimer = useRef(null);
  const handleUndo = useCallback(() => {
    if (!undoToast) return;
    const store = undoToast.store;
    setBagCounts(prev => ({ ...prev, [store.id]: (prev[store.id] ?? 0) + 1 }));
    setBagsReservedCount(c => Math.max(0, c - 1));
    setActivityFeed(prev => prev.filter(a => !(a.store === store.name && a.type === 'reserve' && a.time === 'Just now')));
    setImpactStore(null);
    setUndoToast(null);
    haptic();
  }, [undoToast]);

  /* ─── auto-dismiss impact card after 3s (F7) ─── */
  useEffect(() => {
    if (!impactStore) return;
    const t = setTimeout(() => setImpactStore(null), 3000);
    return () => clearTimeout(t);
  }, [impactStore]);


  /* ─── filter data ─── */
  const filters = ['All', 'Available Now', 'Bakery', 'Veggie', 'Hot Meal', 'Dairy'];

  const tabs = [
    { key: 'home', icon: IconDiscover, label: 'Discover' },
    { key: 'stores', icon: IconBrowse, label: 'Browse' },
    { key: 'quest', icon: IconQuest, label: 'Eco-Quest' },
    { key: 'favourites', icon: IconHeart, label: 'Favourites' },
    { key: 'profile', icon: IconProfile, label: 'More' },
  ];

  /* ─── notification swipe-up dismiss refs (F1) ─── */
  const notifTouchY = useRef(null);

  const HEADER_H = 138;

  return (
    <div style={isStandalone
      ? { height: '100%', background: BG, display: 'flex', flexDirection: 'column' }
      : { minHeight: '100vh', background: '#DDD9D0', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingLeft: 16, paddingRight: 16 }
    }>
      <div className={isStandalone ? 'relative overflow-hidden flex flex-col' : 'relative shadow-2xl overflow-hidden flex flex-col'} style={isStandalone
        ? { width: '100%', height: '100%', background: BG }
        : { width: 375, height: 812, background: BG }
      }>

        {/* ─── SPLASH SCREEN ─── */}
        {splashVisible && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 9999,
            background: `linear-gradient(160deg, ${TEAL} 0%, #4A9A7E 50%, ${DARK_TEAL} 100%)`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            opacity: splashFading ? 0 : 1,
            transform: splashFading ? 'scale(1.05)' : 'scale(1)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>
            <img
              src="/stores/tgtg-logo.svg.png"
              alt="Too Good To Go"
              style={{
                width: 120, height: 120, objectFit: 'contain',
                filter: 'brightness(0) invert(1)',
                animation: 'splashLogo 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both',
              }}
            />
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600, fontFamily: SYS, animation: 'splashLogo 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}>
              Save food. Save money.
            </p>
          </div>
        )}

        {/* ─── PERSISTENT GREEN HEADER ─── */}
        <div style={{
          background: `linear-gradient(160deg, ${TEAL} 0%, #4A9A7E 100%)`,
          padding: '14px 20px', flexShrink: 0, position: 'relative', zIndex: 20,
        }}>
          {/* Row 1: location + bell */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={() => { clearTimeout(locationToastTimer.current); setLocationToast(true); locationToastTimer.current = setTimeout(() => setLocationToast(false), 3500); }} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <PinIcon />
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: SYS }}>St. Gallen, CH</span>
              <ChevronDown />
            </button>
            <button
              onClick={triggerNotif}
              style={{ position: 'relative', background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <BellIcon />
              {bellDot && <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, background: '#EF4444', borderRadius: '50%', border: `1.5px solid ${TEAL}` }} />}
            </button>
          </div>

          {/* Row 2: within 2 km + live points pill */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontFamily: SYS }}>Within 2 km</p>
            <button
              ref={ptsRef}
              onClick={() => setShowRewardsShop(true)}
              style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: SYS }}>{getTier(lifetimePoints).emoji} {ecoPoints.toLocaleString()} pts</span>
            </button>
          </div>

          {/* Row 3: search bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 999, padding: '9px 14px' }}>
            <SearchIcon />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search stores or categories…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#374151', background: 'transparent', fontFamily: SYS }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        {/* ─── CONTENT ─── */}
        <div ref={contentRef} className="flex-1 overflow-y-auto no-scrollbar pb-20" style={{ background: BG, animation: `tabEnter 0.25s ease` }}>
          {isLoading && activeTab === 'home' ? <SkeletonHome /> : activeTab === 'home' && (
            <HomeScreen tagData={tagData} filters={filters} activeFilter={activeFilter} setActiveFilter={setActiveFilter}
              searchQuery={searchQuery} setSearchQuery={setSearchQuery} setReviewStore={openReviewStore} ix={ix} reservations={reservations} />
          )}
          {isLoading && activeTab === 'stores' ? <SkeletonBrowse /> : activeTab === 'stores' && <BrowseScreen tagData={tagData} setReviewStore={openReviewStore} ix={ix} handleReserve={handleReserve} searchQuery={searchQuery} />}
          {activeTab === 'profile' && <ProfileScreen ecoPoints={ecoPoints} lifetimePoints={lifetimePoints} bagsSaved={bagsReservedCount} activityFeed={activityFeed} setActiveTab={switchTab} lastImpactData={lastImpactData} onOpenRewards={() => setShowRewardsShop(true)} reservations={reservations} updateReservationStatus={updateReservationStatus} onOpenStore={setSelectedStore} />}
          {isLoading && activeTab === 'quest' ? <SkeletonQuest /> : activeTab === 'quest' && <QuestScreen xpAnimated={xpAnimated} ecoPoints={ecoPoints} lifetimePoints={lifetimePoints} claimedQuests={claimedQuests} handleClaim={handleClaim} questProgress={questProgress} onOpenRewards={() => setShowRewardsShop(true)} />}
          {isLoading && activeTab === 'favourites' ? <SkeletonFavourites /> : activeTab === 'favourites' && <FavouritesScreen favourites={favourites} ix={ix} setReviewStore={openReviewStore} reservations={reservations} />}

        </div>

        {/* ─── BOTTOM NAV ─── */}
        <div className="absolute bottom-0 left-0 right-0"
          style={{ background: '#fff', borderTop: '1px solid #F3F4F6', paddingTop: 0, paddingBottom: 14, zIndex: 30 }}>
          {/* Sliding indicator */}
          <div style={{ position: 'relative', height: 2.5 }}>
            <div style={{
              position: 'absolute', top: 0, height: '100%', width: `${100 / tabs.length}%`,
              left: `${(tabs.findIndex(t => t.key === activeTab) / tabs.length) * 100}%`,
              transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex', justifyContent: 'center',
            }}>
              <div style={{ width: 28, height: '100%', borderRadius: 999, background: DARK_TEAL }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', paddingTop: 6 }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.key;
              const TabIcon = tab.icon;
              return (
                <button key={tab.key} id={`tab-${tab.key}`} onClick={() => { haptic(5); switchTab(tab.key); }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', minWidth: 0,
                    transform: isActive ? 'scale(1.08)' : 'scale(1)',
                    transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}>
                  <TabIcon active={isActive} />
                  <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 400, color: isActive ? DARK_TEAL : INACTIVE, fontFamily: SYS, lineHeight: 1, transition: 'color 0.2s' }}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── iOS-STYLE NOTIFICATION BANNER ─── */}
        <div
          className="absolute left-0 right-0 px-2"
          style={{
            top: 0,
            zIndex: 9998,
            transform: showNotif ? 'translateY(0)' : 'translateY(-120%)',
            opacity: showNotif ? 1 : 0,
            transition: 'transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease',
            pointerEvents: showNotif ? 'auto' : 'none',
          }}
          onTouchStart={e => { notifTouchY.current = e.touches[0].clientY; }}
          onTouchMove={e => {
            if (notifTouchY.current === null) return;
            const dy = e.touches[0].clientY - notifTouchY.current;
            if (dy < -30) { dismissNotif(); notifTouchY.current = null; }
          }}
          onTouchEnd={() => { notifTouchY.current = null; }}
        >
          {(() => {
            const bags = bagCounts[notifStore?.id] ?? notifStore?.bags;
            const msg = notifType?.getMsg?.(notifStore || stores[0], bags) || { title: notifStore?.name, body: '', cta: 'View' };
            return (
              <div
                onClick={() => { dismissNotif(); setSelectedStore(notifStore); }}
                style={{
                  background: 'rgba(249,249,249,0.97)',
                  backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  borderRadius: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.05)',
                  padding: '12px 14px', marginTop: 8, cursor: 'pointer',
                }}
              >
                {/* iOS header row: app icon + app name + timestamp */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <img src="/stores/tgtg-logo.svg.png" alt="Too Good To Go" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain' }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#8E8E93', fontFamily: SYS, letterSpacing: '0.01em', flex: 1 }}>Too Good To Go</span>
                  <span style={{ fontSize: 12, color: '#8E8E93', fontFamily: SYS }}>now</span>
                </div>
                {/* Notification content */}
                <p style={{ fontSize: 14, fontWeight: 600, color: '#000', fontFamily: SYS, lineHeight: 1.3, marginBottom: 2 }}>
                  {msg.title}
                </p>
                <p style={{ fontSize: 13, color: '#3C3C43', fontFamily: SYS, lineHeight: 1.35, opacity: 0.8 }}>
                  {msg.body}
                </p>
              </div>
            );
          })()}
        </div>

        {/* ─── STORE DETAIL SHEET ─── */}
        {selectedStore && (
          <StoreDetailSheet
            store={selectedStore} tagData={tagData} bagCounts={bagCounts}
            onClose={() => setSelectedStore(null)} onReserve={handleReserve} ix={ix}
            setReviewStore={openReviewStore}
          />
        )}

        {/* ─── TAG MODAL ─── */}
        {reviewStore && (
          <div className="absolute inset-0 z-40 flex flex-col justify-end" style={{ opacity: reviewClosing ? 0 : 1, transition: 'opacity 0.28s ease' }}>
            <div className="absolute inset-0 bg-black/30" onClick={closeReview} />
            <div style={{ position: 'relative', background: '#fff', borderRadius: '24px 24px 0 0', padding: '0 20px 28px', zIndex: 50, animation: reviewClosing ? 'none' : 'slideUp 0.35s ease-out', transform: reviewClosing ? 'translateY(100%)' : 'translateY(0)', transition: 'transform 0.28s ease' }}>
              <div style={{ width: 40, height: 4, background: '#D1D5DB', borderRadius: 999, margin: '12px auto 0' }} />
              {showSubmitSuccess ? (
                <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
                  <p style={{ fontSize: 52, marginBottom: 10 }}>🎉</p>
                  <p style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4, fontFamily: SYS }}>Thanks for tagging!</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: TEAL, fontFamily: SYS }}>+15 Eco-Points</p>
                </div>
              ) : (
                <>
                  <div style={{ padding: '16px 0 12px', borderBottom: '1px solid #F3F4F6', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 700, color: '#111827', fontFamily: SYS }}>Tag your bag</h3>
                    <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2, fontFamily: SYS }}>{reviewStore.emoji} {reviewStore.name}</p>
                    <p style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 3, fontFamily: SYS }}>🌍 Your tags help 200+ people in St. Gallen decide</p>
                    <p style={{ fontSize: 11, color: TEAL, fontWeight: 500, marginTop: 4, fontFamily: SYS }}>✓ Verified purchase · based on your reservation today</p>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8, fontFamily: SYS }}>What was in your bag?</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {TAG_KEYS.map(tag => {
                      const active = selectedTags.includes(tag);
                      return (
                        <button key={tag} data-tag={tag}
                          onClick={() => setSelectedTags(p => active ? p.filter(t => t !== tag) : [...p, tag])}
                          style={{ padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500, border: `1.5px solid ${active ? 'transparent' : '#E5E7EB'}`, background: active ? TEAL : '#fff', color: active ? '#fff' : '#6B7280', cursor: 'pointer', fontFamily: SYS, transition: 'all 0.15s' }}>
                          {TAG_LABELS[tag]}
                        </button>
                      );
                    })}
                  </div>
                  <button id="submit-review-btn" disabled={!selectedTags.length} onClick={handleSubmitReview}
                    style={{ width: '100%', padding: '14px 0', borderRadius: 16, fontSize: 14, fontWeight: 700, border: 'none', cursor: selectedTags.length ? 'pointer' : 'not-allowed', background: TEAL, color: '#fff', opacity: !selectedTags.length ? 0.4 : 1, fontFamily: SYS, transition: 'opacity 0.2s' }}>
                    Submit (+15 pts)
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ─── REWARDS SHOP ─── */}
        {showRewardsShop && (
          <RewardsShop
            ecoPoints={ecoPoints} lifetimePoints={lifetimePoints}
            redeemedRewards={redeemedRewards} redeemReward={redeemReward}
            onClose={() => setShowRewardsShop(false)}
          />
        )}

        {/* ─── ONBOARDING ─── */}
        {showOnboarding && <OnboardingScreen onDone={() => { localStorage.setItem('tgtg_onboarded', '1'); setShowOnboarding(false); }} />}

        {/* ─── BADGE UNLOCK ─── */}
        {unlockedBadge && <BadgeUnlockModal badge={unlockedBadge} onClose={() => setUnlockedBadge(null)} />}

        {/* ─── IMPACT CARD (only show when detail sheet is NOT open — detail sheet handles its own impact flow) ─── */}
        {impactStore && !selectedStore && (
          <ImpactCard store={impactStore} bagsTotal={bagsReservedCount} onClose={() => setImpactStore(null)} />
        )}

        {/* ─── CONFETTI ─── */}
        {showConfetti && <canvas ref={confettiRef} id="confetti-canvas" width={375} height={812} className="absolute inset-0 z-[60] pointer-events-none" />}

        {/* ─── UNDO TOAST ─── */}
        {undoToast && !selectedStore && (
          <div style={{
            position: 'absolute', bottom: 68, left: 16, right: 16, zIndex: 55,
            background: '#1F2937', borderRadius: 14, padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            animation: 'fadeIn 0.25s ease', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            <span style={{ fontSize: 13, color: '#fff', fontFamily: SYS }}>
              Reserved {undoToast.store.name}
            </span>
            <button onClick={handleUndo} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#5BAD92', fontSize: 13, fontWeight: 700, fontFamily: SYS,
            }}>Undo</button>
          </div>
        )}

        {/* ─── LOCATION TOAST ─── */}
        {locationToast && (
          <div style={{
            position: 'absolute', bottom: 68, left: 16, right: 16, zIndex: 55,
            background: '#1F2937', borderRadius: 14, padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 8,
            animation: 'fadeIn 0.25s ease', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            <span style={{ fontSize: 18 }}>📍</span>
            <span style={{ fontSize: 13, color: '#fff', fontFamily: SYS }}>
              Only St. Gallen is available in this version
            </span>
          </div>
        )}

        {/* ─── FLOATING POINTS ─── */}
        {floatingPts.map(f => (
          <div key={f.id} style={{ position: 'absolute', top: 105, right: 68, fontSize: 12, fontWeight: 700, color: '#fff', animation: 'floatUp 0.85s ease-out forwards', zIndex: 60, pointerEvents: 'none', fontFamily: SYS, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
            +{f.amt} pts
          </div>
        ))}

        {/* ─── DAILY LOGIN BONUS ─── */}
        {loginBonus && (
          <div style={{
            position: 'absolute', top: 160, right: 16, zIndex: 55,
            background: `linear-gradient(135deg, ${TEAL}, ${DARK_TEAL})`, borderRadius: 14,
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            animation: 'bonusSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <span style={{ fontSize: 22 }}>🌱</span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: SYS }}>Daily Bonus!</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', fontFamily: SYS }}>+5 Eco-Points</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   SECTION HEADER HELPER
   ══════════════════════════════════ */
function Section({ title, children, seeAll = true, subtitle }) {
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef(null);
  const handleSeeAll = () => { clearTimeout(hintTimer.current); setShowHint(true); hintTimer.current = setTimeout(() => setShowHint(false), 2500); };
  return (
    <div style={{ marginTop: 20, marginBottom: 4, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 19, fontWeight: 700, color: '#111827', fontFamily: SYS }}>{title}</h2>
          {subtitle && <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, fontFamily: SYS }}>⏱ {subtitle}</p>}
        </div>
        {seeAll && <button onClick={handleSeeAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEAL, fontSize: 13, fontWeight: 500, fontFamily: SYS }}>See all ›</button>}
      </div>
      {showHint && (
        <div style={{ position: 'absolute', top: 0, right: 16, background: '#1F2937', color: '#fff', fontSize: 11, fontFamily: SYS, padding: '6px 12px', borderRadius: 8, zIndex: 10, animation: 'fadeIn 0.2s ease', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          Coming soon
        </div>
      )}
      {children}
    </div>
  );
}

/* ══════════════════════════════════
   HOME SCREEN
   ══════════════════════════════════ */
function HomeScreen({ tagData, filters, activeFilter, setActiveFilter, searchQuery, setSearchQuery, setReviewStore, ix, reservations = [] }) {
  const filter = s => matchesFilter(s, activeFilter, tagData, ix.bagCounts, ix.nowMins) && matchesSearch(s, searchQuery);
  const recommended = stores.filter(s => s.section === 'recommended').filter(filter);
  const saveSoon = stores.filter(s => s.section === 'save_soon').filter(filter);
  const nearby = stores.filter(s => s.section === 'nearby').filter(filter);
  const noResults = !recommended.length && !saveSoon.length && !nearby.length;

  /* Pull-to-refresh */
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const pullStartY = useRef(null);
  const containerRef = useRef(null);

  const onPullStart = (e) => { if (containerRef.current?.scrollTop === 0) pullStartY.current = e.touches[0].clientY; };
  const onPullMove = (e) => {
    if (pullStartY.current === null || refreshing) return;
    const dy = Math.max(0, e.touches[0].clientY - pullStartY.current);
    setPullY(Math.min(dy * 0.4, 60));
  };
  const onPullEnd = () => {
    pullStartY.current = null;
    if (pullY > 45 && !refreshing) {
      setRefreshing(true);
      haptic(15);
      setTimeout(() => { setRefreshing(false); setRefreshDone(true); setTimeout(() => { setRefreshDone(false); setPullY(0); }, 600); }, 800);
    } else {
      setPullY(0);
    }
  };

  const cardRow = (list) => (
    <div className="no-scrollbar" style={{ display: 'flex', overflowX: 'auto', padding: '0 16px 4px', scrollSnapType: 'x mandatory' }}>
      {list.map(s => <StoreCardWide key={s.id} store={s} tagData={tagData} setReviewStore={setReviewStore} ix={ix} />)}
    </div>
  );

  return (
    <div
      ref={containerRef}
      onTouchStart={onPullStart}
      onTouchMove={onPullMove}
      onTouchEnd={onPullEnd}
      style={{ paddingTop: 2, paddingBottom: 8 }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullY > 0 || refreshing || refreshDone) && (
        <div style={{
          height: refreshing || refreshDone ? 40 : pullY,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: refreshing ? 'none' : 'height 0.15s ease',
          overflow: 'hidden',
        }}>
          <span style={{
            fontSize: 18,
            animation: refreshing ? 'spin 0.8s linear infinite' : refreshDone ? 'none' : 'none',
            opacity: pullY > 20 || refreshing || refreshDone ? 1 : pullY / 20,
          }}>{refreshDone ? '✓' : '🌿'}</span>
        </div>
      )}
      {/* Weekly summary card */}
      <div style={{ margin: '12px 16px 0', background: `linear-gradient(135deg, ${TEAL} 0%, ${DARK_TEAL} 100%)`, borderRadius: 16, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -20, right: -10, fontSize: 64, opacity: 0.1, transform: 'rotate(-15deg)' }}>🌍</div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginBottom: 6, fontFamily: SYS }}>YOUR WEEK SO FAR</p>
        <div style={{ display: 'flex', gap: 16 }}>
          {(() => {
            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
            const weekBags = reservations.filter(r => new Date(r.reservedAt) >= weekAgo).length;
            const co2 = (weekBags * 2.5).toFixed(1);
            const saved = weekBags * 8;
            return [
              { val: String(weekBags), label: 'bags saved', icon: '🛍️' },
              { val: `${co2}kg`, label: 'CO₂ avoided', icon: '🌫️' },
              { val: `CHF ${saved}`, label: 'saved', icon: '💰' },
            ];
          })().map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>{s.icon}</span>
              <div>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: SYS, lineHeight: 1 }}>{s.val}</p>
                <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', fontFamily: SYS }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter pills */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 16px 6px' }}>
        {filters.map(f => (
          <button key={f} onClick={() => setActiveFilter(f)} style={{
            padding: '5px 14px', borderRadius: 999,
            border: `1.5px solid ${activeFilter === f ? DARK_TEAL : '#E5E7EB'}`,
            background: activeFilter === f ? DARK_TEAL : 'transparent',
            color: activeFilter === f ? '#fff' : '#374151',
            fontSize: 13, fontWeight: activeFilter === f ? 600 : 400,
            whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0, fontFamily: SYS,
            transition: 'all 0.15s ease',
          }}>{f}</button>
        ))}
      </div>

      {noResults ? (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <span style={{ fontSize: 36 }}>🔍</span>
          </div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 6, fontFamily: SYS }}>
            No results{searchQuery ? ` for "${searchQuery}"` : ''}
          </p>
          <p style={{ fontSize: 13, color: '#9CA3AF', fontFamily: SYS, marginBottom: 16, lineHeight: 1.5 }}>Try a different search or filter to find surprise bags near you.</p>
          {(searchQuery || activeFilter !== 'All') && (
            <button onClick={() => { setSearchQuery(''); setActiveFilter('All'); }} style={{ padding: '9px 20px', borderRadius: 999, background: '#F3F4F6', color: '#374151', fontWeight: 600, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: SYS }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {recommended.length > 0 && <Section title="Recommended for you">{cardRow(recommended)}</Section>}
          {saveSoon.length > 0 && <Section title="Save before it's too late">{cardRow(saveSoon)}</Section>}
          {nearby.length > 0 && <Section title="Nearby">{cardRow(nearby)}</Section>}
        </>
      )}

      {/* Classmate feed */}
      <Section title="👥 Friends Saving Now" seeAll={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
          {CLASSMATE_FEED.map(item => (
            <div key={item.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #F3F4F6', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{item.avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, color: '#111827', fontFamily: SYS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{item.name}</strong> saved a bag from <strong>{item.store}</strong></p>
                <p style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS }}>{item.time}</p>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, fontFamily: SYS, flexShrink: 0 }}>+{item.pts} pts</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════
   BROWSE SCREEN
   ══════════════════════════════════ */
function BrowseScreen({ tagData, setReviewStore, ix, handleReserve, searchQuery }) {
  const [sortKey, setSortKey] = useState('distance');
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewMode] = useState('map'); // 'list' | 'map'

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sorted = [...stores].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === 'distance') return (a.distanceNum - b.distanceNum) * dir;
    if (sortKey === 'price') return (a.price - b.price) * dir;
    if (sortKey === 'rating') return (a.rating - b.rating) * dir;
    if (sortKey === 'closing') return (parseMins(a.collectTimeEnd) - parseMins(b.collectTimeEnd)) * dir;
    return 0;
  });

  const sortBtn = (key, label) => {
    const active = sortKey === key;
    const arrow = active ? (sortAsc ? ' ↑' : ' ↓') : ' ↕';
    return (
      <button
        key={key}
        onClick={() => handleSort(key)}
        style={{
          padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: active ? 700 : 500,
          border: `1.5px solid ${active ? TEAL : '#E5E7EB'}`,
          background: active ? TEAL + '15' : 'transparent',
          color: active ? TEAL : '#374151', cursor: 'pointer', fontFamily: SYS, whiteSpace: 'nowrap',
        }}
      >{label}{arrow}</button>
    );
  };



  return (
    <div style={{ padding: '16px 16px 8px' }}>
      {/* Sort + view toggle row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9CA3AF', fontFamily: SYS, alignSelf: 'center' }}>Sort:</span>
          {sortBtn('distance', 'Distance')}
          {sortBtn('price', 'Price')}
          {sortBtn('rating', 'Rating')}
          {sortBtn('closing', 'Closing')}
        </div>
        <div style={{ display: 'flex', border: '1px solid #E5E7EB', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
          {[['map', '🗺 Map'], ['list', '☰ List']].map(([mode, label]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: viewMode === mode ? DARK_TEAL : '#fff', color: viewMode === mode ? '#fff' : '#6B7280', transition: 'all 0.15s', fontFamily: SYS }}>{label}</button>
          ))}
        </div>
      </div>

      {viewMode === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map(s => <BrowseListItem key={s.id} store={s} ix={ix} setReviewStore={setReviewStore} />)}
        </div>
      ) : (
        <LeafletMap ix={ix} tagData={tagData} handleReserve={handleReserve} stores={stores} searchQuery={searchQuery} />
      )}
    </div>
  );
}

/* ══════════════════════════════════
   ECO-QUEST SCREEN
   ══════════════════════════════════ */
function QuestScreen({ xpAnimated, ecoPoints, lifetimePoints, claimedQuests, handleClaim, questProgress, onOpenRewards }) {
  const level = Math.floor(ecoPoints / 500) + 1;
  const ptsInLevel = ecoPoints % 500;
  const pctLevel = Math.round((ptsInLevel / 500) * 100);
  const ptsToNext = 500 - ptsInLevel;
  const [resetStr, setResetStr] = useState(getWeeklyReset);
  useEffect(() => {
    const id = setInterval(() => setResetStr(getWeeklyReset()), 60000);
    return () => clearInterval(id);
  }, []);

  // Live leaderboard (update "You" row with lifetime points — not spendable ecoPoints)
  const origRanks = Object.fromEntries(leaderboard.map(e => [e.name, e.rank]));
  const liveBoard = [...leaderboard]
    .map(e => e.isYou ? { ...e, points: lifetimePoints } : e)
    .sort((a, b) => b.points - a.points)
    .map((e, i) => ({ ...e, rank: i + 1, prevRank: origRanks[e.name] || i + 1 }));

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      {/* Level card with circular progress */}
      <div style={{ background: TEAL, borderRadius: 20, padding: '20px 20px 16px', color: '#fff', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Circular ring */}
          <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
            <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="6" />
              <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 38}`}
                strokeDashoffset={xpAnimated ? `${2 * Math.PI * 38 * (1 - pctLevel / 100)}` : `${2 * Math.PI * 38}`}
                style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, fontFamily: SYS }}>{level}</p>
              <p style={{ fontSize: 8, color: 'rgba(255,255,255,0.7)', fontFamily: SYS, marginTop: 2 }}>LEVEL</p>
            </div>
          </div>
          {/* Info */}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, fontFamily: SYS, marginBottom: 2 }}>{getLevelName(level)}</p>
            <p style={{ fontSize: 22, fontWeight: 900, lineHeight: 1, fontFamily: SYS }}>{ecoPoints.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.7 }}>pts</span></p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 6, fontFamily: SYS }}>{ptsToNext} pts to Level {level + 1}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: SYS }}>
            {getTier(lifetimePoints).emoji} {getTier(lifetimePoints).name} Tier
          </p>
          <button onClick={onOpenRewards} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 999,
            padding: '5px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: SYS }}>🎁 Spend Points</span>
          </button>
        </div>
      </div>

      {/* Badges */}
      <Section title="🏅 Badges">
        <div className="no-scrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 16px 4px', scrollSnapType: 'x mandatory' }}>
          {badges.map(b => (
            <div key={b.id} style={{ flexShrink: 0, scrollSnapAlign: 'start', width: 76, background: '#fff', borderRadius: 16, border: b.earned ? `1.5px solid ${TEAL}` : '1.5px solid #E5E7EB', padding: '10px 8px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', opacity: b.earned ? 1 : 0.55, filter: b.earned ? 'none' : 'grayscale(0.8)' }}>
              <span style={{ fontSize: 28, display: 'block' }}>{b.earned ? b.emoji : '🔒'}</span>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#111827', marginTop: 5, lineHeight: 1.3, fontFamily: SYS }}>{b.name}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Active Quests */}
      <Section title="🎯 Active Quests" seeAll={false} subtitle={`Resets in ${resetStr}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px' }}>
          {quests.map(q => {
            const progress = questProgress[q.id] ?? 0;
            const completed = progress >= q.total;
            const claimed = claimedQuests.includes(q.id);
            return (
              <div key={q.id} data-quest-id={q.id} style={{ background: completed && !claimed ? '#F0FDF4' : '#fff', borderRadius: 16, border: '1px solid #F3F4F6', padding: '14px 14px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 26, lineHeight: 1.2 }}>{q.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <h4 style={{ fontWeight: 700, fontSize: 13, color: '#111827', fontFamily: SYS }}>{q.title}</h4>
                      <span style={{ fontSize: 12, fontWeight: 600, color: TEAL, fontFamily: SYS }}>+{q.points} pts</span>
                    </div>
                    <p style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 8, fontFamily: SYS }}>{q.description}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (progress / q.total) * 100)}%`, background: TEAL, borderRadius: 999, transition: 'width 0.5s ease' }} />
                      </div>
                      <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS, flexShrink: 0 }}>{progress}/{q.total}</span>
                    </div>
                  </div>
                </div>
                {completed && (
                  <button data-claim-btn={q.id} disabled={claimed} onClick={() => !claimed && handleClaim(q)}
                    style={{ marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 999, fontSize: 12, fontWeight: 700, border: 'none', cursor: claimed ? 'default' : 'pointer', background: claimed ? '#F3F4F6' : TEAL, color: claimed ? '#9CA3AF' : '#fff', fontFamily: SYS }}>
                    {claimed ? '✓ Claimed' : 'Claim'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Leaderboard */}
      <Section title="🏆 Weekly Leaderboard" seeAll={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
          {liveBoard.map(entry => (
            <div key={entry.rank} style={{ background: entry.isYou ? '#F0FDF4' : '#fff', borderRadius: 12, border: '1px solid #F3F4F6', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: entry.rank === 1 ? TEAL : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: entry.rank === 1 ? '#fff' : '#6B7280', fontFamily: SYS }}>
                {entry.rank}
              </div>
              <span style={{ flex: 1, fontSize: 13, fontFamily: SYS, fontWeight: entry.isYou ? 700 : 400, color: entry.isYou ? TEAL : '#111827' }}>{entry.name}</span>
              {entry.prevRank > entry.rank && <span style={{ fontSize: 10, color: '#22C55E', fontWeight: 700, fontFamily: SYS }}>↑</span>}
              {entry.prevRank < entry.rank && <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 700, fontFamily: SYS }}>↓</span>}
              <span style={{ fontSize: 12, color: '#9CA3AF', fontFamily: SYS }}>{entry.points.toLocaleString()} pts</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════
   FAVOURITES SCREEN
   ══════════════════════════════════ */
function FavouritesScreen({ favourites, ix, setReviewStore, reservations = [] }) {
  const favedStores = stores.filter(s => favourites.has(s.id));
  const activeResBagIds = new Set(reservations.filter(r => r.status === 'reserved' || r.status === 'ready').map(r => r.bagId));
  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, color: '#111827', marginBottom: 12, fontFamily: SYS }}>Favourites</h2>
      {favedStores.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <span style={{ fontSize: 44 }}>🤍</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 6, fontFamily: SYS }}>No favourites yet</p>
          <p style={{ fontSize: 13, color: '#9CA3AF', fontFamily: SYS, marginBottom: 20, lineHeight: 1.5 }}>Tap the heart on any store to save it here for quick access.</p>
          <button
            onClick={() => ix.switchTab && ix.switchTab('home')}
            style={{ padding: '10px 24px', borderRadius: 999, background: TEAL, color: '#fff', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: SYS }}
          >Browse stores</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {favedStores.map(s => (
            <div key={s.id} style={{ position: 'relative' }}>
              <BrowseListItem store={s} ix={ix} setReviewStore={setReviewStore} />
              {activeResBagIds.has(s.id) && (
                <div style={{ position: 'absolute', top: 8, right: 8, background: '#D1FAE5', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: '#065F46', fontFamily: SYS }}>
                  Reserved
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════
   STREAK CALENDAR — GitHub-style heatmap
   ══════════════════════════════════ */
function StreakCalendar() {
  // Generate mock data for last 28 days (4 weeks)
  const today = new Date();
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (27 - i));
    // Mock: more activity on recent days, random pattern
    const seed = (d.getDate() * 7 + d.getMonth() * 31) % 10;
    const bags = i > 20 ? (seed > 3 ? seed > 6 ? 3 : 2 : seed > 1 ? 1 : 0) : (seed > 5 ? 2 : seed > 3 ? 1 : 0);
    return { date: d, bags, isToday: i === 27 };
  });
  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const streak = (() => { let c = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i].bags > 0) c++; else break; } return c; })();

  const getColor = (bags) => {
    if (bags === 0) return '#F3F4F6';
    if (bags === 1) return TEAL + '40';
    if (bags === 2) return TEAL + '80';
    return TEAL;
  };

  return (
    <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', fontFamily: SYS }}>🔥 Saving Streak</h3>
        <span style={{ fontSize: 12, fontWeight: 700, color: TEAL, fontFamily: SYS }}>{streak} day{streak !== 1 ? 's' : ''}</span>
      </div>
      {/* Week day labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {weekDays.map((d, i) => (
          <span key={i} style={{ fontSize: 9, color: '#9CA3AF', textAlign: 'center', fontFamily: SYS }}>{d}</span>
        ))}
      </div>
      {/* Calendar grid — 4 rows of 7 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {days.map((d, i) => (
          <div key={i} style={{
            aspectRatio: '1', borderRadius: 6,
            background: getColor(d.bags),
            border: d.isToday ? `2px solid ${DARK_TEAL}` : 'none',
            animation: d.bags > 0 ? `cellPop 0.3s ease ${i * 0.02}s both` : 'none',
            position: 'relative',
          }}>
            {d.isToday && <span style={{ position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)', fontSize: 6, color: DARK_TEAL, fontWeight: 700, fontFamily: SYS }}>today</span>}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 8 }}>
        <span style={{ fontSize: 9, color: '#9CA3AF', fontFamily: SYS }}>Less</span>
        {[0, 1, 2, 3].map(n => (
          <div key={n} style={{ width: 10, height: 10, borderRadius: 3, background: getColor(n) }} />
        ))}
        <span style={{ fontSize: 9, color: '#9CA3AF', fontFamily: SYS }}>More</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   REWARDS SHOP — full-screen modal
   ══════════════════════════════════ */
function RewardsShop({ ecoPoints, lifetimePoints, redeemedRewards, redeemReward, onClose }) {
  const [closing, setClosing] = useState(false);
  const animClose = useCallback(() => { setClosing(true); setTimeout(onClose, 280); }, [onClose]);
  const [confirmingId, setConfirmingId] = useState(null);
  const [justRedeemed, setJustRedeemed] = useState(null);
  const tier = getTier(lifetimePoints);
  const nextTier = getNextTier(lifetimePoints);
  const tierPct = nextTier ? Math.min(100, Math.round(((lifetimePoints - tier.minPts) / (nextTier.minPts - tier.minPts)) * 100)) : 100;

  const categories = [
    { key: 'discount', label: 'Discounts', emoji: '🏷️' },
    { key: 'perk', label: 'Perks', emoji: '⚡' },
    { key: 'impact', label: 'Impact', emoji: '🌍' },
  ];
  const [activeCategory, setActiveCategory] = useState('discount');

  const handleRedeem = (reward) => {
    if (ecoPoints < reward.cost) return;
    if (confirmingId === reward.id) {
      redeemReward(reward.id, reward.cost);
      setConfirmingId(null);
      setJustRedeemed(reward.id);
      haptic(25);
      setTimeout(() => setJustRedeemed(null), 2000);
    } else {
      setConfirmingId(reward.id);
      haptic(10);
      setTimeout(() => setConfirmingId(null), 3000);
    }
  };

  const filteredRewards = REWARDS.filter(r => r.category === activeCategory);
  const redeemCount = (id) => redeemedRewards.filter(r => r.id === id).length;

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: BG, opacity: closing ? 0 : 1, transform: closing ? 'translateY(30px)' : 'translateY(0)', transition: 'opacity 0.28s ease, transform 0.28s ease', animation: closing ? 'none' : 'slideUp 0.3s ease-out' }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(160deg, ${TEAL} 0%, #4A9A7E 100%)`, padding: '14px 20px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={animClose} style={{ background: 'rgba(255,255,255,0.18)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#fff', fontFamily: SYS }}>Rewards Shop</h2>
          <div style={{ width: 32 }} />
        </div>

        {/* Points balance */}
        <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: '14px 16px', backdropFilter: 'blur(8px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: SYS, marginBottom: 2 }}>Available Points</p>
              <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: SYS, lineHeight: 1 }}>{ecoPoints.toLocaleString()}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: SYS, marginBottom: 2 }}>Your Tier</p>
              <p style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: SYS }}>{tier.emoji} {tier.name}</p>
            </div>
          </div>
          {/* Tier progress */}
          {nextTier && (
            <div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 999, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ height: '100%', width: `${tierPct}%`, background: '#fff', borderRadius: 999, transition: 'width 0.5s ease' }} />
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontFamily: SYS, textAlign: 'right' }}>
                {nextTier.minPts - lifetimePoints} pts to {nextTier.emoji} {nextTier.name}
              </p>
            </div>
          )}
          {!nextTier && (
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontFamily: SYS }}>You've reached the highest tier!</p>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 16px 8px' }}>
        {categories.map(cat => (
          <button key={cat.key} onClick={() => setActiveCategory(cat.key)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: activeCategory === cat.key ? DARK_TEAL : '#fff',
              color: activeCategory === cat.key ? '#fff' : '#6B7280',
              fontSize: 12, fontWeight: 600, fontFamily: SYS,
              boxShadow: activeCategory === cat.key ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'all 0.2s',
            }}>
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* Tier perk banner */}
      {tier.bonusPct > 0 && (
        <div style={{ margin: '4px 16px 8px', background: '#F0FDF4', borderRadius: 12, padding: '10px 14px', border: `1px solid ${TEAL}33`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{tier.emoji}</span>
          <p style={{ fontSize: 11, color: '#15803D', fontFamily: SYS, fontWeight: 500 }}>
            <strong>{tier.name} perk:</strong> {tier.perk}
          </p>
        </div>
      )}

      {/* Rewards list */}
      <div className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: '0 16px 80px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredRewards.map(reward => {
            const canAfford = ecoPoints >= reward.cost;
            const isConfirming = confirmingId === reward.id;
            const wasRedeemed = justRedeemed === reward.id;
            const count = redeemCount(reward.id);
            return (
              <div key={reward.id} style={{
                background: wasRedeemed ? '#F0FDF4' : '#fff',
                borderRadius: 16, border: wasRedeemed ? `1.5px solid ${TEAL}` : '1px solid #F3F4F6',
                padding: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
                transition: 'all 0.3s',
                animation: wasRedeemed ? 'cardPress 0.3s ease' : 'none',
              }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  {/* Emoji circle */}
                  <div style={{
                    width: 50, height: 50, borderRadius: 14, flexShrink: 0,
                    background: canAfford ? `${TEAL}15` : '#F3F4F6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                  }}>
                    {wasRedeemed ? '✅' : reward.emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <h4 style={{ fontWeight: 700, fontSize: 14, color: '#111827', fontFamily: SYS }}>{reward.name}</h4>
                      {count > 0 && (
                        <span style={{ fontSize: 10, color: TEAL, fontWeight: 600, fontFamily: SYS, background: `${TEAL}15`, padding: '2px 8px', borderRadius: 999 }}>
                          Redeemed {count}×
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: '#9CA3AF', fontFamily: SYS, marginBottom: 10, lineHeight: 1.4 }}>{reward.description}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: canAfford ? DARK_TEAL : '#9CA3AF', fontFamily: SYS }}>🌿 {reward.cost}</span>
                        <span style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS }}>pts</span>
                      </div>
                      <button
                        onClick={() => handleRedeem(reward)}
                        disabled={!canAfford || wasRedeemed}
                        style={{
                          padding: '7px 18px', borderRadius: 999, border: 'none', cursor: canAfford && !wasRedeemed ? 'pointer' : 'default',
                          background: wasRedeemed ? '#D1FAE5' : isConfirming ? '#EF4444' : canAfford ? TEAL : '#E5E7EB',
                          color: wasRedeemed ? TEAL : canAfford ? '#fff' : '#9CA3AF',
                          fontSize: 12, fontWeight: 700, fontFamily: SYS,
                          transition: 'all 0.2s', minWidth: 90,
                        }}>
                        {wasRedeemed ? 'Redeemed!' : isConfirming ? 'Confirm?' : canAfford ? 'Redeem' : 'Not enough'}
                      </button>
                    </div>
                    {!canAfford && (
                      <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS, marginTop: 6 }}>
                        Need {reward.cost - ecoPoints} more points
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   PROFILE / MORE SCREEN
   ══════════════════════════════════ */
function ProfileScreen({ ecoPoints, lifetimePoints, bagsSaved, activityFeed, setActiveTab, lastImpactData, onOpenRewards, reservations = [], updateReservationStatus, onOpenStore }) {
  const earnedBadges = badges.filter(b => b.earned);
  const [showLastImpact, setShowLastImpact] = useState(false);
  const [resExpanded, setResExpanded] = useState(() => reservations.some(r => r.status === 'reserved' || r.status === 'ready'));

  // Check for missed pickups
  const now = new Date();
  const getResStatus = (r) => {
    if (r.status === 'picked_up') return 'picked_up';
    if ((r.status === 'reserved' || r.status === 'ready') && new Date(r.pickupWindowEnd) < now) return 'missed';
    return r.status;
  };

  const activeRes = reservations.filter(r => {
    const s = getResStatus(r);
    return s === 'reserved' || s === 'ready';
  }).sort((a, b) => new Date(a.pickupWindowStart) - new Date(b.pickupWindowStart));

  const pastRes = reservations.filter(r => {
    const s = getResStatus(r);
    return s === 'picked_up' || s === 'missed';
  }).sort((a, b) => new Date(b.reservedAt) - new Date(a.reservedAt));

  const formatPickupTime = (start, end) => {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `Today, ${fmt(s)} – ${fmt(e)}`;
  };

  const getPickupLabel = (r) => {
    const s = new Date(r.pickupWindowStart);
    const e = new Date(r.pickupWindowEnd);
    if (now >= s && now <= e) return { text: 'Pick up NOW', highlight: true };
    if (now < s) {
      const diff = s - now;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      return { text: h > 0 ? `Pickup in ${h}h ${m}m` : `Pickup in ${m}m`, highlight: false };
    }
    return { text: 'Window passed', highlight: false };
  };

  const cycleStatus = (r) => {
    if (!updateReservationStatus) return;
    const order = ['reserved', 'ready', 'picked_up'];
    const idx = order.indexOf(r.status);
    const next = order[(idx + 1) % order.length];
    updateReservationStatus(r.id, next);
  };

  const statusBadge = (r) => {
    const s = getResStatus(r);
    const styles = {
      reserved: { bg: '#FEF3C7', color: '#92400E', text: 'Reserved' },
      ready: { bg: '#D1FAE5', color: '#065F46', text: 'Ready for Pickup' },
      picked_up: { bg: '#F3F4F6', color: '#6B7280', text: 'Picked Up' },
      missed: { bg: '#FEE2E2', color: '#DC2626', text: 'Missed Pickup' },
    };
    const st = styles[s] || styles.reserved;
    return (
      <button onClick={() => cycleStatus(r)} style={{
        background: st.bg, color: st.color, border: 'none', cursor: 'pointer',
        padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, fontFamily: SYS,
      }}>
        {st.text}
      </button>
    );
  };

  const ReservationCard = ({ r, muted }) => {
    const pickup = getPickupLabel(r);
    const storeObj = stores.find(s => s.id === r.bagId);
    return (
      <div
        onClick={() => storeObj && onOpenStore && onOpenStore(storeObj)}
        style={{
          background: '#fff', borderRadius: 16, border: '1px solid #F3F4F6',
          padding: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          opacity: muted ? 0.6 : 1, transition: 'opacity 0.2s',
          cursor: storeObj ? 'pointer' : 'default',
        }}>
        {/* Status badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          {statusBadge(r)}
          {!muted && pickup.highlight && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', background: '#D1FAE5', padding: '3px 8px', borderRadius: 999, fontFamily: SYS, animation: 'pulse 2s infinite' }}>
              {pickup.text}
            </span>
          )}
        </div>

        {/* Main card content */}
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Store image */}
          <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: '#F3F4F6' }}>
            {r.imageUrl
              ? <img src={r.imageUrl} alt={r.storeName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>{r.emoji || '🛒'}</div>
            }
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', fontFamily: SYS }}>{r.storeName}</p>
              <p style={{ fontSize: 14, fontWeight: 800, color: TEAL, fontFamily: SYS, flexShrink: 0 }}>CHF {r.price.toFixed(2)}</p>
            </div>
            <p style={{ fontSize: 12, color: '#6B7280', fontFamily: SYS, marginTop: 2 }}>
              {!muted ? formatPickupTime(r.pickupWindowStart, r.pickupWindowEnd) : new Date(r.reservedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
            {!muted && !pickup.highlight && (
              <p style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', fontFamily: SYS, marginTop: 2 }}>{pickup.text}</p>
            )}
          </div>
        </div>

        {/* Community tags */}
        {r.communityTags && r.communityTags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {r.communityTags.map(tag => (
              <span key={tag} style={{ padding: '3px 8px', borderRadius: 999, background: '#F0FDF4', border: `1px solid ${TEAL}22`, fontSize: 10, color: '#374151', fontFamily: SYS }}>{tag}</span>
            ))}
          </div>
        )}

        {/* Address + Directions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <p style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>📍 {r.storeAddress}</p>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.storeLatitude},${r.storeLongitude}`, '_blank'); }}
            style={{ padding: '5px 12px', borderRadius: 10, background: '#F3F4F6', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: TEAL, fontFamily: SYS, flexShrink: 0 }}
          >
            Get Directions
          </button>
        </div>

        {/* Demo controls */}
        {!muted && (
          <div style={{ marginTop: 8, borderTop: '1px solid #F3F4F6', paddingTop: 8, display: 'flex', gap: 8 }}>
            {r.status === 'reserved' && (
              <button onClick={(e) => { e.stopPropagation(); updateReservationStatus(r.id, 'ready'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#9CA3AF', fontFamily: SYS, padding: 0 }}>
                Simulate: Mark Ready →
              </button>
            )}
            {r.status === 'ready' && (
              <button onClick={(e) => { e.stopPropagation(); updateReservationStatus(r.id, 'picked_up'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#9CA3AF', fontFamily: SYS, padding: 0 }}>
                Simulate: Mark Picked Up →
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ paddingBottom: 8 }}>
      {/* My Reservations — collapsible */}
      <div style={{ margin: '16px 16px 0', background: '#fff', borderRadius: 16, border: '1px solid #F3F4F6', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <button
          onClick={() => setResExpanded(p => !p)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 17 }}>🛒</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111827', fontFamily: SYS }}>My Reservations</span>
            {activeRes.length > 0 && (
              <span style={{ background: TEAL, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, fontFamily: SYS }}>{activeRes.length} active</span>
            )}
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: resExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {resExpanded && (
          <div style={{ padding: '0 16px 14px' }}>
            {activeRes.length === 0 && pastRes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 13, color: '#9CA3AF', fontFamily: SYS, marginBottom: 10 }}>No reservations yet</p>
                <button onClick={() => setActiveTab('home')} style={{ padding: '8px 20px', borderRadius: 999, background: TEAL, color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: SYS }}>
                  Browse Stores
                </button>
              </div>
            ) : (
              <>
                {activeRes.length > 0 && (
                  <div style={{ marginBottom: pastRes.length > 0 ? 14 : 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: SYS }}>Active ({activeRes.length})</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {activeRes.map(r => <ReservationCard key={r.id} r={r} muted={false} />)}
                    </div>
                  </div>
                )}
                {pastRes.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, fontFamily: SYS }}>Past ({pastRes.length})</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {pastRes.map(r => <ReservationCard key={r.id} r={r} muted={true} />)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Profile card */}
      <div style={{ margin: '16px 16px 0', background: '#fff', borderRadius: 16, padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: TEAL + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 8px' }}>🌱</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', fontFamily: SYS }}>GreenUser42</h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', marginTop: 2, fontFamily: SYS }}>Eco-warrior since 2025</p>
        </div>
        <div style={{ display: 'flex', borderTop: '1px solid #F3F4F6', paddingTop: 16 }}>
          {[
            { value: bagsSaved, label: 'Bags Saved', color: '#111827' },
            { value: ecoPoints, label: 'Eco-Points', color: TEAL },
            { value: earnedBadges.length, label: 'Badges', color: '#111827' },
          ].map((stat, i, arr) => (
            <div key={stat.label} style={{ flex: 1, textAlign: 'center', borderRight: i < arr.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
              <p style={{ fontSize: 22, fontWeight: 900, color: stat.color, fontFamily: SYS }}>{stat.value}</p>
              <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tier & Rewards card */}
      {(() => {
        const tier = getTier(lifetimePoints);
        const nextTier = getNextTier(lifetimePoints);
        const tierPct = nextTier ? Math.min(100, Math.round(((lifetimePoints - tier.minPts) / (nextTier.minPts - tier.minPts)) * 100)) : 100;
        return (
          <div style={{ margin: '12px 16px 0', background: `linear-gradient(135deg, ${TEAL}18 0%, ${TEAL}08 100%)`, borderRadius: 16, padding: '16px', border: `1px solid ${TEAL}25`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 28 }}>{tier.emoji}</span>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', fontFamily: SYS }}>{tier.name} Tier</p>
                  <p style={{ fontSize: 11, color: '#6B7280', fontFamily: SYS }}>{tier.perk}</p>
                </div>
              </div>
              {tier.bonusPct > 0 && (
                <div style={{ background: TEAL, borderRadius: 999, padding: '4px 10px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: SYS }}>+{tier.bonusPct}%</span>
                </div>
              )}
            </div>
            {nextTier && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#6B7280', fontFamily: SYS }}>{tier.emoji} {tier.name}</span>
                  <span style={{ fontSize: 10, color: '#6B7280', fontFamily: SYS }}>{nextTier.emoji} {nextTier.name}</span>
                </div>
                <div style={{ height: 6, background: '#E5E7EB', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${tierPct}%`, background: TEAL, borderRadius: 999, transition: 'width 0.5s ease' }} />
                </div>
                <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS, marginTop: 4, textAlign: 'right' }}>
                  {nextTier.minPts - lifetimePoints} pts to next tier
                </p>
              </div>
            )}
            <button onClick={onOpenRewards} style={{
              width: '100%', padding: '11px 0', borderRadius: 14,
              background: TEAL, color: '#fff', border: 'none',
              fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: SYS,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              🎁 Open Rewards Shop
            </button>
          </div>
        );
      })()}

      {/* Streak calendar */}
      <StreakCalendar />

      {/* ─── Settings ─── */}
      {lastImpactData && (
        <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
          <button
            onClick={() => setShowLastImpact(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 14 }}>📊</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: TEAL, fontFamily: SYS, textDecoration: 'underline' }}>See Impact</span>
          </button>
        </div>
      )}

      {/* ─── Last Impact Recall Modal ─── */}
      {showLastImpact && lastImpactData && (
        <div
          onClick={() => setShowLastImpact(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 24, padding: '24px 20px', width: 290, textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', animation: 'slideUp 0.3s ease-out' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: TEAL, marginBottom: 4, fontFamily: SYS }}>YOUR LAST IMPACT</p>
            <h3 style={{ fontSize: 17, fontWeight: 900, color: '#111827', marginBottom: 16, fontFamily: SYS }}>{lastImpactData.store.name}</h3>
            <div style={{ background: '#F0FDF4', borderRadius: 16, padding: '14px 12px', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { icon: '🍽️', val: lastImpactData.bags, label: 'Meals saved' },
                { icon: '🌫️', val: `${(lastImpactData.bags * 2.5).toFixed(1)}kg`, label: 'CO₂ avoided' },
                { icon: '💰', val: `CHF ${(lastImpactData.bags * 8).toFixed(0)}`, label: 'Money saved' },
              ].map(s => (
                <div key={s.label}>
                  <p style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</p>
                  <p style={{ fontSize: 13, fontWeight: 900, color: '#111827', fontFamily: SYS }}>{s.val}</p>
                  <p style={{ fontSize: 9, color: '#9CA3AF', fontFamily: SYS }}>{s.label}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowLastImpact(false)} style={{ width: '100%', padding: '11px 0', borderRadius: 14, background: TEAL, color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: SYS }}>
              Got it 🌱
            </button>
          </div>
        </div>
      )}
      <Section title="🌍 Your Impact" seeAll={false}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '0 16px' }}>
          {[
            { icon: '🍽️', value: bagsSaved, label: 'Meals Rescued' },
            { icon: '💧', value: `${(bagsSaved * 120).toLocaleString()}L`, label: 'Water Saved' },
            { icon: '🌫️', value: `${(bagsSaved * 2.5).toFixed(1)}kg`, label: 'CO₂ Avoided' },
            { icon: '💰', value: `CHF ${(bagsSaved * 8).toLocaleString()}`, label: 'Money Saved' },
          ].map(item => (
            <div key={item.label} style={{ background: '#fff', borderRadius: 16, border: '1px solid #F3F4F6', padding: '16px 12px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 28, display: 'block' }}>{item.icon}</span>
              <p style={{ fontSize: 17, fontWeight: 900, color: '#111827', marginTop: 4, fontFamily: SYS }}>{item.value}</p>
              <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS }}>{item.label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* St. Gallen Community Impact */}
      <Section title="🌍 St. Gallen Community Impact" seeAll={false}>
        <div style={{ margin: '0 16px', background: '#fff', borderRadius: 16, border: '1px solid #F3F4F6', padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 14, fontFamily: SYS }}>Together in St. Gallen this week:</p>
          <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
            {[
              { val: '1,847', label: 'bags saved' },
              { val: '923kg', label: 'CO₂ prevented' },
              { val: '312', label: 'active savers' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 18, fontWeight: 900, color: TEAL, fontFamily: SYS }}>{item.val}</p>
                <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS }}>{item.label}</p>
              </div>
            ))}
          </div>
          <div style={{ height: 6, background: '#F3F4F6', borderRadius: 999, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{ height: '100%', width: '74%', background: TEAL, borderRadius: 999 }} />
          </div>
          <p style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS }}>74% of weekly community goal</p>
        </div>
      </Section>

      {/* Referral card */}
      <Section title="🎁 Invite Friends" seeAll={false}>
        <div style={{ margin: '0 16px', background: `linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)`, borderRadius: 16, padding: '16px 16px', border: '1px solid #FCD34D', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -8, right: 8, fontSize: 48, opacity: 0.15, transform: 'rotate(12deg)' }}>🎉</div>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 4, fontFamily: SYS }}>Give 50 pts, Get 50 pts</h4>
          <p style={{ fontSize: 12, color: '#A16207', marginBottom: 12, lineHeight: 1.4, fontFamily: SYS }}>Share your code with friends — when they save their first bag, you both earn 50 Eco-Points!</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 700, color: '#92400E', fontFamily: SYS, letterSpacing: '0.05em' }}>GREEN42-SG</div>
            <button
              onClick={() => {
                const text = 'Join me on Too Good To Go! Use my code GREEN42-SG to get 50 bonus points. 🌍';
                if (navigator.share) navigator.share({ text }).catch(() => {});
                else navigator.clipboard?.writeText('GREEN42-SG');
              }}
              style={{ padding: '8px 16px', borderRadius: 10, background: '#92400E', color: '#fff', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: SYS }}
            >Share</button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: 'rgba(146,64,14,0.15)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '40%', background: '#92400E', borderRadius: 999 }} />
            </div>
            <span style={{ fontSize: 10, color: '#A16207', fontFamily: SYS }}>2/5 friends joined</span>
          </div>
        </div>
      </Section>

      {/* Your Badges */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 12 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700, color: '#111827', fontFamily: SYS }}>🏅 Your Badges</h2>
          <button onClick={() => setActiveTab('quest')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEAL, fontSize: 12, fontWeight: 500, fontFamily: SYS }}>View all in Eco-Quest →</button>
        </div>
        <div className="no-scrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 16px 4px' }}>
          {earnedBadges.map(b => (
            <div key={b.id} style={{ flexShrink: 0, width: 76, background: '#fff', borderRadius: 16, border: `1.5px solid ${TEAL}`, padding: '10px 8px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 28, display: 'block' }}>{b.emoji}</span>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#111827', marginTop: 5, lineHeight: 1.3, fontFamily: SYS }}>{b.name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <Section title="🕐 Recent Activity" seeAll={false}>
        {activityFeed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF', fontSize: 13, fontFamily: SYS }}>No activity yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
            {activityFeed.map(item => (
              <div key={item.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #F3F4F6', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: SYS }}>{item.store}</p>
                  <p style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS }}>{item.tag}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {item.pts && <p style={{ fontSize: 11, fontWeight: 600, color: TEAL, fontFamily: SYS }}>{item.pts}</p>}
                  {!item.pts && <p style={{ fontSize: 11, color: '#9CA3AF', fontFamily: SYS }}>Reserved</p>}
                  <p style={{ fontSize: 10, color: '#9CA3AF', fontFamily: SYS }}>{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
