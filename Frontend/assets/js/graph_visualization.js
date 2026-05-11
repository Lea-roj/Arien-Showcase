import {
    clearHighlights,
    linkLabel,
    positionElements,
    renderLinkLabels,
    renderLinks,
    renderNodeVisuals,
    setupExportButton,
    setupExportSuspiciousButton,
    setupNodeDragging,
    setupSimulation,
    setupSvgCanvas,
    setupZoom
} from './graphHelpers.js';
import {
    loadSuspiciousNodesFromLocalStorage,
    loadSuspiciousScores,
    saveSuspiciousNodesToLocalStorage,
    saveSuspiciousScores
} from "./SuspiciousScoreStorage.js";
import {
    clearAllAnnotations,
    nodeColorScale,
    nodeLabel,
    renderSuspiciousList,
    updateNodeColors
} from './susNodesHelper.js'

window.isExplaining = false;

document.addEventListener('DOMContentLoaded', function () {
    const content = document.getElementById('content');
    if (!content) return;
    let alreadyInitialized = false;

    const observer = new MutationObserver(function () {
        const graphSvg = document.getElementById("graph");
        if (graphSvg) {
            if (!alreadyInitialized || graphSvg.childNodes.length === 0) {
                alreadyInitialized = true;
                initializeGraphView();
            }
        } else {
            alreadyInitialized = false;
        }
    });

    observer.observe(content, {
        childList: true,
        subtree: true
    });
});

window.initializeGraphView = function () {
    if (!window.suspiciousNodes) {
        window.suspiciousNodes = new Set();
    }

    const selectedDataName = sessionStorage.getItem('selectedDataName');
    const savedThreshold = Number(localStorage.getItem("suspicionThreshold"));
    window.suspicionThreshold = Number.isFinite(savedThreshold) ? savedThreshold : 0.5;

    if (selectedDataName) {
        fetch(`${API}/arien/data/${encodeURIComponent(selectedDataName)}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(rawGraph => {
                const { nodes, links } = transformGraph(rawGraph);
                drawGraph({ nodes, links });
            })
            .catch(err => {
                console.error("Graph load error:", err);
                alert("Error loading graph data.");
            });
    } else {
        console.warn("No dataset selected in session.");
    }

    const infoPanel = d3.select("#infoPanel");
    const infoTitle = d3.select("#infoTitle");
    const infoContent = d3.select("#infoContent");
    window.currentSelectedNode = null;

    const slider = document.getElementById("suspicionSlider");
    const valueEl = document.getElementById("suspicionValue");

    const thresholdInput = document.getElementById("susThreshold");
    const thresholdBtn = document.getElementById("susThresholdButton");

    const explainBtn = document.getElementById("explainNodeBtn");

    if (explainBtn) {
        explainBtn.addEventListener("click", () => {
            if (window.explainCurrentNode) {
                window.explainCurrentNode();
            }
        });
    }

    const graphBtn = document.getElementById("graphBtn");

    if (graphBtn) {
        graphBtn.addEventListener("click", () => {
            openGraphDialog();
        });
    }

    function updateExplainUI() {
        const explainControl = document.getElementById("explainControl");
        const explainBtn = document.getElementById("explainNodeBtn");
        const explainInfoBtn = document.getElementById("explainInfoBtn");

        let graphModeSupervised = localStorage.getItem("graphMode");

        if (!explainControl || !explainBtn) return;

        if (!window.currentSelectedNode) {
            explainBtn.style.display = "none";
            explainInfoBtn.style.display = "none";
            return;
        }

        explainBtn.style.display = "block";
        explainInfoBtn.style.display = "block";

        const usedSmote = sessionStorage.getItem("predictionUsedSmote") === "1";

        if (graphModeSupervised === "original" || graphModeSupervised === "unsupervised" || usedSmote) {
            explainBtn.disabled = true;
        } else {
            explainBtn.disabled = false;
            explainBtn.innerText = "Explain";
        }
    }
    if (thresholdInput && thresholdBtn) {
        thresholdInput.value = window.suspicionThreshold.toFixed(2);

        thresholdBtn.addEventListener("click", () => {
            let v = Number(thresholdInput.value);

            if (Number.isNaN(v)) return;
            v = Math.max(0, Math.min(1, v));
            window.suspicionThreshold = v;
            localStorage.setItem("suspicionThreshold", v);
            renderSuspiciousList();
        });
    }

    if (slider && valueEl) {
        slider.addEventListener("input", () => {
            if (!window.currentSelectedNode) return;

            const v = Number(slider.value);
            valueEl.textContent = v.toFixed(2);

            window.currentSelectedNode.properties.tempScore = v;

            setSelectedOutline({
                ...window.currentSelectedNode,
                properties: {
                    ...window.currentSelectedNode.properties,
                    score: v
                }
            });

            showPanel(`Node: ${window.currentSelectedNode.id}`, nodeLabel({
                ...window.currentSelectedNode,
                properties: {
                    ...window.currentSelectedNode.properties,
                    score: v
                }
            }));
        });

    }

    function switchToTab(tabName) {
        document.querySelectorAll('#panelTabs .nav-link')
            .forEach(t => t.classList.remove("active"));

        document.querySelectorAll('.tab-content-inner')
            .forEach(el => el.style.display = 'none');

        if (tabName !== "details") {
            const explain = document.getElementById("explainControl");
            if (explain) explain.style.display = "none";
        } else {
            updateExplainUI();
        }

        const tabBtn = document.querySelector(
            `#panelTabs .nav-link[data-tab="${tabName}"]`
        );
        const tabContent = document.getElementById(`tab-${tabName}-content`);

        if (tabBtn) tabBtn.classList.add("active");
        if (tabContent) tabContent.style.display = 'block';
    }


    function setSearchBusy(isBusy) {
        const searchBtn = document.getElementById("nodeSearchBtn");
        const searchInput = document.getElementById("nodeSearch");

        if (!searchBtn) return;

        searchBtn.disabled = isBusy;
        searchBtn.classList.toggle("disabled", isBusy);

        if (searchInput) {
            searchInput.disabled = isBusy;
        }
    }

    function setSelectedOutline(node) {
        if (!node) return;

        const fill = nodeColorScale(node.properties.score);

        window.nodeSelection
            .filter(d => d.id === node.id)
            .select("circle")
            .attr("stroke", d3.color(fill).darker(1))
            .attr("stroke-width", 3);
    }


    function restoreAnnotations(nodes) {
        const savedScores = loadSuspiciousScores();

        nodes.forEach(d => {
            const v = savedScores[String(d.id)];
            if (typeof v === "number") {
                d.properties.score = v;
                d.properties.label = v >= 0.5 ? 1 : 0;
            }
        });
    }

    function hideNodeAnnotationControls() {
        const markBtn = document.getElementById("markSuspiciousBtn");
        const control = document.getElementById("suspicionControl");
        const explain = document.getElementById("explainControl");

        if (markBtn) markBtn.style.display = "none";
        if (control) control.style.display = "none";
        if (explain) explain.style.display = "none";
    }

    function resetDraft(node) {
        if (!node) return;
        node.properties.tempScore = node.properties.score;
        const fill = nodeColorScale(node.properties.score);

        window.nodeSelection
            .filter(d => d.id === node.id)
            .select("circle")
            .attr("fill", fill)
            .attr("stroke", null)
            .attr("stroke-width", 1);
    }

    function transformGraph(raw) {
        const nodeMap = new Map();
        raw.nodes.forEach(n => {
            const id = Number(n.id);

            const props = { ...n.properties };

            if (typeof props.label !== "number") {
                props.label = 0;
            }

            nodeMap.set(id, {
                id: id,
                label: n.labels[0],
                properties: props
            });
        });

        const nodes = Array.from(nodeMap.values());

        const links = raw.relationships
            .filter(r => nodeMap.has(r.start) && nodeMap.has(r.end))
            .map(r => ({
                source: nodeMap.get(r.start),
                target: nodeMap.get(r.end),
                type: r.type,
                properties: r.properties
            }));

        return {nodes, links};
    }

    document.querySelectorAll('#panelTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('#panelTabs .nav-link').forEach(t => t.classList.remove("active"));
            this.classList.add("active");

            const tabName = this.getAttribute("data-tab");
            document.querySelectorAll('.tab-content-inner').forEach(el => el.style.display = 'none');
            const target = document.getElementById(`tab-${tabName}-content`);
            if (target) {
                target.style.display = 'block';
            }
        });
    });

    function showPanel(title, html) {
        switchToTab("details");

        infoTitle.text(title);
        infoContent.html(html);
        infoPanel.style("display", "block");
    }

    function setupLinkInteractions(link) {
        link
            .on("click", (event, d) => {
                if (window.isExplaining) return;

                if (window.currentSelectedNode) {
                    resetDraft(window.currentSelectedNode);
                    window.currentSelectedNode = null;
                    updateExplainUI();
                }

                hideNodeAnnotationControls();

                clearHighlights();
                d3.select(event.currentTarget).classed("highlight-link", true);

                showPanel(`Link: ${d.source.id} → ${d.target.id}`, linkLabel(d));
            })
            .on("mouseover", (event, d) => {
                if (window.isExplaining) return;
                d3.select(event.currentTarget)
                    .classed("highlight-link", true)
                    .attr("stroke", "#043c54")
                    .attr("stroke-width", 4);
            })
            .on("mouseout", (event, d) => {
                d3.select(event.currentTarget)
                    .classed("highlight-link", false)
                    .attr("stroke", "#aaa")
                    .attr("stroke-width", 2);
            });
    }


    function updateAnnotationUI() {
        const toggle = document.getElementById("annotationToggle");
        const markBtn = document.getElementById("markSuspiciousBtn");
        const control = document.getElementById("suspicionControl");

        if (!toggle || !markBtn || !control) return;

        const enabled = toggle.checked && window.currentSelectedNode != null;

        markBtn.style.display = enabled ? "inline-block" : "none";
        control.style.display = enabled ? "block" : "none";
    }


    function drawGraph(data) {
        const svg = setupSvgCanvas();
        const simulation = setupSimulation(data, svg);
        const zoomGroup = setupZoom(svg);

        const link = renderLinks(zoomGroup, data.links);

        const adjacency = new Map();

        data.links.forEach(l => {
            if (!adjacency.has(l.source.id)) adjacency.set(l.source.id, []);
            if (!adjacency.has(l.target.id)) adjacency.set(l.target.id, []);

            adjacency.get(l.source.id).push(l);
            adjacency.get(l.target.id).push(l);
        });

        const linkLabels = renderLinkLabels(zoomGroup, data.links);
        data.links.forEach((l, i) => {
            l.edgeId = i;
        });

        window.allGraphLinks = data.links;

        let predLabels = [];
        let predProbs = [];
        let predPerc = [];

        try {
            predLabels = JSON.parse(sessionStorage.getItem("predictedLabels") || "[]");
            predProbs = JSON.parse(sessionStorage.getItem("predictedProbabilities") || "[]");
            predPerc = JSON.parse(sessionStorage.getItem("predictedPercentiles") || "[]");
        } catch {
            predLabels = [];
            predProbs = [];
            predPerc = [];
        }

        const usedSmote = sessionStorage.getItem("predictionUsedSmote") === "1";

        data.nodes.forEach((d, i) => {

            d.properties.pred_label = predLabels?.[i] ?? null;

            const p = predProbs?.[i];

            if (typeof p === "number") {

                if (usedSmote) {
                    d.properties.pred_probability = 1 - p;
                } else {
                    d.properties.pred_probability = p;
                }

            } else {
                d.properties.pred_probability = null;
            }

            d.properties.pred_percentile = predPerc?.[i] ?? null;

        });


        function computeBaseScore(d) {
            if (typeof d.properties.pred_probability === "number")
                return d.properties.pred_probability;

            if (typeof d.properties.pred_percentile === "number")
                return d.properties.pred_percentile;

            if (typeof d.properties.label === "number")
                return d.properties.label;

            return 0;
        }


        data.nodes.forEach(d => {
            if (d.properties.initial_score === undefined) {
                d.properties.initial_score = computeBaseScore(d);
            }

            if (d.properties.initial_label === undefined) {
                d.properties.initial_label = d.properties.initial_score >= 0.5 ? 1 : 0;
            }

            if (typeof d.properties.score !== "number") {
                d.properties.score = d.properties.initial_score;
            }

            d.properties.tempScore = d.properties.score;
        });

        const savedScores = loadSuspiciousScores();

        data.nodes.forEach(d => {
            const saved = savedScores[d.id];

            if (typeof saved === "number") {
                d.properties.score = saved;
                d.properties.label = saved >= 0.5 ? 1 : 0;
            }
        });

        const graphMode = localStorage.getItem("graphMode") || "original";

        data.nodes.forEach(d => {
            if (graphMode === "supervised") {

                if (d.properties.pred_label != null) {
                    d.properties.label = d.properties.pred_label;
                }

                if (typeof d.properties.pred_probability === "number") {
                    d.properties.score = d.properties.pred_probability;
                }

            }

            if (graphMode === "unsupervised") {

                if (typeof d.properties.pred_percentile === "number") {
                    d.properties.score = d.properties.pred_percentile;
                }

            }
        });

        data.nodes.forEach(d => {
            if (d.properties.label === 1) {
                window.suspiciousNodes.add(d.id);
            } else {
                window.suspiciousNodes.delete(d.id);
            }
        });

        const manualSet = loadSuspiciousNodesFromLocalStorage();
        data.nodes.forEach(d => {
            const id = d.id;

            if (manualSet.has(id)) {
                d.properties.label = 1;
                d.properties.score = 1;
            }
        });

        const node = zoomGroup.append("g").attr("class", "nodes").selectAll("g").data(data.nodes).join("g").attr("data-id", d => d.id);
        window.nodeSelection = node;
        renderNodeVisuals(node);

        node
            .on("click", (event, d) => {
                if (window.isExplaining) return;

                event.stopPropagation();
                clearHighlights();
                d3.select(event.currentTarget).classed("highlight-node", true);

                if (window.currentSelectedNode && window.currentSelectedNode.id !== d.id) {
                    resetDraft(window.currentSelectedNode);
                }

                window.currentSelectedNode = d;
                updateExplainUI();
                setSelectedOutline(d);
                showPanel(`Node: ${d.id}`, nodeLabel(d));

                const slider = document.getElementById("suspicionSlider");
                const valueEl = document.getElementById("suspicionValue");

                if (slider && valueEl) {
                    slider.value = d.properties.score ?? 0;
                    valueEl.textContent = Number(slider.value).toFixed(2);
                }

                updateAnnotationUI();
                const deleteBtn = document.getElementById("deleteSuspiciousBtn");

                if (deleteBtn) {
                    deleteBtn.onclick = () => {
                        if (!window.currentSelectedNode) return;

                        const id = currentSelectedNode.id;
                        window.suspiciousNodes.delete(id);
                        currentSelectedNode.properties.label = 0;

                        window.nodeSelection
                            .filter(d => d.id === id)
                            .select("circle")
                            .attr("fill", "#177AA4")
                            .attr("stroke", null)
                            .attr("stroke-width", 1);

                        saveSuspiciousNodesToLocalStorage();
                        renderSuspiciousList();
                        showPanel(`Node: ${window.currentSelectedNode.id}`, nodeLabel(window.currentSelectedNode));
                    };
                }

            })
            .on("mouseover", (event, d) => {
                d3.select(event.currentTarget).classed("node-hover", true);

                const connected = adjacency.get(d.id) || [];

                connected.forEach(l => {
                    d3.select(`[data-edge-id="${l.edgeId}"]`)
                        .attr("stroke", "#043c54")
                        .attr("stroke-width", 4);
                });
            })
            .on("mouseout", (event) => {
                d3.select(event.currentTarget).classed("node-hover", false);
                link.attr("stroke", "#aaa").attr("stroke-width", 2);
            });

        setupLinkInteractions(link);

        let tickCount = 0;
        simulation.on("tick", () => {
            tickCount++;
            if (tickCount % 2 !== 0) return;
            positionElements(link, node, linkLabels, tickCount);
        });

        setupNodeDragging(node, simulation);

        svg.on("click", (event) => {
            if (event.target.closest(".nodes") || event.target.closest(".links")) return;

            hideNodeAnnotationControls();
        });

        window.allGraphNodes = data.nodes;
        restoreAnnotations(data.nodes);

        renderSuspiciousList();
        updateNodeColors();

        document.getElementById("markSuspiciousBtn").style.display = "none";

        const annotationCheckbox = document.getElementById("annotationToggle");
        if (annotationCheckbox && !annotationCheckbox.__bound) {
            annotationCheckbox.__bound = true;

            annotationCheckbox.addEventListener("change", function () {
                localStorage.setItem("annotationToggle", this.checked);

                updateNodeColors();
                renderSuspiciousList();

                updateAnnotationUI();

                if (window.currentSelectedNode) {
                    setSelectedOutline(window.currentSelectedNode);
                }
            });

        }

        window.currentSelectedNode = null;
        updateExplainUI();
    }

    document.getElementById("markSuspiciousBtn").onclick = () => {
        if (!window.currentSelectedNode) return;

        const v = window.currentSelectedNode.properties.tempScore;

        const scores = loadSuspiciousScores();

        scores[String(window.currentSelectedNode.id)] = v;

        saveSuspiciousScores(scores);

        window.currentSelectedNode.properties.score = v;
        window.currentSelectedNode.properties.label = v >= 0.5 ? 1 : 0;

        updateNodeColors();
        renderSuspiciousList();
    };


    const clearBtn = document.getElementById("clearAnnotationsBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", clearAllAnnotations);
    }

    const revertBtn = document.getElementById("revertAnnotationsBtn");
    revertBtn.addEventListener("click", function () {
        if (!window.allGraphNodes) return;

        const threshold = window.suspicionThreshold ?? 0.5;

        window.allGraphNodes.forEach(d => {
            const current = Number(d.properties.score ?? 0);
            const flipped = 1 - current;

            d.properties.score = flipped;
            d.properties.tempScore = flipped;
            d.properties.label = flipped >= threshold ? 1 : 0;
        });

        updateNodeColors();
        renderSuspiciousList();
    });


    setupExportButton();
    setupExportSuspiciousButton();

    const searchInput = document.getElementById("nodeSearch");
    const clearSearchBtn = document.getElementById("clearSearchBtn");

    const searchBtn = document.getElementById("nodeSearchBtn");

    if (searchBtn && searchInput) {
        searchBtn.addEventListener("click", () => {
            searchNodes(searchInput.value.trim());
        });

        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                searchNodes(searchInput.value.trim());
            }
        });
    }

    function parseTokens(q) {
        if (!q) return [];
        return (q.match(/"[^"]+"|[^,\s]+/g) || []);
    }

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function looksAdvancedQuery(q) {
        return /(:|>=|<=|==|!=|>|<|\*)/.test(q) || /"[^"]+"/.test(q);
    }

    function phraseMatchesNode(phrase, d) {
        const props = d?.properties || {};
        const entries = Object.entries(props);
        entries.push(["id", d.id]);
        if (d.label != null) entries.push(["label", d.label]);

        const lowerPhrase = phrase.toLowerCase();
        return entries.some(([, v]) => String(v).toLowerCase().includes(lowerPhrase));
    }

    function tokenMatchesNode(token, d) {
        const props = d?.properties || {};
        const entries = Object.entries(props);
        entries.push(["id", d.id]);
        if (d.label != null) entries.push(["label", d.label]);

        const lowerToken = token.toLowerCase();
        const isQuoted = lowerToken.startsWith('"') && lowerToken.endsWith('"');

        if (isQuoted) {
            const phrase = lowerToken.slice(1, -1);
            return entries.some(([, v]) => String(v).toLowerCase().includes(phrase));
        }

        if (lowerToken.length <= 2)
            return true;

        const m = token.match(/^([^:<>=!]+)\s*(>=|<=|>|<|==|=|!=)\s*([^]+)$/);
        if (m) {
            const [, rawKey, op, rawVal] = m;
            const key = rawKey.trim().toLowerCase();
            const valStr = rawVal.trim().replace(/^"|"$/g, "");
            const pair = entries.find(([k]) => k.toLowerCase() === key);
            if (!pair) return false;

            const [, v] = pair;
            const vNum = Number(v);
            const qNum = Number(valStr);

            if (!Number.isNaN(vNum) && !Number.isNaN(qNum)) {
                switch (op) {
                    case ">":  return vNum >  qNum;
                    case "<":  return vNum <  qNum;
                    case ">=": return vNum >= qNum;
                    case "<=": return vNum <= qNum;
                    case "=":
                    case "==": return vNum === qNum;
                    case "!=": return vNum !== qNum;
                }
            } else {
                const vStr = String(v).toLowerCase();
                if (op === "!=") return vStr !== valStr.toLowerCase();
                return vStr === valStr.toLowerCase();
            }
        }

        const kv = token.match(/^([^:]+):(.+)$/);
        if (kv) {
            const [, rawKey, rawVal] = kv;
            const key = rawKey.trim().toLowerCase();
            const val = rawVal.trim().toLowerCase();
            const pair = entries.find(([k]) => k.toLowerCase() === key);
            if (!pair) return false;
            return String(pair[1]).toLowerCase().includes(val);
        }

        if (/^\d+$/.test(lowerToken)) {
            const qNum = Number(lowerToken);
            if (d.id === qNum) return true;
            return entries.some(([, v]) => {
                const vNum = Number(v);
                if (!Number.isNaN(vNum) && vNum === qNum) return true;
                const reNum = new RegExp(`\\b${escapeRegExp(lowerToken)}\\b`);
                return reNum.test(String(v));
            });
        }

        const hasWildcard = token.endsWith("*");
        const core = (hasWildcard ? token.slice(0, -1) : token).toLowerCase();

        const pattern = hasWildcard
            ? escapeRegExp(core)
            : `\\b${escapeRegExp(core)}`;

        const re = new RegExp(pattern, "i");

        return entries.some(([, v]) => re.test(String(v)));
    }

    function clearSearchHighlights() {
        d3.selectAll(".node-search-highlight")
            .classed("node-search-highlight", false)
            .select("circle")
            .attr("stroke", null)
            .attr("stroke-width", 1);
    }

    function searchNodes(query) {
        setSearchBusy(true);

        try {
            const q = (query || "").trim();
            if (!q) {
                clearSearchHighlights();
                return;
            }

            const usePhraseMode = q.includes(" ") && !looksAdvancedQuery(q);

            d3.selectAll(".nodes g").each(function (d) {
                const isMatch = usePhraseMode
                    ? phraseMatchesNode(q, d)
                    : parseTokens(q)
                        .filter(t => t && t.trim().length > 0)
                        .every(t => tokenMatchesNode(t, d));

                const sel = d3.select(this);
                if (isMatch) {
                    sel.classed("node-search-highlight", true)
                        .select("circle")
                        .attr("stroke", "orange")
                        .attr("stroke-width", 4);
                } else {
                    sel.classed("node-search-highlight", false)
                        .select("circle")
                        .attr("stroke", null)
                        .attr("stroke-width", 1);
                }
            });

        } finally {
            setTimeout(() => setSearchBusy(false), 0);
        }
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener("click", () => {
            searchInput.value = "";
            clearSearchHighlights();
        });
    }

    const annotationCheckbox = document.getElementById("annotationToggle");
    const savedAnnotationState = localStorage.getItem("annotationToggle");

    if (annotationCheckbox) {
        annotationCheckbox.checked = savedAnnotationState === "true";
    }

    const markBtn = document.getElementById("markSuspiciousBtn");

    if (annotationCheckbox && markBtn) {
        annotationCheckbox.addEventListener("change", function () {
            localStorage.setItem("annotationToggle", this.checked);

            updateNodeColors();
        });
    }

    updateExplainUI();
}

function openGraphDialog() {
    const newWindow = window.open(
        "graph-window.html",
        "_blank",
        "width=1600,height=900,resizable=yes"
    );

    if (!newWindow) return;

    newWindow.onload = () => {

        const idSpan = newWindow.document.getElementById("explainedNodeId");
        if (idSpan && window._explainedNodeId != null) {
            idSpan.innerText = window._explainedNodeId;
        }

        renderGraphInNewWindow(newWindow);
        renderAllExplanationCharts(newWindow);
    };
}

function renderAllExplanationCharts(win) {
    if (!window._lastExplanation) return;

    const container = win.document.getElementById("chartsContainer");
    if (!container) return;

    container.innerHTML = "";

    renderEdgeImportanceInPanel(win, window._lastExplanation);
    renderNodeImportanceInPanel(win, window._lastExplanation);
    renderNodeFeatureImportanceInPanel(win, window._lastExplanation);
}

function renderChartInPanel(win, items, title, leftMargin = 250) {
    const container = win.document.getElementById("chartsContainer");
    if (!container) {
        return;
    }

    const block = win.document.createElement("div");
    block.className = "chart-block";

    const titleEl = win.document.createElement("div");
    titleEl.className = "chart-title";
    titleEl.innerText = title;
    block.appendChild(titleEl);

    const scrollWrapper = win.document.createElement("div");
    scrollWrapper.className = "chart-scroll";
    block.appendChild(scrollWrapper);

    const svg = win.d3.select(scrollWrapper).append("svg");

    const rowHeight = 26;
    const height = items.length * rowHeight + 20;

    const maxVal = win.d3.max(items, d => d.value) || 1;

    const tempSvg = win.d3.select(scrollWrapper)
        .append("svg")
        .attr("visibility", "hidden");

    tempSvg.remove();

    const chartWidth = 100;
    const totalWidth = chartWidth + leftMargin + 40;

    svg
        .attr("width", totalWidth)
        .attr("height", height);

    const x = win.d3.scaleLinear()
        .domain([0, maxVal])
        .range([0, chartWidth]);

    const y = win.d3.scaleBand()
        .domain(items.map(d => d.label))
        .range([0, height])
        .padding(0.3);

    const g = svg.append("g")
        .attr("transform", `translate(${leftMargin},10)`);

    g.selectAll("rect")
        .data(items)
        .enter()
        .append("rect")
        .attr("y", d => y(d.label))
        .attr("height", y.bandwidth())
        .attr("width", d => x(d.value))
        .attr("fill", "#4f46e5");

    g.selectAll("text.value")
        .data(items)
        .enter()
        .append("text")
        .attr("x", d => x(d.value) + 6)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .attr("fill", "#ffffff")
        .text(d => d.value.toFixed(2));

    g.selectAll("text.label")
        .data(items)
        .enter()
        .append("text")
        .attr("x", -10)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .style("font-size", "12px")
        .style("font-weight", "500")
        .attr("fill", "#e5e7eb")
        .text(d => d.label);

    container.appendChild(block);
}

function renderEdgeImportanceInPanel(win, explanation) {
    const container = win.document.getElementById("chartsContainer");
    if (!container) return;

    if (!Array.isArray(explanation.edge_importance)) {
        renderEmptyMessage(win, container, "Edge Importance",
            "No edge importance data returned by the model.");
        return;
    }

    const edgeMap = buildEdgeImportanceMap(explanation);

    const items = window.allGraphLinks
        .map(link => {
            const key = `${link.source.id}-${link.target.id}`;
            const score = edgeMap.get(key) ?? 0;

            return {
                label: `${link.source.id} → ${link.target.id}`,
                value: Math.abs(score)
            };
        })
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value);

    if (items.length === 0) {
        renderEmptyMessage(win, container, "Edge Importance",
            "All edge importance scores are zero.");
        return;
    }

    renderChartInPanel(win, items, "Edge Importance", 100);
}

function renderEmptyMessage(win, container, title, message) {

    const block = win.document.createElement("div");
    block.className = "chart-block";

    const titleEl = win.document.createElement("div");
    titleEl.className = "chart-title";
    titleEl.innerText = title;
    block.appendChild(titleEl);

    const msg = win.document.createElement("div");
    msg.style.padding = "20px";
    msg.style.color = "#9ca3af";
    msg.style.fontSize = "13px";
    msg.style.textAlign = "center";
    msg.innerText = message;

    block.appendChild(msg);
    container.appendChild(block);
}

function renderNodeImportanceInPanel(win, explanation) {
    const container = win.document.getElementById("chartsContainer");
    if (!container) return;

    if (!Array.isArray(explanation.node_importance)) {
        renderEmptyMessage(
            win,
            container,
            "Node Importance",
            "No node importance data returned by the model."
        );
        return;
    }

    const items = explanation.node_importance
        .map((v, i) => ({
            label: `Node ${i}`,
            value: Math.max(0, v ?? 0)
        }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value);

    if (items.length === 0) {
        renderEmptyMessage(
            win,
            container,
            "Node Importance",
            "All node importance scores are zero."
        );
        return;
    }

    renderChartInPanel(win, items, "Node Importance", 80);
}

function renderNodeFeatureImportanceInPanel(win, explanation) {
    const container = win.document.getElementById("chartsContainer");
    if (!container) return;

    const nodeId = window._explainedNodeId;

    if (
        !Array.isArray(explanation.node_feature_importance) ||
        !explanation.node_feature_importance[nodeId]
    ) {
        renderEmptyMessage(
            win,
            container,
            "Feature Importance",
            "No feature importance data returned by the model."
        );
        return;
    }

    const featureNames = explanation.feature_names || [];

    const items = explanation.node_feature_importance[nodeId]
        .map((v, i) => ({
            label: featureNames[i] ?? `Feature ${i}`,
            value: Math.abs(v ?? 0)
        }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.value - a.value);

    if (items.length === 0) {
        renderEmptyMessage(
            win,
            container,
            "Feature Importance",
            "All feature importance scores are zero."
        );
        return;
    }

    renderChartInPanel(win, items, "Feature Importance");
}

function renderGraphInNewWindow(win) {
    const container = win.document.getElementById("graphContainer");

    const tooltip = win.document.createElement("div");
    tooltip.style.position = "absolute";
    tooltip.style.pointerEvents = "none";
    tooltip.style.background = "rgba(24,24,27,0.95)";
    tooltip.style.color = "#fff";
    tooltip.style.padding = "8px 10px";
    tooltip.style.borderRadius = "6px";
    tooltip.style.fontSize = "12px";
    tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
    tooltip.style.display = "none";
    tooltip.style.maxWidth = "280px";
    tooltip.style.zIndex = "9999";

    container.appendChild(tooltip);

    const svg = d3.select(container)
        .append("svg")
        .style("width", "100%")
        .style("height", "100%");

    const nodes = window.allGraphNodes.map(d => ({
        id: d.id,
        label: d.label,
        x: d.x,
        y: d.y,
        properties: { ...d.properties }
    }));

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const links = window.allGraphLinks.map(l => ({
        source: nodeMap.get(l.source.id),
        target: nodeMap.get(l.target.id),
        type: l.type,
        properties: { ...l.properties }
    }));

    const data = { nodes, links };

    const zoomGroup = setupZoom(svg);

    const link = renderLinks(zoomGroup, data.links);

    link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    link
        .on("mouseover", function (event, d) {
            const line = win.d3.select(this);
            let opacity = 1;
            if (window._lastExplanation?.edge_importance) {
                const edgeMap = buildEdgeImportanceMap(window._lastExplanation);
                const key = `${d.source.id}-${d.target.id}`;
                const score = edgeMap.get(key);
                if (!score || Math.abs(score) === 0) {
                    opacity = 0.3;
                }
            } else {
                opacity = 0.3;
            }
            line.attr("stroke", "#ff6a00").attr("stroke-width", 5).attr("stroke-opacity", opacity);
            let html = `<div style="font-weight:600;margin-bottom:6px;">${d.source.id} → ${d.target.id}</div>`;
            const entries = Object.entries(d.properties || {});
            entries.forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    html += `
                      <div style="margin-bottom:3px;">
                          <span style="color:#9ca3af;">${key}:</span>
                          <span style="margin-left:4px;">${value}</span>
                      </div>
                    `;
                }
            });
            tooltip.innerHTML = html;
            tooltip.style.display = "block";
        })
        .on("mousemove", function (event) {
            const rect = container.getBoundingClientRect();
            tooltip.style.left = (event.clientX - rect.left + 15) + "px";
            tooltip.style.top = (event.clientY - rect.top + 15) + "px";
        })
        .on("mouseout", function (event, d) {

            const line = win.d3.select(this);

            if (window._lastExplanation?.edge_importance) {

                const edgeMap = buildEdgeImportanceMap(window._lastExplanation);
                const scores = Array.from(edgeMap.values());
                const maxVal = d3.max(scores.map(s => Math.abs(s))) || 1;

                const key = `${d.source.id}-${d.target.id}`;
                const score = edgeMap.get(key) ?? 0;

                if (typeof score === "number" && Math.abs(score) > 0) {

                    const normalized = Math.abs(score) / maxVal;

                    line
                        .attr("stroke", "#043c54")
                        .attr("stroke-width", 2 + normalized * 5)
                        .attr("stroke-opacity", 1);

                } else {

                    line
                        .attr("stroke", "#aaa")
                        .attr("stroke-width", 2)
                        .attr("stroke-opacity", 0.2);
                }

            } else {

                line
                    .attr("stroke", "#aaa")
                    .attr("stroke-width", 2)
                    .attr("stroke-opacity", 0.3);
            }

            tooltip.style.display = "none";
        });

    const linkLabels = renderLinkLabels(zoomGroup, data.links);
    if (window._lastExplanation?.edge_importance) {
        const edgeMap = buildEdgeImportanceMap(window._lastExplanation);
        linkLabels.style("display", d => {
            const key = `${d.source.id}-${d.target.id}`;
            const score = edgeMap.get(key);
            if (!score || Math.abs(score) === 0) {
                return "none";
            }
            return "block";
        });
    }

    linkLabels
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2);

    if (!window._lastExplanation) {
        link
        .attr("stroke", "#aaa")
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.3);
    }

    if (window._lastExplanation?.edge_importance && window._explainedNodeId != null) {
        const edgeMap = buildEdgeImportanceMap(window._lastExplanation);
        const scores = Array.from(edgeMap.values());
        const maxVal = d3.max(scores.map(s => Math.abs(s))) || 1;

        link
            .attr("stroke", (d) => {

                const key = `${d.source.id}-${d.target.id}`;
                const score = edgeMap.get(key);

                if (typeof score === "number" && Math.abs(score) > 0) {
                    return "#043c54";
                }

                return "#aaa";
            })
            .attr("stroke-opacity", (d) => {

                const key = `${d.source.id}-${d.target.id}`;
                const score = edgeMap.get(key);

                if (typeof score === "number" && Math.abs(score) > 0) {
                    return 1;
                }

                return 0.2;
            })
            .attr("stroke-width", (d) => {

                const key = `${d.source.id}-${d.target.id}`;
                const score = edgeMap.get(key);

                if (!score || Math.abs(score) === 0) {
                    return 2;
                }

                const normalized = Math.abs(score) / maxVal;
                return 2 + normalized * 5;
            });
    }

    const node = zoomGroup
        .append("g")
        .attr("class", "nodes")
        .selectAll("g")
        .data(data.nodes)
        .join("g");

    node.attr("transform", d => `translate(${d.x}, ${d.y})`);
    renderNodeVisuals(node);
    node
        .on("mouseover", function (event, d) {
            if (window.isExplaining) return;

            const g = win.d3.select(this);
            const circle = g.select("circle");

            circle.attr("stroke", "rgb(255,74,0)").attr("stroke-width", 5);

            const entries = Object.entries(d.properties || {});
            let html = `<div style="font-weight:600;margin-bottom:6px;">Node ${d.id}</div>`;

            entries.forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    html += `
                      <div style="margin-bottom:3px;">
                          <span style="color:#9ca3af;">${key}:</span>
                          <span style="margin-left:4px;">${value}</span>
                      </div>
                    `;
                }
            });
            tooltip.innerHTML = html;
            tooltip.style.display = "block";
        })

        .on("mousemove", function (event) {
            const rect = container.getBoundingClientRect();
            tooltip.style.left = (event.clientX - rect.left + 15) + "px";
            tooltip.style.top = (event.clientY - rect.top + 15) + "px";
        })

        .on("mouseout", function (event, d) {

            const g = win.d3.select(this);
            const circle = g.select("circle");

            if (d.id === window._explainedNodeId) {
                circle
                    .attr("stroke", "#ff007d")
                    .attr("stroke-width", 5);
            } else {
                circle
                    .attr("stroke", null)
                    .attr("stroke-width", 1);
            }

            tooltip.style.display = "none";
        });

    if (window._lastExplanation?.node_importance) {

        const scores = window._lastExplanation.node_importance;

        const colorScale = win.d3.scaleSequential()
            .domain([0, 1])
            .interpolator(win.d3.interpolateTurbo);

        node.each(function(d, i) {

            const score = scores[i];
            const g = win.d3.select(this);
            const circle = g.select("circle");
            const label = g.select("text");

            if (!score || Math.abs(score) === 0) {
                circle
                    .attr("fill", "#8C8C8CFF")
                    .attr("opacity", 0.3);
                label.style("display", "none");
                return;
            }

            circle
                .attr("fill", colorScale(score))
                .attr("opacity", 1);
            label.style("display", "block");
        });
    }


    node.each(function (d) {
        if (d.id === window._explainedNodeId) {
            const g = d3.select(this);
            g.insert("circle", ":first-child")
                .attr("r", 16)
                .attr("fill", "none")
                .attr("stroke", "#ff007d")
                .attr("stroke-width", 5);
        }
    });

    renderNodeLegend(win);

    function renderNodeLegend(win) {

        const container = win.document.getElementById("nodeLegend");
        if (!container) return;

        container.innerHTML = "";

        const width = 300;
        const height = 12;

        const svg = win.d3.select(container)
            .append("svg")
            .attr("width", width)
            .attr("height", height);

        const defs = svg.append("defs");

        const gradient = defs.append("linearGradient")
            .attr("id", "legend-gradient");

        gradient.selectAll("stop")
            .data(win.d3.range(0, 1.01, 0.01))
            .enter()
            .append("stop")
            .attr("offset", d => `${d * 100}%`)
            .attr("stop-color", d => win.d3.interpolateTurbo(d));

        svg.append("rect")
            .attr("width", width)
            .attr("height", height)
            .style("fill", "url(#legend-gradient)");

        const labels = win.document.createElement("div");
        labels.className = "legend-labels";
        labels.innerHTML = `<span>0.0</span><span>1.0</span>`;

        container.appendChild(labels);
    }
}

window.explainCurrentNode = async function () {
    if (!window.currentSelectedNode) return;
    const nodeId = window.currentSelectedNode.id;
    setExplainLoading(true);

    try {
        const predictionId = sessionStorage.getItem("predictionId");

        const url = `${API}/arien/models/prediction/${predictionId}` + `/node/${nodeId}/explain`;

        let res = await fetch(url);
        let text = await res.text();

        if (/\bNaN\b/.test(text)) {
            text = text.replace(/\bNaN\b/g, "null");
        }

        window._lastExplanation = JSON.parse(text);
        window._explainedNodeId = nodeId;

        openGraphDialog();

        const explainBtn = document.getElementById("explainNodeBtn");
        if (explainBtn) explainBtn.innerText = "Show Explanation";

    } catch (err) {
        console.error("Explain API error:", err);
    } finally {
        setExplainLoading(false);
    }
};

function setExplainLoading(isLoading) {
    const btn = document.getElementById("explainNodeBtn");

    if (btn) {
        btn.disabled = isLoading;
        btn.innerText = isLoading ? "Explaining…" : "Explain";
    }

    window.isExplaining = isLoading;

    const graph = document.getElementById("graph");
    if (graph) {
        graph.style.pointerEvents = isLoading ? "none" : "auto";
    }

    document.body.style.cursor = isLoading ? "wait" : "default";
}

function buildEdgeImportanceMap(explanation) {
    if (!explanation.edge_index || !explanation.edge_importance) {
        return new Map();
    }

    const map = new Map();

    const sources = explanation.edge_index[0];
    const targets = explanation.edge_index[1];

    for (let i = 0; i < sources.length; i++) {
        const key = `${sources[i]}-${targets[i]}`;
        const value = explanation.edge_importance[i];

        map.set(`${sources[i]}-${targets[i]}`, value);
        map.set(`${targets[i]}-${sources[i]}`, value);
    }

    return map;
}

