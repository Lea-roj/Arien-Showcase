import {
    createStatusBadge,
    createTimeSection,
    createTopLeftSection,
    enableLabelInput,
    showAlert,
    resetLabelInput
} from './modelHelpers.js'

let modelMap = new Map();
let selectedModelName = null;
let paramMap = new Map();
let defaultParametersId = null;
let learningMode = "supervised";

let predictingCache = {
    supervised: null,
    unsupervised: null
};

document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('content');

    if (!content) return;
    let alreadyInitialized = false;

    function tryInit() {
        const select = document.getElementById('selectModel');
        const simulateBtn = document.getElementById('simulatePrediction');

        if (simulateBtn && !simulateBtn.dataset.listenerAdded) {
            simulateBtn.addEventListener('click', async () => {
                if (!window.selectedParametersId) {
                    return showAlert("No parameter set selected!", "warning");
                }
            });

            simulateBtn.dataset.listenerAdded = "true";
        }

        if (select && !alreadyInitialized) {
            alreadyInitialized = true;
            initPage();

            const btn = document.getElementById("modelHelpBtn");
            const box = document.getElementById("modelHelpText");

            if (btn && box && !btn.dataset.listenerAdded) {
                btn.addEventListener("click", () => {
                    box.style.display = (box.style.display === "none") ? "block" : "none";
                });
                btn.dataset.listenerAdded = "true";
            }
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

        });
    });

    const btn = document.getElementById("modelHelpBtn");
    const box = document.getElementById("modelHelpText");

    if (btn && box) {
        btn.addEventListener("click", () => {
            box.style.display = (box.style.display === "none") ? "block" : "none";
        });
    }

});

async function populateModelSelect() {
    const response = await fetch(`${API}/arien/models`);
    if (!response.ok) throw new Error(response.status);
    const models = await response.json();

    const selModel = document.getElementById('selectModel');
    selModel.innerHTML = '<option selected disabled>Choose a model …</option>';

    const descriptions = {
        "SAGEConv": "Fastest",
        "GATConv": "Better accuracy, but slower",
        "TransformerConv": "Most advanced, but slowest",
        "GraphConv": "Balance between speed and accuracy"
    };

    const withDesc = models.filter(m => descriptions[m.name]);
    const withoutDesc = models.filter(m => !descriptions[m.name]);

    const ordered = [...withDesc, ...withoutDesc];

    ordered.forEach(m => {
        const o = document.createElement('option');
        o.value = m.name;
        if (descriptions[m.name]) {
            o.textContent = `${m.name} – ${descriptions[m.name]}`;
        } else {
            o.textContent = m.name;
        }

        selModel.append(o);
        modelMap.set(m.name, m);
    });
}

function initPage() {
    const completedContainer = document.getElementById('completedStatusList');
    const predictionContainer = document.getElementById('predictionStatusList');

    if (completedContainer) {
        completedContainer.innerHTML = `<div class="text-muted">Loading...</div>`;
    }

    if (predictionContainer) {
        predictionContainer.innerHTML = `<div class="text-muted">Loading...</div>`;
    }
    populateModelSelect();
    initializeChooseModel();
    attachLearningModeToggleListeners();
    renderLearningStatus();
    renderPredictingStatus();
    attachUnsupervisedPredictionHandler();

    const modeSup = document.getElementById("modeSupervised");
    const modeUnsup = document.getElementById("modeUnsupervised");
    if (modeSup && modeUnsup) {
        modeSup.checked = true;
        modeUnsup.checked = false;
    }

    learningMode = "supervised";
    updateLearningModeUI();
    updateLearningModeButtons();

    const unsupSelect = document.getElementById("unsupervisedModeSelect");
    const embUnsup = document.getElementById("cbNodeEmbeddingsUnsupervised");
    if (unsupSelect) unsupSelect.value = "ae";
    if (embUnsup)   embUnsup.checked = false;
}


function attachUnsupervisedPredictionHandler() {
    const btn = document.getElementById("runPredictionsUnsupervised");
    if (!btn || btn.dataset.listenerAdded) return;

    btn.addEventListener("click", async () => {
        localStorage.setItem("graphMode", "unsupervised");
        const unsupervisedMode = document.getElementById("unsupervisedModeSelect").value;
        const embeddingFlag = document.getElementById("cbNodeEmbeddingsUnsupervised").checked ? 1 : 0;

        const dataId = window.selectedDataId;

        if (!dataId) {
            return showAlert("Please select or load a dataset.", "warning");
        }

        try {
            const url =
                `${API}/arien/models/learning/0` +
                `/data/${encodeURIComponent(dataId)}` +
                `/label/_none_` +
                `/smote/0` +
                `/unsupervised/${encodeURIComponent(unsupervisedMode)}` +
                `/embedding/${embeddingFlag}` +
                `/predict`;

            const res = await fetch(url, { method: "POST" });
            if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

            showAlert("Unsupervised prediction started!", "success");
        } catch (err) {
            showAlert("Failed to start prediction: " + err.message, "danger");
        }
    });

    btn.dataset.listenerAdded = "true";
}




function attachLearningModeToggleListeners() {
    const supervisedBtn = document.getElementById("modeSupervised");
    const unsupervisedBtn = document.getElementById("modeUnsupervised");

    if (!supervisedBtn || !unsupervisedBtn) return;

    supervisedBtn.addEventListener("change", () => {
        learningMode = "supervised";
        renderPredictingStatus();
        updateLearningModeUI();
        updateLearningModeButtons();
    });

    unsupervisedBtn.addEventListener("change", () => {
        autoRefresh = false;
        learningMode = "unsupervised";
        renderPredictingStatus();
        updateLearningModeUI();
        updateLearningModeButtons();
        renderPredictingStatus();
        setTimeout(() => autoRefresh = true, 600);
    });

}


function initializeChooseModel() {
    const selectModelEl = document.getElementById('selectModel');
    const advancedBtn = document.getElementById('toggleAdvancedBtn');

    window.selectedParametersId = null;

    const quick = document.getElementById('parameterQuickSelect');
    if (quick) {
        quick.innerHTML = '<option selected disabled>Choose parameters…</option>';
        quick.disabled = true;
    }

    if (advancedBtn) {
        advancedBtn.disabled = true;
    }

    selectModelEl.addEventListener('change', async () => {
        selectedModelName = selectModelEl.value;

        if (!selectedModelName) {
            if (advancedBtn) {
                advancedBtn.disabled = true;
            }
            return;
        }

        if (advancedBtn) {
            advancedBtn.disabled = false;
        }

        resetLabelInput();
        await populateParametersSelect(selectedModelName);

        const uploadBtn = document.getElementById('uploadParameters');
        if (uploadBtn && !uploadBtn.dataset.listenerAdded) {
            uploadBtn.addEventListener('click', () => {
                const fileInput = document.getElementById('paramFile');
                if (!selectedModelName) {
                    return showAlert("Select model first!", "warning");
                }
                if (fileInput.files.length === 0) {
                    return showAlert("Select JSON", "warning");
                }
                uploadParameters(selectedModelName, fileInput.files[0]);
            });
            uploadBtn.dataset.listenerAdded = "true";
        }
    });

    document.getElementById('startLearning')
        .addEventListener('click', async () => {
            const finalLabel = learningMode === "supervised" ? window.selectedLabelAttribute : "_none_";

            if (learningMode === "supervised") {
                if (!window.selectedLabelAttribute || window.selectedLabelAttribute === "undefined") {
                    return showAlert("Please select a VALID label attribute before training.", "danger");
                }
            }

            const paramsId = window.selectedParametersId;
            const dataId = window.selectedDataId;

            if (!paramsId || !dataId) {
                return showAlert("Please confirm parameters and data!", "warning");
            }

            const statusEl = document.getElementById('learningStatus');
            const startBtn = document.getElementById('startLearning');
            statusEl.classList.remove('d-none');
            startBtn.disabled = true;
            const useGraphSmote = document.getElementById("cbGraphSmote").checked ? 1 : 0;
            const useNodeEmb = document.getElementById("cbNodeEmbeddings").checked ? 1 : 0;


            try {
                const url = `${API}/arien/models/${encodeURIComponent(selectedModelName)}` +
                    `/parameters/${encodeURIComponent(paramsId)}` +
                    `/data/${encodeURIComponent(dataId)}` +
                    `/label/${encodeURIComponent(finalLabel)}` +
                    `/smote/${useGraphSmote}` +
                    `/embedding/${useNodeEmb}` +
                    `/learn`;
                const res = await fetch(url, { method: 'POST' });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`${res.status}: ${txt}`);
                }

                showAlert("Model learning started!", "info");
            } catch (err) {
                showAlert("Error training model: " + err.message, "danger");
            } finally {
                startBtn.disabled = false;
            }
        });
}

async function populateParametersSelect(modelName) {
    try {
        const response = await fetch(`${API}/arien/models/${encodeURIComponent(modelName)}/parameters`);
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const params = await response.json();

        const list = document.getElementById('paramList');
        const defaultEditor = document.getElementById('defaultParamEditor');
        const quick = document.getElementById('parameterQuickSelect');

        list.innerHTML = '';
        defaultEditor.innerHTML = '';
        paramMap.clear();

        const defaultParam = params.find(p => (p.description || '').toLowerCase().includes('default'));
        defaultParametersId = defaultParam ? Number(defaultParam.id) : null;

        let defaultValues = null;
        if (defaultParam) {
            const res = await fetch(`${API}/arien/models/${encodeURIComponent(modelName)}/parameters/${defaultParam.id}`);
            if (res.ok) {
                defaultValues = await res.json();
            }

            await showParameterValuesInline(modelName, Number(defaultParam.id), defaultEditor, true);
        }

        for (const p of params) {
            if (defaultParam && p.id === defaultParam.id) {
                continue;
            }

            const cardContainer = document.createElement('div');
            paramMap.set(p.id, p);
            await showParameterValuesInline(modelName, Number(p.id), cardContainer, false, defaultValues);
            list.appendChild(cardContainer);
        }

        if (quick) {
            quick.innerHTML = '';
            quick.disabled = true;

            const addOpt = (id, label) => {
                const opt = document.createElement('option');
                opt.value = String(id);
                opt.textContent = label;
                quick.appendChild(opt);
            };

            if (defaultParam) addOpt(defaultParam.id, 'Default');

            params
                .filter(p => !defaultParam || p.id !== defaultParam.id)
                .forEach(p => addOpt(p.id, p.description || `Set #${p.id}`));

            quick.disabled = quick.options.length === 0;

            if (!quick.disabled && quick.options.length > 0) {
                const firstId = Number(quick.options[0].value);
                selectParameterSet(firstId);
            }

            if (!quick.dataset.listenerAdded) {
                quick.addEventListener('change', () => {
                    selectParameterSet(Number(quick.value));
                });
                quick.dataset.listenerAdded = 'true';
            }
        }

        const radios = document.querySelectorAll('input[name="selectedParameters"]');
        radios.forEach(radio => {
            if (!radio.dataset.listenerAdded) {
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        const chosenId = Number(radio.value);
                        window.selectedParametersId = chosenId;
                        const quick = document.getElementById('parameterQuickSelect');
                        if (quick) quick.value = String(chosenId);
                    }
                });
                radio.dataset.listenerAdded = 'true';
            }
        });
    } catch (e) {
        console.error('Error loading parameters:', e);
        showAlert?.('Error loading parameters: ' + (e?.message || e), 'danger');
    }
}


async function uploadParameters(modelName, file) {
    const text = await file.text();
    const description = prompt("Description:", "");

    if (description === null || description.trim() === "") {
        showAlert("Description is required.", "warning");
        return;
    }

    let parsedParameters;
    try {
        parsedParameters = JSON.parse(text);
        const defaultParam = [...paramMap.values()].find(p => p.description?.toLowerCase().includes('default'));
        let defaultValues = {};
        if (defaultParam) {
            const res = await fetch(`${API}/arien/models/${encodeURIComponent(modelName)}/parameters/${defaultParam.id}`);
            if (res.ok) {
                defaultValues = JSON.parse(await res.text());
            }
        }
        parsedParameters = { ...defaultValues, ...parsedParameters };
    } catch (err) {
        showAlert("Invalid JSON in file.", "danger");
        return;
    }

    try {
        const response = await fetch(
            `${API}/arien/models/${encodeURIComponent(modelName)}/parameters`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    description: description.trim(),
                    parameters: JSON.stringify(parsedParameters)
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${response.status}: ${errorText}`);
        }

        showAlert("Parameters uploaded!", "success");
        await populateParametersSelect(modelName);
    } catch (err) {
        showAlert("Error uploading: " + err.message, "danger");
    }
}

async function showParameterValuesInline(modelName, parametersId, container, editable = false, defaultValues = null) {
    try {
        const url = `${API}/arien/models/${encodeURIComponent(modelName)}/parameters/${encodeURIComponent(parametersId)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Error fetching parameter values: ${res.status}`);

        let paramValues = await res.text();
        paramValues = JSON.parse(paramValues);

        if (!editable && defaultValues) {
            paramValues = { ...defaultValues, ...paramValues };
        }

        container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'card border mb-3 shadow-sm';

        const uniqueCollapseId = `paramCollapse-${parametersId}-${Math.random().toString(36).substring(2, 7)}`;

        if (!editable && paramMap.has(parametersId)) {
            const header = document.createElement('div');
            header.className = 'card-header bg-light d-flex justify-content-between align-items-center';
            header.style.cursor = 'pointer';

            const title = document.createElement('strong');
            title.textContent = paramMap.get(parametersId).description || 'Parameter Set';

            const icon = document.createElement('span');
            icon.innerHTML = '&#x25BC;';
            icon.classList.add('ms-auto');

            header.appendChild(title);
            header.appendChild(icon);
            header.addEventListener('click', () => {
                const collapseEl = document.getElementById(uniqueCollapseId);
                const isShown = collapseEl.classList.contains('show');

                collapseEl.classList.toggle('show');
                icon.innerHTML = isShown ? '&#x25BC;' : '&#x25B2;';
            });
            card.appendChild(header);
        }

        const body = document.createElement('div');
        body.className = 'card-body';

        let collapseWrapper;
        const form = document.createElement(editable ? 'form' : 'div');
        form.className = editable ? 'param-edit-form' : 'param-view-form';

        Object.entries(paramValues).forEach(([key, value]) => {
            const group = document.createElement('div');
            group.className = 'mb-2 row align-items-center';

            const labelWrapper = document.createElement('div');
            labelWrapper.className = 'col-sm-3';

            const label = document.createElement('label');
            label.textContent = key;
            label.className = 'form-label mb-0 fw-semibold';
            labelWrapper.appendChild(label);

            const valueWrapper = document.createElement('div');
            valueWrapper.className = 'col-sm-9';

            if (editable) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'form-control';
                input.placeholder = typeof value === 'object' ? JSON.stringify(value) : value;
                input.name = key;

                if (key === 'gcn_class') {
                    input.disabled = true;
                }
                valueWrapper.appendChild(input);
            } else {
                const text = document.createElement('div');
                text.className = 'form-control-plaintext border rounded px-3 py-2 bg-light';
                text.textContent = typeof value === 'object' ? JSON.stringify(value) : value;

                valueWrapper.appendChild(text);
            }

            group.append(labelWrapper, valueWrapper);
            form.appendChild(group);
        });

        if (editable) {
            const editableWrapper = document.createElement('div');
            editableWrapper.className = 'card-body';
            editableWrapper.appendChild(form);
            card.appendChild(editableWrapper);
        } else {
            collapseWrapper = document.createElement('div');
            collapseWrapper.className = 'collapse';
            collapseWrapper.id = uniqueCollapseId;

            const body = document.createElement('div');
            body.className = 'card-body';
            body.appendChild(form);

            collapseWrapper.appendChild(body);
            card.appendChild(collapseWrapper);
        }

        if (!editable) {
            const radioWrapper = document.createElement('div');
            radioWrapper.className = 'form-check mt-3 d-flex justify-content-between align-items-center';

            const left = document.createElement('div');
            left.className = 'd-flex align-items-center gap-2';

            const radio = document.createElement('input');
            radio.className = 'form-check-input';
            radio.type = 'radio';
            radio.name = 'selectedParameters';
            radio.id = `select-param-${parametersId}`;
            radio.value = parametersId;

            radio.addEventListener('change', () => {
                if (radio.checked) selectParameterSet(parametersId);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-outline-danger';
            deleteBtn.title = 'Delete this parameter set';
            deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';

            deleteBtn.addEventListener('click', async () => {
                if (!confirm("Are you sure you want to delete this parameter set?")) return;

                try {
                    const res = await fetch(`${API}/arien/models/${encodeURIComponent(modelName)}/parameters/${parametersId}`, {
                        method: 'DELETE'
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        throw new Error(`${res.status}: ${errorText}`);
                    }

                    showAlert("Parameter set deleted successfully.", "success");
                    await populateParametersSelect(modelName);
                } catch (err) {
                    showAlert("Failed to delete parameter set: " + err.message, "danger");
                }
            });

            radioWrapper.appendChild(left);
            radioWrapper.appendChild(deleteBtn);
            collapseWrapper.querySelector('.card-body')?.appendChild(radioWrapper);
        }


        container.appendChild(card);


        if (editable) {
            const descriptionGroup = document.createElement('div');
            descriptionGroup.className = 'mb-3';

            const descriptionLabel = document.createElement('label');
            descriptionLabel.textContent = 'Parameter Set Description';
            descriptionLabel.className = 'form-label fw-semibold';

            const descriptionInput = document.createElement('input');
            descriptionInput.type = 'text';
            descriptionInput.className = 'form-control';
            descriptionInput.placeholder = 'Enter a unique description for this parameter set';

            descriptionGroup.append(descriptionLabel, descriptionInput);
            container.appendChild(descriptionGroup);

            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Save Parameter Set';
            saveBtn.className = 'btn btn-outline-primary mt-3';
            saveBtn.type = 'button';

            saveBtn.addEventListener('click', async () => {
                const inputs = form.querySelectorAll('input');
                const parameters = {};

                inputs.forEach(input => {
                    let val = input.value.trim();
                    if (!val) {
                        val = input.placeholder?.trim();
                    }
                    try {
                        val = JSON.parse(val);
                    } catch (_) {

                    }
                    if (input.name !== 'id') {
                        parameters[input.name] = val;
                    }
                });

                const description = descriptionInput?.value?.trim();
                if (!description) {
                    showAlert("Please enter a description for the parameter set.", "warning");
                    return;
                }

                const existingDescriptions = Array.from(paramMap.values()).map(p => p.description?.toLowerCase());
                if (existingDescriptions.includes(description.toLowerCase())) {
                    showAlert("A parameter set with this description already exists. Please choose a unique one.", "warning");
                    return;
                }

                try {
                    const response = await fetch(`${API}/arien/models/${encodeURIComponent(modelName)}/parameters`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            description,
                            parameters: JSON.stringify(parameters)
                        })
                    });

                    if (!response.ok) {
                        const txt = await response.text();
                        throw new Error(`${response.status}: ${txt}`);
                    }
                    await populateParametersSelect(modelName);
                    const newly = [...paramMap.values()].find(
                        p => (p.description || "").toLowerCase() === description.toLowerCase()
                    );
                    if (newly) {
                        selectParameterSet(newly.id);
                    }
                    showAlert("Parameter set saved!", "success");

                } catch (err) {
                    if (err.message.includes('SQLITE_CONSTRAINT_UNIQUE') || err.message.includes('UNIQUE constraint failed')) {
                        showAlert("A parameter set with that description already exists. Please choose a unique one.", "warning");
                    } else {
                        showAlert("Failed to save parameters: " + err.message, "danger");
                    }
                }
            });

            container.appendChild(saveBtn);
        }

    } catch (err) {
        showAlert("Failed to load parameters: " + err.message, "danger")
    }
}

async function loadLearningStatus() {
    try {
        const res = await fetch(`${API}/arien/models/learningStatus`);
        if (!res.ok) {
            throw new Error(`Status ${res.status}`);
        }
        return await res.json();
    } catch (err) {
        showAlert("Failed to load learning statuses: " + err.message, "danger");
        return [];
    }
}

function parseCustomDate(dateStr) {
    const [day, month, yearAndTime] = dateStr.split('-');
    const [year, time] = yearAndTime.split(' ');
    return new Date(`${year}-${month}-${day}T${time}`);
}

async function renderLearningStatus() {
    const learningContainer = document.getElementById('learningStatusList');
    const completedContainer = document.getElementById('completedStatusList');
    if (!learningContainer || !completedContainer) return;

    const statuses = await loadLearningStatus();
    const selectedDataId = Number(sessionStorage.getItem("selectedDataId"));

    const filteredByDataset = statuses.filter(st =>
        Number(st.dataa?.id) === selectedDataId
    );

    filteredByDataset.sort((a, b) => {
        const da = parseDDMMYYYY(a.timeCreated);
        const db = parseDDMMYYYY(b.timeCreated);
        return db - da;
    });

    learningContainer.innerHTML = '';
    completedContainer.innerHTML = '';

    const learningList = document.createElement('ul');
    learningList.className = 'list-group mt-2';

    const completedList = document.createElement('ul');
    completedList.className = 'list-group mt-2';

    filteredByDataset.forEach(status => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-start flex-column';

        const topSection = createTopLeftSection(status);
        const timeSection = createTimeSection(status);
        const right = document.createElement('div');
        right.className = 'd-flex align-items-center gap-2 mt-2 align-self-end';

        const badge = createStatusBadge(status.status);

        if (status.status === 'PREPROCESSING' || status.status === 'LEARNING') {
            const stopBtn = createStopButton(status.id);
            right.append(badge, stopBtn);
            li.append(topSection, timeSection, right);
            learningList.appendChild(li);
        } else if (status.status === 'COMPLETED') {
            const predictBtn = createPredictButton(status);
            const trashBtn = createDeleteLearningButton(status.id);
            right.append(badge, predictBtn, trashBtn);
            li.append(topSection, timeSection, right);
            completedList.appendChild(li);
        } else {
            right.appendChild(badge);
            li.append(topSection, timeSection, right);
            learningList.appendChild(li);
        }
    });

    learningContainer.appendChild(learningList);

    if (completedList.children.length === 0) {
        completedContainer.innerHTML = `<div class="text-muted">No trainings completed.</div>`;
    } else {
        completedContainer.appendChild(completedList);
    }
}

function createStopButton(learningId) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-danger btn-sm';
    btn.textContent = 'Stop';
    btn.addEventListener('click', async () => {
        try {
            const res = await fetch(`${API}/arien/models/learning/${learningId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
            showAlert("Learning stopped successfully.", "success");
            await renderLearningStatus();
        } catch (err) {
            showAlert("Failed to stop learning: " + err.message, "danger");
        }
    });
    return btn;
}

function createPredictButton(status) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-primary btn-sm';
    btn.textContent = 'Run Prediction';

    btn.addEventListener('click', async () => {
        const isSupervised =
            status.unsupervised === null ||
            status.unsupervised === undefined ||
            status.unsupervised === "" ||
            status.unsupervised === "no" ||
            status.unsupervised === 0;

        let label;
        let smoteFlag;
        let embeddingFlag;
        let unsupervisedMode;

        if (isSupervised) {
            label = status.learningLabel;
            if (!label) {
                return showAlert("No label available for supervised prediction.", "warning");
            }

            smoteFlag = status.smote ? 1 : 0;
            embeddingFlag = status.embedding ? 1 : 0;
            unsupervisedMode = "no";
        } else {
            label = "_none_";
            smoteFlag = 0;
            embeddingFlag = status.embedding ? 1 : 0;
            unsupervisedMode = status.unsupervised;
        }

        try {
            const url =
                `${API}/arien/models/learning/${encodeURIComponent(status.id)}` +
                `/data/${encodeURIComponent(status.dataa.id)}` +
                `/label/${encodeURIComponent(label)}` +
                `/smote/${smoteFlag}` +
                `/unsupervised/${encodeURIComponent(unsupervisedMode)}` +
                `/embedding/${embeddingFlag}` +
                `/predict`;

            const res = await fetch(url, { method: 'POST' });
            if (!res.ok) {
                throw new Error(`${res.status}: ${await res.text()}`);
            }

            showAlert("Prediction started successfully!", "success");

            predictingCache.supervised = null;
            predictingCache.unsupervised = null;
        } catch (err) {
            showAlert("Failed to start prediction: " + err.message, "danger");
        }
    });

    return btn;
}

function createDeleteLearningButton(learningInstructionId) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-danger btn-sm ms-1';
    btn.title = 'Delete Learning Instruction';
    btn.innerHTML = '<i class="bi bi-trash"></i>';

    btn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to delete this?")) return;
        try {
            const res = await fetch(`${API}/arien/models/learned/${learningInstructionId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
            showAlert("Learning instruction deleted.", "success");
            await renderLearningStatus();
        } catch (err) {
            showAlert("Failed to delete learning instruction: " + err.message, "danger");
        }
    });
    return btn;
}

function createDeletePredictionButton(predictionInstructionId) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-danger btn-sm ms-1';
    btn.title = 'Delete Prediction Instruction';
    btn.innerHTML = '<i class="bi bi-trash"></i>';

    btn.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to delete this prediction?")) return;
        try {
            const res = await fetch(`${API}/arien/models/predicted/${predictionInstructionId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
            showAlert("Prediction instruction deleted.", "success");
            predictingCache.supervised = null;
            predictingCache.unsupervised = null;
            await renderPredictingStatus();
        } catch (err) {
            showAlert("Failed to delete prediction instruction: " + err.message, "danger");
        }
    });
    return btn;
}

async function safeJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        console.error("Backend returned non-JSON:", text);
        throw new Error(text);
    }
}

function parseDDMMYYYY(dateStr) {
    if (!dateStr) return 0;

    const [datePart, timePart] = dateStr.split(" ");
    if (!datePart || !timePart) return 0;

    const [dd, mm, yyyy] = datePart.split("-").map(Number);
    const [hh, mi, ss] = timePart.split(":").map(Number);

    return new Date(yyyy, mm - 1, dd, hh, mi, ss);
}


async function renderPredictingStatus(forceRefresh = false) {
    const container = document.getElementById('predictionStatusList');
    if (!container) return;

    const mode = learningMode === "supervised" ? "supervised" : "unsupervised";

    let statuses = predictingCache[mode];

    if (forceRefresh || !statuses) {
        const res = await fetch(`${API}/arien/models/predictingStatus`);
        if (!res.ok) throw new Error(`Status ${res.status}`);

        const data = await res.json();

        predictingCache.supervised = data.filter(st =>
            st.unsupervised === null ||
            st.unsupervised === undefined ||
            st.unsupervised === "" ||
            st.unsupervised === "no" ||
            st.unsupervised === 0
        );

        predictingCache.unsupervised = data.filter(st =>
            !(st.unsupervised === null ||
                st.unsupervised === undefined ||
                st.unsupervised === "" ||
                st.unsupervised === "no" ||
                st.unsupervised === 0)
        );

        statuses = predictingCache[mode];
    }
    const selectedDataId = Number(sessionStorage.getItem("selectedDataId"));

    const datasetFiltered = statuses.filter(st =>
        Number(st.dataa?.id) === selectedDataId
    );

    container.innerHTML = '';

    function getUiMode() {
        const unsup = document.getElementById("modeUnsupervised");
        return (unsup && unsup.checked) ? 1 : 0;
    }

    function getBackendMode(st) {
        const v = st.unsupervised;

        if (v === null || v === undefined || v === "" || v === "no" || v === "0") {
            return 0;
        }

        return 1;
    }

    const uiMode = getUiMode();

    const filteredStatuses = datasetFiltered.filter(st => {
        return getBackendMode(st) === uiMode;
    });

    if (filteredStatuses.length === 0) {
        container.innerHTML = `<div class="text-muted">No model predictions.</div>`;
        return;
    }

    filteredStatuses.sort((a, b) => {
        const da = parseDDMMYYYY(a.timeCreated);
        const db = parseDDMMYYYY(b.timeCreated);
        return db - da;
    });

    const ul = document.createElement('ul');
    ul.className = 'list-group mt-2';

    for (const status of filteredStatuses) {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex flex-column align-items-start';

        const paramDesc =
            status.modelParameters?.description ||
            status.learning?.modelParameters?.description ||
            "Unknown parameters";

        const dataName = status.dataa?.name || "Unknown data";
        const predictionLabel = status.predictionLabel;
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

        const infoSection = document.createElement('div');

        let predictionMode = status.unsupervised;

        if (predictionMode === "ae") {
            predictionMode = "Autoencoder";
        } else if (predictionMode === "if") {
            predictionMode = "Isolation Forest"
        } else if (predictionMode === "som") {
            predictionMode = "Self-Organizing Map"
        }

        let nameUnsupervised = status.modelParameters?.description || "Unsupervised model";

        if (learningMode === "unsupervised") {
            infoSection.innerHTML = `
                <strong>Name:</strong> ${nameUnsupervised}<br>
                <strong>Prediction mode:</strong> ${predictionMode}<br>
                <strong>Data:</strong> ${dataName}<br>
                <strong>Used node embeddings:</strong> ${embeddings}
        `;
        }

        if (learningMode === "supervised") {
            infoSection.innerHTML = `
                <strong>Parameters:</strong> ${paramDesc}<br>
                <strong>Data:</strong> ${dataName}<br>
                <strong>Prediction label:</strong> ${predictionLabel}<br>
                <strong>Used graph smote:</strong> ${smote}<br>
                <strong>Used node embeddings:</strong> ${embeddings}
            `;
        }

        const timeCreated = status.timeCreated ? parseCustomDate(status.timeCreated).toLocaleString() : 'N/A';
        const timeChanged = status.timeChanged ? parseCustomDate(status.timeChanged).toLocaleString() : 'N/A';

        const timeSection = document.createElement('div');
        timeSection.className = 'text-muted small mt-1';
        timeSection.innerHTML = `
            Created: ${timeCreated}<br>
            Last Updated: ${timeChanged}
        `;

        const right = document.createElement('div');
        right.className = 'd-flex align-items-center gap-2 mt-2 align-self-end';

        const badge = document.createElement('span');
        badge.className = 'badge rounded-pill text-light';
        badge.textContent = status.status || 'WAITING';

        switch (status.status) {
            case "PREDICTING":
                badge.classList.add('bg-warning');
                badge.classList.remove('text-light');
                badge.classList.add('text-dark');
                break;
            case "WAITING":
                badge.classList.add('bg-secondary');
                break;
            case "COMPLETED":
                badge.classList.add('bg-success');
                break;
            default:
                badge.classList.add('bg-secondary');
        }

        right.appendChild(badge);

        if (status.status === "COMPLETED") {
            const simulateBtn = document.createElement('button');
            simulateBtn.className = 'btn btn-outline-primary btn-sm';
            simulateBtn.textContent = 'Get Predictions';

            simulateBtn.addEventListener('click', async () => {
                document.body.style.cursor = "wait";
                simulateBtn.disabled = true;

                try {
                    const predictionId = status.id;
                    sessionStorage.setItem("predictionId", predictionId);
                    const isSupervised =
                        status.unsupervised === null ||
                        status.unsupervised === undefined ||
                        status.unsupervised === "" ||
                        status.unsupervised === "no" ||
                        status.unsupervised === 0;

                    localStorage.setItem("graphMode", isSupervised ? "supervised" : "unsupervised");
                    sessionStorage.setItem("predictionUsedSmote", status.smote ? "1" : "0");
                    const resLabels = await fetch(`${API}/arien/models/prediction/${predictionId}/predicted`);
                    const labels = await safeJson(resLabels);

                    const resProb = await fetch(`${API}/arien/models/prediction/${predictionId}/probabilities`);
                    const probs = await safeJson(resProb);

                    if (uiMode === 1) {
                        const resPerc = await fetch(`${API}/arien/models/prediction/${predictionId}/percentiles`);
                        const perc = await safeJson(resPerc);
                        sessionStorage.setItem("predictedPercentiles", JSON.stringify(perc));
                    }

                    sessionStorage.setItem("predictedLabels", JSON.stringify(labels));
                    sessionStorage.setItem("predictedProbabilities", JSON.stringify(probs));

                    const datasetName = sessionStorage.getItem("selectedDataName");

                    if (datasetName) {
                        localStorage.removeItem(`suspiciousScores:${datasetName}`);
                    }

                    window.suspiciousNodes = new Set();


                    showAlert("Predictions loaded successfully!", "success");

                } catch (err) {
                    showAlert("Failed to get predictions: " + err.message, "danger");
                } finally {
                    document.body.style.cursor = "default";
                    simulateBtn.disabled = false;
                }
            });


            right.appendChild(simulateBtn);
        }

        const trashBtn = createDeletePredictionButton(status.id);
        right.appendChild(trashBtn);
        li.appendChild(infoSection);
        li.appendChild(timeSection);
        li.appendChild(right);
        ul.appendChild(li);
    }

    container.appendChild(ul);
}

let autoRefresh = true;

setInterval(() => {
    if (!autoRefresh) return;
    renderLearningStatus();
    renderPredictingStatus(true);
}, 5000);


function updateLearningModeUI() {
    const labelContainer = document.getElementById('labelInputContainer');
    const trainSection = document.getElementById('trainSection');
    const completedTrainingBlock = document.getElementById('completedStatusList').parentElement;
    const graphSmoteBlock = document.getElementById("graphSmoteBlock");
    const graphSmoteCheckbox = document.getElementById("cbGraphSmote");
    const embeddingsUnsupBlock = document.getElementById("embeddingsUnsupervisedBlock");
    const unsupervisedPanel = document.getElementById("unsupervisedPanel");

    const predictionModeBlock = document.getElementById("unsupervisedModeSelect").parentElement;
    document.getElementById("selectModel").closest(".mb-4").style.display = (learningMode === "unsupervised") ? "none" : "block";
    const parameterSection = document.getElementById("parameterSection");
    const modelSection = document.getElementById("selectModel").closest(".mb-4");

    const shouldShowLabelInput = learningMode === "supervised" && window.selectedParametersId && labelContainer.dataset.ready === "true";

    if (shouldShowLabelInput) {
        labelContainer.style.display = "block";
    } else {
        labelContainer.style.display = "none";
    }

    if (learningMode === "unsupervised") {
        modelSection.style.display = "none";
        parameterSection.style.display = "none";

        trainSection.style.display = "none";
        completedTrainingBlock.style.display = "none";

        graphSmoteBlock.style.display = "none";
        graphSmoteCheckbox.checked = false;

        predictionModeBlock.style.display = "flex";
        unsupervisedPanel.style.display = "block";

        embeddingsUnsupBlock.style.display = "block";
        document.getElementById("cbNodeEmbeddingsUnsupervised").checked = false;
    } else {
        modelSection.style.display = "block";
        parameterSection.style.display = "block";
        embeddingsUnsupBlock.style.display = "none";
        trainSection.style.display = "block";
        completedTrainingBlock.style.display = "block";

        graphSmoteBlock.style.display = "block";
        predictionModeBlock.style.display = "none";
        unsupervisedPanel.style.display = "none";
    }
}

function inferNodeAttributesFromGraph(rawGraph) {
    if (!rawGraph || !Array.isArray(rawGraph.nodes) || rawGraph.nodes.length === 0) return [];
    const n = rawGraph.nodes[0];
    const props = (n && n.properties) || {};
    const keys = new Set(Object.keys(props));

    ['id', 'labels'].forEach(k => keys.delete(k));
    return Array.from(keys).sort();
}

function fillLabelSelect(selectEl, attrs) {
    selectEl.innerHTML = '<option disabled>Choose attribute from dataset…</option>';
    const labelExists = attrs.includes('label');

    attrs.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === 'label') opt.selected = true;
        selectEl.appendChild(opt);
    });

    selectEl.classList.remove('d-none');

    if (labelExists) {
        window.selectedLabelAttribute = 'label';
    } else {
        window.selectedLabelAttribute = null;
    }

    if (!selectEl.dataset.listenerAdded) {
        selectEl.addEventListener('change', () => {
            window.selectedLabelAttribute = selectEl.value;
        });
        selectEl.dataset.listenerAdded = 'true';
    }
}

async function populateLabelDropdownFromGraph(dataName) {
    const selectEl = document.getElementById('labelSelect');
    if (!selectEl || !dataName) return;

    try {
        const res = await fetch(`${API}/arien/data/${encodeURIComponent(dataName)}`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const rawGraph = await res.json();

        const attrs = inferNodeAttributesFromGraph(rawGraph);
        if (attrs.length === 0) {
            selectEl.classList.add('d-none');
            return;
        }

        fillLabelSelect(selectEl, attrs);
    } catch (e) {
        console.warn('Could not populate label dropdown:', e);
        selectEl.classList.add('d-none');
    }
}

function updateLearningModeButtons() {
    const supervisedLabel = document.querySelector("label[for='modeSupervised']");
    const unsupervisedLabel = document.querySelector("label[for='modeUnsupervised']");

    if (learningMode === "supervised") {
        supervisedLabel.classList.add("active");
        unsupervisedLabel.classList.remove("active");
    } else {
        unsupervisedLabel.classList.add("active");
        supervisedLabel.classList.remove("active");
    }
}

function clearPredictingListImmediately() {
    const container = document.getElementById("predictionStatusList");
    if (container) {
        container.innerHTML = `<div class="text-muted">Loading…</div>`;
    }
}

function selectParameterSet(id) {
    window.selectedParametersId = id;

    const quick = document.getElementById("parameterQuickSelect");
    if (quick) {
        quick.value = String(id);
    }

    const r = document.getElementById(`select-param-${id}`);
    if (r) {
        r.checked = true;
    }

    document.getElementById('labelInputContainer').dataset.ready = "true";
    enableLabelInput();
    updateLearningModeUI();

    const startBtn = document.getElementById('startLearning');
    const dataName = sessionStorage.getItem('selectedDataName');
    if (dataName && startBtn) {
        populateLabelDropdownFromGraph(dataName);
        startBtn.disabled = false;
    }
}
