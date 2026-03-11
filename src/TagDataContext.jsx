import { createContext, useContext, useState, useEffect } from 'react';
import { initialTagData } from './mockDb';

const TagDataContext = createContext(null);

const STORAGE_KEYS = {
    tagData: 'tgtg_tagData',
    ecoPoints: 'tgtg_ecoPoints',
    claimedQuests: 'tgtg_claimedQuests',
    redeemedRewards: 'tgtg_redeemedRewards',
    lifetimePoints: 'tgtg_lifetimePoints',
};

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
