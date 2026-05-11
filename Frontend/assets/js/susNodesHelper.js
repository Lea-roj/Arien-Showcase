import {loadSuspiciousNodesFromLocalStorage, saveSuspiciousNodesToLocalStorage, loadSuspiciousScores} from "./SuspiciousScoreStorage.js";

export const nodeColorScale = d3.scaleLinear().domain([0, 0.5, 1]).range(["#177AA4", "#22c55e", "#d11a1a"]).clamp(true);


export function nodeLabel(node) {
    const score =
        typeof node?.properties?.score === "number" ? node.properties.score : 0;

    const label = score > 0.5 ? 1 : 0;

    const originalLabel =
        typeof node?.properties?.initial_label === "number" ? node.properties.initial_label : 0;

    const originalScore =
        typeof node?.properties?.initial_score === "number" ? node.properties.initial_score : score;

    let html = `
        <strong>ID:</strong> ${node.id}<br>
        <strong>Label:</strong> ${label}
        <span class="text-muted">(Original label: ${originalLabel})</span><br>
        <strong>Suspicion score:</strong> ${score.toFixed(2)}
        <span class="text-muted">(Original score: ${originalScore.toFixed(2)})</span>
        <hr>
    `;

    if (node.properties.pred_label != null) {
        html += `<strong>Predicted Label:</strong> ${node.properties.pred_label}<br>`;
    }

    if (node.properties.pred_probability != null) {
        html += `<strong>Probability:</strong> ${node.properties.pred_probability.toFixed(3)}<br>`;
    }

    if (node.properties.pred_percentile != null) {
        const pct = (node.properties.pred_percentile * 100).toFixed(1);
        html += `<strong>Percentile:</strong> ${pct}% 
            <small class="text-muted">(top ${100 - pct}% risk)</small><br>`;
    }

    const HIDDEN_KEYS = new Set([
        "label",
        "score",
        "tempScore",
        "pred_label",
        "pred_probability",
        "pred_percentile",
        "initialized",
        "initial_label",
        "initial_score",
    ]);

    if (node.properties) {
        for (const [key, value] of Object.entries(node.properties)) {
            if (HIDDEN_KEYS.has(key)) continue;
            html += `<strong>${key}:</strong> ${value}<br>`;
        }
    }
    return html;
}

export function updateNodeColors() {
    if (!window.nodeSelection) {
        return;
    }

    window.nodeSelection
        .select("circle")
        .attr("fill", d => nodeColorScale(Number(d.properties.score ?? 0)));
}


export function clearAllAnnotations() {
    if (!window.allGraphNodes) return;

    window.allGraphNodes.forEach(d => {
        d.properties.score = 0;
        d.properties.label = 0;
        d.properties.tempScore = 0;
    });

    window.suspiciousNodes = new Set();

    const datasetName = sessionStorage.getItem("selectedDataName");
    if (datasetName) {
        localStorage.removeItem(`suspiciousScores:${datasetName}`);
    }

    sessionStorage.removeItem("predictedLabels");
    sessionStorage.removeItem("predictedProbabilities");
    sessionStorage.removeItem("predictedPercentiles");

    localStorage.setItem("graphMode", "original");

    updateNodeColors();
    renderSuspiciousList();
}

export function renderSuspiciousList() {
    const container = document.getElementById("suspiciousList");
    if (!container) return;
    const manualSet = loadSuspiciousNodesFromLocalStorage();

    container.innerHTML = '';

    if (!window.allGraphNodes || !Array.isArray(window.allGraphNodes)) {
        container.innerHTML = '<p>No suspicious nodes</p>';
        return;
    }

    const threshold = typeof window.suspicionThreshold === "number" ? window.suspicionThreshold : 0.5;

    const nodes = window.allGraphNodes.filter(d => typeof d.properties.score === "number" && d.properties.score >= threshold);
    if (nodes.length === 0) {
        container.innerHTML = '<p>No suspicious nodes</p>';
        return;
    }

    const template = document.getElementById("suspiciousNodeTemplate");

    nodes.forEach(d => {
        const id = d.id;
        const clone = template.content.cloneNode(true);

        const header = clone.querySelector(".header");
        const detailDiv = clone.querySelector(".details");
        const nodeLabelDiv = clone.querySelector(".node-id");

        const saved = loadSuspiciousScores();
        const isManual = saved[d.id] !== undefined;
        const sourceBadge = isManual
            ? `<span class="badge bg-primary ms-2">Manually Added</span>`
            : `<span class="badge bg-danger ms-2">Predicted</span>`;

        nodeLabelDiv.innerHTML = `Node: ${id} ${sourceBadge}`;

        detailDiv.innerHTML = nodeLabel(d);
        // detailDiv.style.display = "none";

        header.addEventListener("click", function () {
            const isVisible = detailDiv.style.display === "block";
            detailDiv.style.display = isVisible ? "none" : "block";
            const icon = header.querySelector(".toggle-icon");
            icon.classList.toggle("bi-chevron-down", !isVisible);
            icon.classList.toggle("bi-chevron-up", isVisible);
        });

        const toggleIcon = header.querySelector(".toggle-icon");
        toggleIcon.classList.remove("bi-chevron-up");
        toggleIcon.classList.add("bi-chevron-down");

        clone.querySelector(".delete-icon").addEventListener("click", function () {
            manualSet.delete(id);
            saveSuspiciousNodesToLocalStorage();

            d.properties.label = 0;

            window.nodeSelection
                .filter(d => d.id === id)
                .select("circle")

            renderSuspiciousList();
        });

        container.appendChild(clone);
    });
}

