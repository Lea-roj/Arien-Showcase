document.addEventListener("DOMContentLoaded", function () {
    const links = document.querySelectorAll(".nav-link, .logo");
    const contentDiv = document.getElementById("content");

    // Funzione per caricare la pagina
    function loadPage(page) {
        fetch(page)
            .then(response => {
                if (!response.ok) {
                    throw new Error("HTTP error " + response.status);
                }
                return response.text();
            })
            .then(html => {
                contentDiv.innerHTML = html;

                setTimeout(() => {
                    if (html.includes("id=\"fileInput\"") && typeof window.initializeGraphView === "function") {
                        window.initializeGraphView();
                    }

                    if (document.getElementById('palette-container') && typeof window.generatePalette === "function") {
                        window.generatePalette();
                    }

                    const tabTriggers = Array.from(document.querySelectorAll('[data-bs-toggle="tab"]'));
                    tabTriggers.forEach(trigger => new bootstrap.Tab(trigger));

                    initializeTooltipsAndPopovers();
                    initializeTableFunctions?.();
                }, 0);
            })

            .catch(error => console.error("Errore nel caricamento della pagina:", error));
    }

    loadPage("docs/home.html");

    // Gestione del click sui link di navigazione e logo
    links.forEach(link => {
        link.addEventListener("click", function (event) {
            event.preventDefault();
            const page = this.getAttribute("data-page").replace('public/','');

            document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
            const parentNavItem = this.closest(".nav-item");
            if (parentNavItem) {
                parentNavItem.classList.add("active");
            }

            loadPage(page);
        });
    });

    // Inizializza tooltip e popover per il contenuto già presente nella pagina
    initializeTooltipsAndPopovers();

    // Funzione per inizializzare tooltip e popover
    function initializeTooltipsAndPopovers() {
        const tooltipTriggerList = Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));

        const popoverTriggerList = Array.from(document.querySelectorAll('[data-bs-toggle="popover"]'));
        popoverTriggerList.forEach(el => new bootstrap.Popover(el));
    }

    // Funzione per il toggle tra modali
    document.querySelectorAll('.toggle-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Chiude la modale attualmente visibile (se presente)
            const currentModalEl = document.querySelector('.modal.show');
            if (currentModalEl) {
                const currentModal = bootstrap.Modal.getInstance(currentModalEl);
                if (currentModal) currentModal.hide();
            }
            // Apre la modale target (l'ID è specificato in data-target-modal)
            const targetModalId = btn.getAttribute('data-target-modal');
            const targetModalEl = document.getElementById(targetModalId);
            if (targetModalEl) {
                const targetModal = new bootstrap.Modal(targetModalEl);
                targetModal.show();
            }
        });
    });
});
