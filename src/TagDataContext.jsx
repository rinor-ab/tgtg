import { createContext, useContext, useState, useEffect } from 'react';
import { initialTagData } from './mockDb';

const TagDataContext = createContext(null);

// Bump this version to force a full localStorage reset on next load
const DATA_VERSION = 2;

const STORAGE_KEYS = {
    tagData: 'tgtg_tagData',
    ecoPoints: 'tgtg_ecoPoints',
    claimedQuests: 'tgtg_claimedQuests',
    redeemedRewards: 'tgtg_redeemedRewards',
    lifetimePoints: 'tgtg_lifetimePoints',
    reservations: 'tgtg_reservations',
    dataVersion: 'tgtg_dataVersion',
};

// Clear all app data if version changed
if (Number(localStorage.getItem(STORAGE_KEYS.dataVersion)) !== DATA_VERSION) {
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(STORAGE_KEYS.dataVersion, DATA_VERSION);
}

function loadFromStorage(key, fallback) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : fallback;
    } catch {
        return fallback;
    }
}

export function TagDataProvider({ children }) {
    const [tagData, setTagData] = useState(() =>
        loadFromStorage(STORAGE_KEYS.tagData, initialTagData)
    );
    const [ecoPoints, setEcoPoints] = useState(() =>
        loadFromStorage(STORAGE_KEYS.ecoPoints, 1045)
    );
    const [claimedQuests, setClaimedQuests] = useState(() =>
        loadFromStorage(STORAGE_KEYS.claimedQuests, [])
    );
    const [redeemedRewards, setRedeemedRewards] = useState(() =>
        loadFromStorage(STORAGE_KEYS.redeemedRewards, [])
    );
    const [lifetimePoints, setLifetimePoints] = useState(() =>
        loadFromStorage(STORAGE_KEYS.lifetimePoints, 1045)
    );
    const [reservations, setReservations] = useState(() =>
        loadFromStorage(STORAGE_KEYS.reservations, [])
    );

    // Persist tagData
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.tagData, JSON.stringify(tagData));
    }, [tagData]);

    // Persist ecoPoints
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.ecoPoints, JSON.stringify(ecoPoints));
    }, [ecoPoints]);

    // Persist claimedQuests
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.claimedQuests, JSON.stringify(claimedQuests));
    }, [claimedQuests]);

    // Persist redeemedRewards
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.redeemedRewards, JSON.stringify(redeemedRewards));
    }, [redeemedRewards]);

    // Persist lifetimePoints
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.lifetimePoints, JSON.stringify(lifetimePoints));
    }, [lifetimePoints]);

    // Persist reservations
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.reservations, JSON.stringify(reservations));
    }, [reservations]);

    const addReservation = (reservation) => {
        setReservations((prev) => [reservation, ...prev]);
    };

    const updateReservationStatus = (reservationId, newStatus) => {
        setReservations((prev) =>
            prev.map((r) => r.id === reservationId ? { ...r, status: newStatus } : r)
        );
    };

    const getActiveReservation = (bagId) => {
        return reservations.find((r) => r.bagId === bagId && (r.status === 'reserved' || r.status === 'ready'));
    };

    const addEcoPoints = (pts) => {
        setEcoPoints((p) => p + pts);
        setLifetimePoints((p) => p + pts);
    };

    const spendEcoPoints = (pts) => {
        setEcoPoints((p) => Math.max(0, p - pts));
    };

    const redeemReward = (rewardId, cost) => {
        setEcoPoints((p) => Math.max(0, p - cost));
        setRedeemedRewards((prev) => [...prev, { id: rewardId, date: new Date().toISOString() }]);
    };

    const updateTagData = (storeId, tagsToIncrement) => {
        setTagData((prev) => {
            const updated = { ...prev, [storeId]: { ...prev[storeId] } };
            tagsToIncrement.forEach((tag) => {
                updated[storeId][tag] = (updated[storeId][tag] || 0) + 1;
            });
            return updated;
        });
    };

    const claimQuest = (questId) => {
        setClaimedQuests((prev) => [...prev, questId]);
    };

    return (
        <TagDataContext.Provider
            value={{
                tagData,
                updateTagData,
                ecoPoints,
                addEcoPoints,
                spendEcoPoints,
                lifetimePoints,
                claimedQuests,
                claimQuest,
                redeemedRewards,
                redeemReward,
                reservations,
                addReservation,
                updateReservationStatus,
                getActiveReservation,
            }}
        >
            {children}
        </TagDataContext.Provider>
    );
}

export function useTagData() {
    const ctx = useContext(TagDataContext);
    if (!ctx) throw new Error('useTagData must be used within TagDataProvider');
    return ctx;
}
