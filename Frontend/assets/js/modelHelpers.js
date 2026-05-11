export function createStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = 'badge rounded-pill';
    badge.textContent = status || 'UNKNOWN';

    switch (status) {
        case 'PREPROCESSING': badge.classList.add('bg-info'); break;
        case 'LEARNING': badge.classList.add('bg-warning', 'text-dark'); break;
        case 'COMPLETED': badge.classList.add('bg-success'); break;
        default: badge.classList.add('bg-secondary');
    }

    return badge;
}

export function createTimeSection(status) {
    const timeCreated = status.timeCreated ? parseCustomDate(status.timeCreated).toLocaleString() : 'N/A';
    const timeChanged = status.timeChanged ? parseCustomDate(status.timeChanged).toLocaleString() : 'N/A';

    const div = document.createElement('div');
    div.className = 'text-muted small mt-1';
    div.innerHTML = `
        Created: ${timeCreated}<br>
        Last Updated: ${timeChanged}
    `;
    return div;
}

export function createTopLeftSection(status) {
    const paramDesc = status.modelParameters?.description || "Unknown parameters";
    const dataName = status.dataa?.name || "Unknown data";
    const predictionLabel = status.learningLabel;
    let smote = "";
    let embeddings = "";

    if (status.smote === 0) {
        smote = "No";
    } else {
        smote = "Yes";
    }

    if (status.embedding === 0) {
        embeddings = "No";
    } else {
        embeddings = "Yes";
    }

    const div = document.createElement('div');
    div.innerHTML = `
        <strong>Parameters:</strong> ${paramDesc}<br>
        <strong>Data:</strong> ${dataName}<br>
        <strong>Prediction label:</strong> ${predictionLabel}<br>
        <strong>Used graph smote:</strong> ${smote}<br>
        <strong>Used node embeddings:</strong> ${embeddings}
    `;
    return div;
}

function parseCustomDate(dateStr) {
    const [day, month, yearAndTime] = dateStr.split('-');
    const [year, time] = yearAndTime.split(' ');
    return new Date(`${year}-${month}-${day}T${time}`);
}

export function showAlert(message, type = 'info', timeout = 5000) {
    const container = document.getElementById('alertContainer') || (() => {
        const c = document.createElement('div');
        c.id = 'alertContainer';
        c.style.position = 'fixed';
        c.style.bottom = '20px';
        c.style.left = '50%';
        c.style.transform = 'translateX(-50%)';
        c.style.zIndex = '1055';
        c.style.maxWidth = '90%';
        c.style.width = 'auto';
        c.style.minWidth = '300px';
        document.body.appendChild(c);
        return c;
    })();

    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show d-flex justify-content-between align-items-center px-2 py-2`;
    alert.setAttribute('role', 'alert');

    alert.innerHTML = `
        <span class="me-4 flex-grow-1">${message}</span>
        <button type="button" class="btn-close ms-auto" style="transform: scale(0.8) translateY(-8px);" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    container.appendChild(alert);

    setTimeout(() => {
        alert.classList.remove('show');
        alert.addEventListener('transitionend', () => alert.remove());
    }, timeout);
}

export function enableLabelInput() {
    const container = document.getElementById('labelInputContainer');
    const selectEl  = document.getElementById('labelSelect');

    if (container) container.style.display = 'block';

    if (!selectEl) {
        return;
    }

    if (!selectEl.dataset.listenerAdded) {
        selectEl.addEventListener('change', () => {
            window.selectedLabelAttribute = selectEl.value || '';
        });
        selectEl.dataset.listenerAdded = 'true';
    }
}

export function resetLabelInput() {
    window.selectedLabelAttribute = '';

    const container = document.getElementById('labelInputContainer');
    const selectEl  = document.getElementById('labelSelect');

    if (container) container.style.display = 'none';

    if (selectEl) {
        selectEl.innerHTML = '<option selected disabled>Choose attribute from dataset…</option>';
        selectEl.classList.add('d-none');
    }
}
