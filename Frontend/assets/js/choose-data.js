// const API = "https://gpu1.gemma.feri.um.si/general"
const API = "https://gpu1.gemma.feri.um.si/devel"
let datasetMap = new Map();
let lastLoadedDatasetId = null;


document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('content');
    if (!content) {
        return;
    }

    let alreadyInitialized = false;

    function tryInit() {
        const select = document.getElementById('previousData');
        if (select && !alreadyInitialized) {
            alreadyInitialized = true;
            populateDatasetSelect();
            initializeChooseData();
            restoreSelectedData();
        }
        if (!select && alreadyInitialized) {
            alreadyInitialized = false;
        }
    }

    const observer = new MutationObserver(() => tryInit());
    observer.observe(content, { childList: true, subtree: true });
    tryInit();

    const tabLinks = document.querySelectorAll('.nav-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (link.textContent === 'Choose Data') {
                populateDatasetSelect();
            }
        });
    });
});

async function populateDatasetSelect() {
    try {
        const resp = await fetch(`${API}/arien/data`);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const datasets = await resp.json();

        const select = document.getElementById('previousData');
        select.innerHTML = '<option selected disabled>Select from previous data</option>';

        datasets.forEach(ds => {
            const opt = document.createElement('option');
            opt.value = ds.id;
            opt.textContent = ds.name;
            select.appendChild(opt);
            datasetMap.set(ds.id, ds);
        });

        restoreSelectedData();

    } catch (err) {
        console.error("Error loading previous datasets:", err);
    }
}

function restoreSelectedData() {
    const selectedDataId = sessionStorage.getItem('selectedDataId');
    if (selectedDataId) {
        const select = document.getElementById('previousData');
        const options = select.getElementsByTagName('option');
        for (let option of options) {
            if (option.value === selectedDataId) {
                option.selected = true;
                break;
            }
        }
        window.selectedDataId = parseInt(selectedDataId);
        select.dispatchEvent(new Event('change'));
    }
}

function initializeChooseData() {
    const select = document.getElementById('previousData');

    select.addEventListener('change', (e) => {
        const id = parseInt(e.target.value);
        if (!id) return;

        if (lastLoadedDatasetId !== id) {

            lastLoadedDatasetId = id;

            const selectedDataset = datasetMap.get(id);
            if (!selectedDataset) return;

            window.selectedDataId = id;
            sessionStorage.setItem('selectedDataId', id);
            sessionStorage.setItem('selectedDataName', selectedDataset.name);

            sessionStorage.removeItem('predictedLabels');
            sessionStorage.removeItem('predictedProbabilities');
            sessionStorage.removeItem('predictedPercentiles');

            localStorage.setItem("graphMode", "original");
            const oldDatasetName = sessionStorage.getItem('selectedDataName');

            if (oldDatasetName) {
                localStorage.removeItem(`suspiciousScores:${oldDatasetName}`);
            }

            window.suspiciousNodes = new Set();
            window.allGraphNodes = [];
        }
    });
    document.getElementById('deleteBtn').addEventListener('click', async () => {
        const select = document.getElementById('previousData');
        const selectedId = select.value;

        if (!selectedId || select.selectedIndex === 0) {
            return showAlert("Please select a dataset to delete!", "warning");
        }

        const dataset = datasetMap.get(parseInt(selectedId));
        if (!dataset) return;

        const confirmDelete = confirm(`Are you sure you want to delete dataset "${dataset.name}"?`);
        if (!confirmDelete) return;

        try {
            const deleteResp = await fetch(`${API}/arien/data/${encodeURIComponent(dataset.name)}`, {
                method: 'DELETE'
            });

            if (!deleteResp.ok) {
                throw new Error(`Delete failed with status ${deleteResp.status}`);
            }

            datasetMap.delete(parseInt(selectedId));
            showAlert(`Dataset "${dataset.name}" deleted successfully.`, "success");

            await populateDatasetSelect();
            sessionStorage.removeItem('selectedDataId');
            sessionStorage.removeItem('selectedDataName');
            window.selectedDataId = null;

        } catch (err) {
            console.error("Delete error:", err);
            showAlert("Failed to delete dataset.", "danger");
        }
    });

    document.getElementById('uploadBtn')
        .addEventListener('click', async () => {
            const fileInput = document.getElementById('jsonFile');
            const urlInput  = document.getElementById('jsonUrl');
            let rawJson, dataName;

            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                dataName = file.name.replace(/\.json$/i, '');
                rawJson = await file.text();
            }
            else if (urlInput.value) {
                try {
                    const resp = await fetch(urlInput.value);

                    if (!resp.ok) {
                        throw new Error(`HTTP ${resp.status}`);
                    }

                    rawJson  = await resp.text();
                    dataName = urlInput.value.split('/').pop().replace(/\.json$/i, '');
                } catch (err) {
                    return console.log(err);
                }
            } else {
                return showAlert("Please choose a file or enter a JSON URL!", "warning");
            }

            const descriptionInput = document.getElementById('jsonDescription');
            const description = descriptionInput.value.trim();

            if (!description) {
                return showAlert("Please enter a description before uploading!", "warning");
            }

            const payload = {
                description,
                data: rawJson
            };

            try {
                const uploadResp = await fetch(
                    `${API}/arien/data/${encodeURIComponent(dataName)}/upload`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }
                );

                if (!uploadResp.ok) {
                    const bodyText = await uploadResp.text();
                    let errBody;
                    try {
                        errBody = JSON.parse(bodyText);
                    } catch {
                        errBody = bodyText;
                    }

                    console.error("Server returned error:", errBody);
                    throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}`);
                }
                await populateDatasetSelect();

            } catch (err) {
                showAlert("Error during upload: data name should be unique", "danger");
            }
        });
}

function showAlert(message, type = 'info', timeout = 5000) {
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
