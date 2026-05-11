export function setupSvgCanvas() {
    const svg = d3.select("#graph");
    svg.selectAll("*").remove();
    svg.attr("height", 600);
    return svg;
}

export function setupZoom(svg) {
    const group = svg.append("g").attr("class", "zoom-group");
    svg.call(d3.zoom().scaleExtent([0.2, 4]).on("zoom", (event) => {
        group.attr("transform", event.transform);
    }));
    return group;
}

export function setupSimulation(data, svg) {
    const width = svg.node().getBoundingClientRect().width;
    return d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.links).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-400))
        .force("center", d3.forceCenter(width / 2, 300))
        .alphaDecay(0.05)
        .velocityDecay(0.4)
        .alphaMin(0.001);
}

export function renderLinks(group, links) {
    return group.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("data-edge-id", (d, i) => i)
        .attr("stroke", "#aaa")
        .attr("stroke-width", 2);
}

export function renderLinkLabels(group, links) {
    return group.append("g")
        .attr("class", "link-labels")
        .selectAll("text")
        .data(links)
        .join("text")
        .attr("text-anchor", "middle")
        .attr("dy", -5)
        .style("font-size", "10px")
        .text(d => d.type);
}

export function renderNodeVisuals(node) {
    node.append("circle").attr("r", 12);
    node.append("text")
        .attr("x", 14)
        .attr("y", 4)
        .text(d => d.properties?.name || d.id)
        .style("font-size", "12px");
}

export function linkLabel(link) {
    const source = link.source?.id ?? link.source;
    const target = link.target?.id ?? link.target;

    let html = `<strong>Type:</strong> ${link.type}<br>`;
    html += `<strong>${source} → ${target}</strong><hr>`;
    for (const [key, value] of Object.entries(link.properties || {})) {
        html += `<strong>${key}:</strong> ${value}<br>`;
    }
    return html;
}

export function clearHighlights() {
    d3.selectAll(".highlight-node").classed("highlight-node", false);
    d3.selectAll(".highlight-link").classed("highlight-link", false);
}

export function setupNodeDragging(node, simulation) {
    node.call(
        d3.drag()
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            })
    );
}


export function positionElements(link, node, linkLabels) {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
    linkLabels
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2)
        .attr("transform", function(d) {
            const x = (d.source.x + d.target.x) / 2;
            const y = (d.source.y + d.target.y) / 2;
            const angle = Math.atan2(d.target.y - d.source.y, d.target.x - d.source.x) * 180 / Math.PI;
            return `rotate(${angle}, ${x}, ${y})`;
        });
}

// export function positionElements(link, node, linkLabels, tickCount) {
//
//     link
//         .attr("x1", d => d.source.x)
//         .attr("y1", d => d.source.y)
//         .attr("x2", d => d.target.x)
//         .attr("y2", d => d.target.y);
//
//     node.attr("transform", d => `translate(${d.x},${d.y})`);
//
//     // label posodobi samo vsak 10 tick
//     if (tickCount % 10 !== 0) return;
//
//     linkLabels
//         .attr("x", d => (d.source.x + d.target.x) / 2)
//         .attr("y", d => (d.source.y + d.target.y) / 2)
//         .attr("transform", d => {
//             const x = (d.source.x + d.target.x) / 2;
//             const y = (d.source.y + d.target.y) / 2;
//             const angle = Math.atan2(
//                 d.target.y - d.source.y,
//                 d.target.x - d.source.x
//             ) * 180 / Math.PI;
//
//             return `rotate(${angle}, ${x}, ${y})`;
//         });
// }

function sanitizeNodeProperties(props) {
    const EXCLUDED_KEYS = new Set([
        "tempScore",
        "initial_label"
    ]);

    const clean = {};
    for (const [key, value] of Object.entries(props || {})) {
        if (!EXCLUDED_KEYS.has(key)) {
            clean[key] = value;
        }
    }
    return clean;
}

function sanitizeEdgeProperties(props) {
    const EXCLUDED_KEYS = new Set([]);

    const clean = {};
    for (const [key, value] of Object.entries(props || {})) {
        if (!EXCLUDED_KEYS.has(key)) {
            clean[key] = value;
        }
    }
    return clean;
}

export function setupExportButton() {
    const exportBtn = document.getElementById("exportJsonBtn");
    if (!exportBtn) {
        return;
    }

    exportBtn.addEventListener("click", function () {
        const graphData = {
            nodes: [],
            relationships: []
        };

        d3.selectAll(".nodes g").each(function () {
            const d = d3.select(this).datum();
            graphData.nodes.push({
                id: d.id,
                labels: [d.label],
                properties: sanitizeNodeProperties(d.properties)
            });
        });

        d3.selectAll(".links line").each(function () {
            const d = d3.select(this).datum();
            graphData.relationships.push({
                start: d.source.id,
                end: d.target.id,
                type: d.type,
                properties: sanitizeEdgeProperties(d.properties)
            });
        });

        const jsonBlob = new Blob([JSON.stringify(graphData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(jsonBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "updated_nodes.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

export function setupExportSuspiciousButton() {
    const exportBtn = document.getElementById("exportSuspiciousJsonBtn");
    if (!exportBtn) return;

    exportBtn.addEventListener("click", function () {

        if (!window.allGraphNodes || !Array.isArray(window.allGraphNodes)) {
            alert("No graph data available.");
            return;
        }

        const threshold = typeof window.suspicionThreshold === "number" ? window.suspicionThreshold : 0.5;

        const suspiciousNodes = window.allGraphNodes
            .filter(d =>
                typeof d.properties?.score === "number" &&
                d.properties.score >= threshold
            )
            .map(d => ({
                id: d.id,
                labels: [d.label],
                properties: sanitizeNodeProperties(d.properties)
            }));

        if (suspiciousNodes.length === 0) {
            alert("No suspicious nodes above current threshold.");
            return;
        }

        const exportData = {
            threshold,
            count: suspiciousNodes.length,
            nodes: suspiciousNodes
        };

        const jsonBlob = new Blob(
            [JSON.stringify(exportData, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(jsonBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `suspicious_nodes_threshold_${threshold}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

