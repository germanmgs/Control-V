/* app.js - Versión Final con mejoras en Movimientos y botón borrar restaurado */

document.addEventListener('DOMContentLoaded', () => {
    // DOM
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const sideMenu = document.getElementById('side-menu');
    const menuBtn = document.getElementById('menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');

    const pickingForm = document.getElementById('picking-form');
    const almacenForm = document.getElementById('almacen-form');
    const movimientosForm = document.getElementById('movimientos-form');

    const skuSuggestions = document.getElementById('sku-suggestions');
    const scannerModal = document.getElementById('scanner-modal');
    const scannerContainer = document.getElementById('scanner-container');
    const stopScannerBtn = document.getElementById('stop-scanner-btn');

    const origenSelect = document.getElementById('origen-select');
    const destinoSelect = document.getElementById('destino-select');
    const movimientoSKU = document.getElementById('movimiento-sku');

    // NUEVOS CAMPOS MOVIMIENTOS
    const movimientoBoxes = document.getElementById('movimiento-boxes');
    const movimientoPerBox = document.getElementById('movimiento-per-box');
    const movimientoLoose = document.getElementById('movimiento-loose');
    const movimientoTotalDisplay = document.getElementById('movimiento-total');

    const firebaseStatus = document.getElementById('firebase-status');
    const toggleLocationRequirement = document.getElementById('toggle-location-requirement');
    let locationRequirementDisabled = false;
    toggleLocationRequirement.addEventListener('change', () => {
        locationRequirementDisabled = toggleLocationRequirement.checked;
    });

    let currentScanInput = null;

    // Datos locales
    let pickingData = [];
    let almacenData = [];
    let movimientosData = [];
    let productCatalog = {};

    // URL del catálogo en GitHub
    const githubCatalogUrl = 'https://raw.githubusercontent.com/germanmgs/Control-V/main/Catalogo.xlsx';

    // Firebase refs
    let firebaseEnabled = false;
    let dbRootRef = null;
    let picksRef = null;
    let almacenRef = null;
    let movimientosRef = null;

    function isFirebaseAvailable() {
        return (typeof firebase !== 'undefined') && (firebase) && (firebase.database) && (typeof firebaseConfig !== 'undefined') && firebaseConfig;
    }

    async function initFirebase() {
        if (!isFirebaseAvailable()) {
            firebaseEnabled = false;
            firebaseStatus.textContent = 'Firebase no configurado — modo local';
            loadFromLocalStorageAll();
            renderData();
            return;
        }

        try {
            await firebase.auth().signInAnonymously();
            dbRootRef = firebase.database().ref('vaxel');
            picksRef = dbRootRef.child('picking');
            almacenRef = dbRootRef.child('almacen');
            movimientosRef = dbRootRef.child('movimientos');

            firebaseEnabled = true;
            firebaseStatus.textContent = 'Conectado a Firebase (Realtime DB)';
            setupFirebaseListeners();
        } catch (err) {
            console.error('Error inicializando Firebase:', err);
            firebaseEnabled = false;
            firebaseStatus.textContent = 'Error Firebase - modo local';
            loadFromLocalStorageAll();
            renderData();
        }
    }

    function setupFirebaseListeners() {
        const objToArray = (obj) => {
            if (!obj) return [];
            return Object.keys(obj).map(k => ({ ...obj[k], _key: k }));
        };

        picksRef.on('value', snapshot => {
            const val = snapshot.val();
            pickingData = objToArray(val);
            saveToLocalStorage('pickingData', pickingData);
            renderData();
        });

        almacenRef.on('value', snapshot => {
            const val = snapshot.val();
            almacenData = objToArray(val);
            saveToLocalStorage('almacenData', almacenData);
            renderData();
        });

        movimientosRef.on('value', snapshot => {
            const val = snapshot.val();
            movimientosData = objToArray(val);
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        });
    }

    async function loadCatalogFromGitHub() {
        try {
            showDialog('Cargando catálogo desde GitHub...');
            const response = await fetch(githubCatalogUrl);
            if (!response.ok) throw new Error('Error al obtener el catálogo de GitHub. Código de estado: ' + response.status);
            const data = await response.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array' });
            const firstSheet = wb.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet]);

            const newCatalog = {};
            if (jsonData.length > 0) {
                const keys = Object.keys(jsonData[0]);
                const skuKey = keys.find(k => k.toLowerCase().includes('sku'));
                const descKey = keys.find(k => k.toLowerCase().includes('descrip') || k.toLowerCase().includes('desc') || k.toLowerCase().includes('nombre'));
                if (!skuKey || !descKey) {
                    showDialog('Archivo de Excel sin columnas SKU/Descripcion.');
                    return;
                }
                jsonData.forEach(row => {
                    const sku = row[skuKey];
                    const descripcion = row[descKey];
                    if (sku) newCatalog[sku] = { descripcion: descripcion || '' };
                });
            }

            productCatalog = newCatalog;
            saveToLocalStorage('productCatalog', productCatalog);
            updateDatalist();
            showDialog('Catálogo de GitHub cargado correctamente.');
        } catch (error) {
            console.error('Error al cargar catálogo de GitHub:', error);
            showDialog('Error al cargar catálogo de GitHub. ' + error.message);
        }
    }

    function saveToLocalStorage(key, data) {
        try { localStorage.setItem(key, JSON.stringify(data)); }
        catch (e) { console.warn(e); }
    }

    function loadFromLocalStorage(key, defaultVal) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultVal;
        } catch (e) { return defaultVal; }
    }

    function loadFromLocalStorageAll() {
        pickingData = loadFromLocalStorage('pickingData', []);
        almacenData = loadFromLocalStorage('almacenData', []);
        movimientosData = loadFromLocalStorage('movimientosData', []);
        productCatalog = loadFromLocalStorage('productCatalog', {});
        updateDatalist();
    }

    function updateDescription(skuInput, descriptionSpan) {
        const sku = skuInput.value;
        const description = productCatalog[sku] ? productCatalog[sku].descripcion : '';
        descriptionSpan.textContent = description || 'Descripción no encontrada';
    }

    // FUNCIONES DE CÁLCULO TOTAL
    function setupTotalCalculation(boxesInput, perBoxInput, looseInput, totalDisplay) {
        function updateTotal() {
            const boxes = parseInt(boxesInput.value) || 0;
            const perBox = parseInt(perBoxInput.value) || 0;
            const loose = parseInt(looseInput.value) || 0;
            totalDisplay.textContent = (boxes * perBox) + loose;
        }
        boxesInput.addEventListener('input', updateTotal);
        perBoxInput.addEventListener('input', updateTotal);
        looseInput.addEventListener('input', updateTotal);
    }

    // Inicializar cálculo para movimientos
    setupTotalCalculation(movimientoBoxes, movimientoPerBox, movimientoLoose, movimientoTotalDisplay);

    // Navegación
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            button.classList.add('active');
            tabContents.forEach(c => c.classList.remove('active'));
            const target = document.getElementById(button.dataset.tab);
            if (target) target.classList.add('active');
            renderData();
        });
    });

    // Menu lateral
    menuBtn.addEventListener('click', () => sideMenu.classList.add('open'));
    closeMenuBtn.addEventListener('click', () => sideMenu.classList.remove('open'));

    // FORMULARIOS
    function setupForm(form, dataKeyName) {
        const skuInput = form.querySelector('input[id$="-sku"]');
        const locationInput = form.querySelector('input[id$="-location"]');
        const boxesInput = form.querySelector('input[id$="-boxes"]');
        const perBoxInput = form.querySelector('input[id$="-per-box"]');
        const looseInput = form.querySelector('input[id$="-loose"]');
        const totalDisplay = form.querySelector('strong[id$="-total"]');
        const descriptionSpan = form.querySelector('.product-description');

        setupTotalCalculation(boxesInput, perBoxInput, looseInput, totalDisplay);

        if (skuInput && descriptionSpan) {
            skuInput.addEventListener('input', () => updateDescription(skuInput, descriptionSpan));
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sku = skuInput.value.trim();
            const cantidad = parseInt(totalDisplay.textContent) || 0;
            const fecha = new Date().toLocaleString();

            if (!sku) { await showDialog('Debe ingresar un SKU'); return; }

            if (cantidad === 0) {
                const ok = await showDialog('La cantidad ingresada es 0 ¿Continuar?', [
                    { label: 'No', value: false },
                    { label: 'Sí', value: true }
                ]);
                if (!ok) return;
            }

            let dataArray;
            if (dataKeyName === 'pickingData') dataArray = pickingData;
            else if (dataKeyName === 'almacenData') dataArray = almacenData;
            else dataArray = movimientosData;

            let itemToUpdate = null;
            if (dataKeyName === 'movimientosData') {
                itemToUpdate = dataArray.find(it => it.sku === sku && it.origen === origenSelect.value && it.destino === destinoSelect.value);
            } else {
                const location = locationInput ? locationInput.value.trim() : '';
                itemToUpdate = dataArray.find(it => it.sku === sku && it.ubicacion === location);
            }

            if (firebaseEnabled) {
                let ref;
                if (dataKeyName === 'pickingData') ref = picksRef;
                else if (dataKeyName === 'almacenData') ref = almacenRef;
                else ref = movimientosRef;

                if (itemToUpdate) {
                    const key = itemToUpdate._key;
                    const newCantidad = (parseInt(itemToUpdate.cantidad) || 0) + cantidad;
                    await ref.child(key).update({ cantidad: newCantidad, fecha });
                } else {
                    if (dataKeyName === 'movimientosData') {
                        await ref.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
                    } else {
                        const location = locationInput ? locationInput.value.trim() : '';
                        await ref.push({ fecha, sku, ubicacion: location, cantidad });
                    }
                }
            } else {
                if (itemToUpdate) {
                    itemToUpdate.cantidad += cantidad;
                } else {
                    if (dataKeyName === 'movimientosData') {
                        dataArray.push({
                            fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad,
                            _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                        });
                    } else {
                        const location = locationInput ? locationInput.value.trim() : '';
                        dataArray.push({
                            fecha, sku, ubicacion: location, cantidad,
                            _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                        });
                    }
                }
                saveToLocalStorage(dataKeyName, dataArray);
                renderData();
            }

            form.reset();
            totalDisplay.textContent = '0';
            if (descriptionSpan) descriptionSpan.textContent = '';
        });
    }

    setupForm(pickingForm, 'pickingData');
    setupForm(almacenForm, 'almacenData');
    setupForm(movimientosForm, 'movimientosData');

    origenSelect.addEventListener('change', (e) => {
        destinoSelect.value = e.target.value === 'Picking' ? 'Almacén' : 'Picking';
    });

    document.getElementById('load-file-btn').addEventListener('click', async () => {
        await loadCatalogFromGitHub();
    });

    function updateDatalist() {
        skuSuggestions.innerHTML = '';
        Object.keys(productCatalog || {}).forEach(sku => {
            const opt = document.createElement('option');
            opt.value = sku;
            skuSuggestions.appendChild(opt);
        });
    }

    // --- RESTAURADO: renderTable con botón eliminar ---
    function renderTable(containerId, data, columns, dataKey) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (!data || data.length === 0) {
            container.innerHTML = '<p>No hay datos registrados.</p>';
            return;
        }
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        const headerRow = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.title;
            headerRow.appendChild(th);
        });
        const thActions = document.createElement('th');
        thActions.textContent = "Acción";
        headerRow.appendChild(thActions);
        thead.appendChild(headerRow);

        data.forEach(item => {
            const row = document.createElement('tr');
            columns.forEach(col => {
                const td = document.createElement('td');
                td.textContent = item[col.key] != null ? item[col.key] : '';
                row.appendChild(td);
            });
            const tdActions = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<span class="material-icons">delete_forever</span>';
            deleteBtn.className = 'delete-btn';
            deleteBtn.onclick = () => deleteEntry(dataKey, item._key);
            tdActions.appendChild(deleteBtn);
            row.appendChild(tdActions);
            tbody.appendChild(row);
        });

        table.appendChild(thead);
        table.appendChild(tbody);
        container.appendChild(table);
    }

    async function deleteEntry(dataKey, key) {
        if (!confirm('¿Estás seguro de que querés eliminar este registro?')) return;
        if (firebaseEnabled) {
            if (dataKey === 'pickingData') await picksRef.child(key).remove();
            else if (dataKey === 'almacenData') await almacenRef.child(key).remove();
            else if (dataKey === 'movimientosData') await movimientosRef.child(key).remove();
        } else {
            if (dataKey === 'pickingData') {
                pickingData = pickingData.filter(it => it._key !== key);
                saveToLocalStorage('pickingData', pickingData);
            } else if (dataKey === 'almacenData') {
                almacenData = almacenData.filter(it => it._key !== key);
                saveToLocalStorage('almacenData', almacenData);
            } else if (dataKey === 'movimientosData') {
                movimientosData = movimientosData.filter(it => it._key !== key);
                saveToLocalStorage('movimientosData', movimientosData);
            }
            renderData();
        }
    }

    function renderData() {
        renderTable('picking-data', pickingData, [
            { key: 'fecha', title: 'Fecha' },
            { key: 'sku', title: 'SKU' },
            { key: 'ubicacion', title: 'Ubicación' },
            { key: 'cantidad', title: 'Cantidad' }
        ], 'pickingData');
        renderTable('almacen-data', almacenData, [
            { key: 'fecha', title: 'Fecha' },
            { key: 'sku', title: 'SKU' },
            { key: 'ubicacion', title: 'Ubicación' },
            { key: 'cantidad', title: 'Cantidad' }
        ], 'almacenData');
        renderTable('movimientos-data', movimientosData, [
            { key: 'fecha', title: 'Fecha' },
            { key: 'origen', title: 'Origen' },
            { key: 'destino', title: 'Destino' },
            { key: 'sku', title: 'SKU' },
            { key: 'cantidad', title: 'Cantidad' }
        ], 'movimientosData');
    }

    loadFromLocalStorageAll();
    initFirebase();
    loadCatalogFromGitHub();
});
