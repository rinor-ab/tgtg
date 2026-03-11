import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

/* ─── Fix Leaflet + Vite marker icon bug ─── */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const SYS = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const TEAL = '#5BAD92';
const DARK_TEAL = '#1A3C34';

/* ─── Store pin data with exact coordinates ─── */
const STORE_PINS = [
    { id: 'barista', name: 'Barista Specialty Coffee', emoji: '☕', coords: [47.4263, 9.3736], tags: ['☕ Coffee', '🥐 Pastries'], price: 'CHF 3.50', bags: 6, pickup: '16:00–17:00', walkMin: 4 },
    { id: 'migros_sg', name: 'Migros Marktplatz', emoji: '🛒', coords: [47.4253, 9.3781], tags: ['🥗 Veggie', '🧀 Dairy', '🥐 Bakery'], price: 'CHF 4.90', bags: 3, pickup: '18:30–20:00', walkMin: 3 },
    { id: 'roggwiller', name: 'Confiserie Roggwiller', emoji: '🍰', coords: [47.4244, 9.3756], tags: ['🍰 Cakes', '🥐 Bread', '🍫 Chocolate'], price: 'CHF 3.90', bags: 5, pickup: '17:00–18:00', walkMin: 2 },
    { id: 'coop_restaurant', name: 'Coop Restaurant Marktgasse', emoji: '🍽️', coords: [47.4241, 9.3771], tags: ['🍱 Hot Meal', '🥗 Veggie'], price: 'CHF 5.90', bags: 2, pickup: '19:30–21:00', walkMin: 3 },
    { id: 'praline_scherrer', name: 'Praliné Scherrer', emoji: '🍫', coords: [47.4243, 9.3767], tags: ['🍫 Chocolate', '🧁 Sweets'], price: 'CHF 4.50', bags: 4, pickup: '17:30–18:30', walkMin: 2 },
    { id: 'esswerk', name: 'Esswerk', emoji: '🥗', coords: [47.4256, 9.3745], tags: ['🥗 Veggie', '🌿 Organic'], price: 'CHF 5.50', bags: 3, pickup: '20:00–21:30', walkMin: 5 },
    { id: 'greco', name: 'Greco Fine Food', emoji: '🫒', coords: [47.4252, 9.3791], tags: ['🥙 Savory', '🧀 Dairy'], price: 'CHF 4.90', bags: 3, pickup: '17:30–19:00', walkMin: 3 },
    { id: 'chocolaterie_kloster', name: 'Chocolaterie am Klosterplatz', emoji: '🍫', coords: [47.4235, 9.3759], tags: ['🍰 Pastry', '🍫 Chocolate'], price: 'CHF 4.20', bags: 4, pickup: '17:00–18:30', walkMin: 4 },
    { id: 'pinchu', name: 'PinChu', emoji: '🥟', coords: [47.4232, 9.3750], tags: ['🍱 Hot Meal', '🥙 Savory'], price: 'CHF 5.50', bags: 2, pickup: '19:00–21:00', walkMin: 4 },
    { id: 'brezelkoenig', name: 'Brezelkönig - Bahnhof St. Gallen', emoji: '🥨', coords: [47.4238, 9.3699], tags: ['🥐 Bakery', '🥨 Pretzels'], price: 'CHF 3.50', bags: 5, pickup: '18:00–19:30', walkMin: 6 },
    { id: 'tibits', name: 'tibits - St. Gallen', emoji: '🥗', coords: [47.4230, 9.3711], tags: ['🥗 Veggie', '🌿 Organic'], price: 'CHF 5.90', bags: 3, pickup: '19:30–21:00', walkMin: 5 },
    { id: 'kuhn', name: 'Bäckerei Kuhn - Neumarkt', emoji: '🥖', coords: [47.4216, 9.3713], tags: ['🥐 Bakery', '🍰 Pastry'], price: 'CHF 3.90', bags: 4, pickup: '16:30–18:00', walkMin: 6 },
];

/* ─── Live feed messages ─── */
const FEED_MSGS = [
    '🛍️ 3 users rescued bags in St. Gallen just now',
    '🌿 Anna K. tagged Roggwiller · Pastry bag',
    '⚡ 2 bags left at Barista — ending soon',
    '🏷️ New tags added at Migros · 142 total',
    '🌍 12 bags saved in St. Gallen today',
];

/* ─── Tag label map (matches mockDb keys) ─── */
const TAG_LABELS = {
    bakery: '🥐 Bakery', veggie: '🥗 Veggie', dairy: '🧀 Dairy',
    hot_meal: '🍱 Hot Meal', drinks: '☕ Drinks', pastry: '🍰 Pastry',
    savory: '🥘 Savory', organic: '🌿 Organic',
};

/* ─── Helper: get all tags from tagData for a store ─── */
function getAllTagPills(tagDataForStore) {
    if (!tagDataForStore) return [];
    return Object.entries(tagDataForStore)
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([key, count]) => ({ key, label: TAG_LABELS[key] || key, count }));
}

/* ══════════════════════════════════════════
   DISABLE SCROLL ZOOM ON MOBILE
   ══════════════════════════════════════════ */
function MobileScrollControl() {
    const map = useMap();
    useEffect(() => {
        const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isMobile) map.scrollWheelZoom.disable();
    }, [map]);
    return null;
}

/* ══════════════════════════════════════════
   CREATE CUSTOM PIN ICON
   ══════════════════════════════════════════ */
function createPinIcon(emoji, price, isReserved, isSoldOut, isFav) {
    const dot = isReserved
        ? `<span style="position:absolute;top:-3px;right:-3px;width:8px;height:8px;background:#22C55E;border-radius:50%;border:1.5px solid #fff;"></span>`
        : '';
    const favDot = isFav && !isReserved
        ? `<span style="position:absolute;top:-3px;right:-3px;width:8px;height:8px;background:#EF4444;border-radius:50%;border:1.5px solid #fff;"></span>`
        : '';
    const bg = isSoldOut ? '#9CA3AF' : DARK_TEAL;
    const label = isSoldOut ? 'Sold out' : price;
    return L.divIcon({
        className: 'custom-pin-wrapper',
        html: `
      <div style="position:relative;display:inline-flex;align-items:center;gap:4px;background:${bg};color:#fff;border-radius:999px;padding:0 10px;height:28px;font-size:12px;font-weight:700;font-family:${SYS};white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;opacity:${isSoldOut ? '0.6' : '1'};">
        <span style="font-size:13px;line-height:1;">${emoji}</span>
        <span>${label}</span>
        ${dot}${favDot}
      </div>
    `,
        iconSize: [null, 28],
        iconAnchor: [40, 28],
    });
}

/* ══════════════════════════════════════════
   "YOU ARE HERE" ICON
   ══════════════════════════════════════════ */
const youAreHereIcon = L.divIcon({
    className: 'you-are-here-wrapper',
    html: `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="position:relative;width:16px;height:16px;">
        <div style="position:absolute;inset:0;background:#3B82F6;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(59,130,246,0.3);z-index:2;"></div>
        <div class="leaflet-pulse-ring" style="position:absolute;inset:-8px;border:2px solid rgba(59,130,246,0.4);border-radius:50;animation:pulseRing 1.5s ease-out infinite;"></div>
      </div>
      <div style="background:#fff;border-radius:999px;padding:2px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.12);white-space:nowrap;">
        <span style="font-size:11px;color:#4B5563;font-family:${SYS};">📍 You are here</span>
      </div>
    </div>
  `,
    iconSize: [100, 48],
    iconAnchor: [50, 20],
});

/* ══════════════════════════════════════════
   MARKER CLUSTER LAYER (F2)
   ══════════════════════════════════════════ */
function ClusteredMarkers({ pins, pinIcons, onPinClick }) {
    const map = useMap();
    const clusterRef = useRef(null);

    useEffect(() => {
        if (clusterRef.current) {
            map.removeLayer(clusterRef.current);
        }

        const cluster = L.markerClusterGroup({
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            iconCreateFunction: (c) => {
                const count = c.getChildCount();
                return L.divIcon({
                    className: 'custom-pin-wrapper',
                    html: `<div style="display:inline-flex;align-items:center;justify-content:center;background:${DARK_TEAL};color:#fff;border-radius:50%;width:36px;height:36px;font-size:13px;font-weight:800;font-family:${SYS};box-shadow:0 2px 10px rgba(0,0,0,0.3);">${count}</div>`,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18],
                });
            },
        });

        pins.forEach(pin => {
            const marker = L.marker(pin.coords, { icon: pinIcons[pin.id] });
            marker.on('click', () => onPinClick(pin));
            cluster.addLayer(marker);
        });

        map.addLayer(cluster);
        clusterRef.current = cluster;

        return () => {
            if (clusterRef.current) map.removeLayer(clusterRef.current);
        };
    }, [map, pins, pinIcons, onPinClick]);

    return null;
}

/* ══════════════════════════════════════════
   TRANSPARENCY CARD (F4 half-height + F5 swipe + F6 2-step reserve)
   ══════════════════════════════════════════ */
function TransparencyCard({ pin, tagData, ix, handleReserve, onClose, stores }) {
    const [confirmMode, setConfirmMode] = useState(false);
    const confirmTimer = useRef(null);

    /* ─── Swipe-to-dismiss state (F5) ─── */
    const touchStartY = useRef(null);
    const [dragOffset, setDragOffset] = useState(0);
    const dragging = useRef(false);

    /* Reset confirm when pin changes */
    useEffect(() => {
        setConfirmMode(false);
        setDragOffset(0);
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
    }, [pin]);

    if (!pin) return null;

    const bags = ix.bagCounts[pin.id] ?? pin.bags;
    const isReserved = ix.reservedStores.has(pin.id);
    const tags = getAllTagPills(tagData[pin.id]);
    const storeObj = stores.find(s => s.id === pin.id);

    /* ─── 2-step reserve (F6) ─── */
    const handleReserveClick = () => {
        if (isReserved || bags === 0) return;
        if (!confirmMode) {
            setConfirmMode(true);
            confirmTimer.current = setTimeout(() => setConfirmMode(false), 3000);
        } else {
            if (storeObj && handleReserve) handleReserve(storeObj);
            setConfirmMode(false);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            // Close after a short delay to let the impact card overlay show
            setTimeout(() => onClose(), 500);
        }
    };

    const openDetail = () => {
        if (storeObj && ix.openStore) ix.openStore(storeObj);
    };

    /* ─── Swipe handlers (F5) ─── */
    const onTouchStart = (e) => {
        touchStartY.current = e.touches[0].clientY;
        dragging.current = true;
    };
    const onTouchMove = (e) => {
        if (!dragging.current || touchStartY.current === null) return;
        const dy = e.touches[0].clientY - touchStartY.current;
        if (dy > 0) setDragOffset(dy); // only drag downward
    };
    const onTouchEnd = () => {
        dragging.current = false;
        touchStartY.current = null;
        if (dragOffset > 80) {
            onClose();
        }
        setDragOffset(0);
    };

    return (
        <div
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000,
                maxHeight: '42vh', overflowY: 'auto',
                background: '#fff', borderRadius: '16px 16px 0 0',
                boxShadow: '0 -4px 24px rgba(0,0,0,0.15)', padding: '0 16px 16px',
                animation: dragOffset > 0 ? 'none' : 'slideUpCard 0.3s ease forwards',
                transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
                opacity: dragOffset > 80 ? 1 - ((dragOffset - 80) / 100) : 1,
                transition: dragging.current ? 'none' : 'transform 0.25s ease, opacity 0.25s ease',
                fontFamily: SYS,
            }}
        >
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, background: '#D1D5DB', borderRadius: 999, margin: '12px auto 8px' }} />

            {/* ROW 1 — store name + price + close */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>{pin.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>{pin.name}</span>
                        <span style={{ fontWeight: 700, color: TEAL, fontSize: 14, marginLeft: 8 }}>{pin.price}</span>
                    </div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 20, color: '#9CA3AF', lineHeight: 1 }}>×</button>
            </div>

            {/* ROW 2 — walk time + pickup */}
            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                🚶 {pin.walkMin} min walk from Marktplatz · 🕐 {pin.pickup}
            </p>

            {/* ROW 3 — divider */}
            <div style={{ height: 1, background: '#F3F4F6', marginBottom: 8 }} />

            {/* ROW 4 — community tags */}
            <p style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Community Tags</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                {(tags.length > 0 ? tags : pin.tags.map((t, i) => ({ key: i, label: t }))).map(t => (
                    <span key={t.key} style={{ background: '#F3F4F6', borderRadius: 999, padding: '3px 9px', fontSize: 11, color: '#374151' }}>{t.label}</span>
                ))}
            </div>

            {/* ROW 5 — bag count + verified */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: bags <= 2 ? '#EF4444' : '#F97316' }}>
                    {bags} bag{bags !== 1 ? 's' : ''} left
                </span>
                <span style={{ fontSize: 10, color: TEAL }}>✓ Verified purchase tags only</span>
            </div>

            {/* ROW 6 — action buttons with 2-step reserve (F6) */}
            <div style={{ display: 'flex', gap: 10 }}>
                <button
                    onClick={openDetail}
                    style={{
                        flex: 1, padding: '10px 0', borderRadius: 14, fontSize: 13, fontWeight: 700,
                        border: `1.5px solid ${TEAL}`, background: 'transparent', color: TEAL,
                        cursor: 'pointer', fontFamily: SYS,
                    }}
                >View Details</button>
                <button
                    onClick={handleReserveClick}
                    style={{
                        flex: 1, padding: '10px 0', borderRadius: 14, fontSize: 13, fontWeight: 700,
                        border: 'none',
                        background: isReserved ? '#E5E7EB' : confirmMode ? '#FF6B35' : TEAL,
                        color: isReserved ? '#9CA3AF' : '#fff',
                        cursor: isReserved ? 'default' : 'pointer', fontFamily: SYS,
                        transition: 'background 0.2s',
                        position: 'relative', overflow: 'hidden',
                    }}
                    disabled={isReserved || bags === 0}
                >
                    {isReserved ? '✓ Reserved' : confirmMode ? 'Confirm Reservation ✓' : `Reserve Bag · ${pin.price}`}
                    {confirmMode && (
                        <span style={{
                            position: 'absolute', bottom: 0, left: 0, height: 3,
                            background: 'rgba(255,255,255,0.5)', borderRadius: 999,
                            animation: 'confirmCountdown 3s linear forwards',
                        }} />
                    )}
                </button>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════
   LIVE FEED BUBBLE
   ══════════════════════════════════════════ */
function LiveFeedBubble() {
    const [idx, setIdx] = useState(0);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => {
            setVisible(false);
            setTimeout(() => {
                setIdx(prev => (prev + 1) % FEED_MSGS.length);
                setVisible(true);
            }, 300);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 900,
            background: '#fff', borderRadius: 999, padding: '6px 12px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            display: 'flex', alignItems: 'center', gap: 8,
            maxWidth: 260,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.3s ease',
        }}>
            <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#4ADE80', flexShrink: 0,
                animation: 'pulseGreen 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, color: '#4B5563', fontFamily: SYS, lineHeight: 1.3 }}>
                {FEED_MSGS[idx]}
            </span>
        </div>
    );
}

/* ══════════════════════════════════════════
   SEARCH PAN — fly to matching pin when search query matches
   ══════════════════════════════════════════ */
function SearchPanHandler({ searchQuery, onPinClick }) {
    const map = useMap();
    const lastQuery = useRef('');

    useEffect(() => {
        if (!searchQuery || searchQuery === lastQuery.current) return;
        lastQuery.current = searchQuery;
        const lq = searchQuery.toLowerCase();
        const match = STORE_PINS.find(p => p.name.toLowerCase().includes(lq));
        if (match) {
            map.flyTo(match.coords, 17, { duration: 0.6 });
            onPinClick(match);
        }
    }, [searchQuery, map, onPinClick]);

    return null;
}

/* ══════════════════════════════════════════
   MAIN LEAFLET MAP COMPONENT
   ══════════════════════════════════════════ */
export default function LeafletMap({ ix, tagData, handleReserve, stores, searchQuery }) {
    const [selectedPin, setSelectedPin] = useState(null);

    const handlePinClick = useCallback((pin) => {
        setSelectedPin(pin);
    }, []);

    /* Build icons with memoization so they update when reservedStores/bagCounts/favourites change */
    const pinIcons = useMemo(() => {
        const icons = {};
        STORE_PINS.forEach(pin => {
            const bags = ix.bagCounts[pin.id] ?? pin.bags;
            icons[pin.id] = createPinIcon(pin.emoji, pin.price, ix.reservedStores.has(pin.id), bags === 0, ix.favourites?.has(pin.id));
        });
        return icons;
    }, [ix.reservedStores, ix.bagCounts, ix.favourites]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '55vh', borderRadius: 16, overflow: 'hidden' }}>
            <MapContainer
                center={[47.4245, 9.3767]}
                zoom={15}
                style={{ width: '100%', height: '100%', background: '#F5F3EE' }}
                zoomControl={false}
                attributionControl={false}
            >
                <MobileScrollControl />
                <SearchPanHandler searchQuery={searchQuery} onPinClick={handlePinClick} />

                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                />

                {/* Clustered store pins (F2) */}
                <ClusteredMarkers pins={STORE_PINS} pinIcons={pinIcons} onPinClick={handlePinClick} />

                {/* You are here */}
                <Marker position={[47.43167237092631, 9.374918435398666]} icon={youAreHereIcon} interactive={false} />
            </MapContainer>

            {/* Attribution overlay (custom styled) */}
            <div style={{
                position: 'absolute', bottom: 4, left: 8, zIndex: 800,
                fontSize: 10, color: '#D1D5DB', fontFamily: SYS, pointerEvents: 'none',
            }}>
                © OpenStreetMap © CARTO
            </div>

            {/* Live feed bubble */}
            {!selectedPin && <LiveFeedBubble />}

            {/* Transparency card (half-height drawer with swipe) */}
            <TransparencyCard
                pin={selectedPin}
                tagData={tagData}
                ix={ix}
                handleReserve={handleReserve}
                onClose={() => setSelectedPin(null)}
                stores={stores}
            />
        </div>
    );
}
