function getDatasetKey() {
    const name = sessionStorage.getItem("selectedDataName");
    return name ? `suspiciousScores:${name}` : null;
}

export function loadSuspiciousScores() {
    const key = getDatasetKey();
    if (!key) return {};
    try {
        return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
        return {};
    }
}

export function saveSuspiciousScores(map) {
    const key = getDatasetKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(map));
}

export function loadSuspiciousNodesFromLocalStorage() {
    const stored = localStorage.getItem("suspiciousNodeIds");
    if (!stored) return new Set();
    try {
        const ids = JSON.parse(stored);
        return new Set(ids.map(id => Number(id)));

    } catch {
        return new Set();
    }
}

export function saveSuspiciousNodesToLocalStorage() {
    const ids = Array.from(window.suspiciousNodes || []);
    localStorage.setItem("suspiciousNodeIds", JSON.stringify(ids));
}
