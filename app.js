/* app.js - Versión Final */

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
    const movimientoCantidad = document.getElementById('movimiento-cantidad');

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
    // Esta es la URL corregida para el "raw content"
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

    // Funciones de carga de catálogo
    async function loadCatalogFromGitHub() {
        try {
            showDialog('Cargando catálogo desde GitHub...');
            const response = await fetch(githubCatalogUrl);
            if (!response.ok) {
                throw new Error('Error al obtener el catálogo de GitHub. Código de estado: ' + response.status);
            }
            const data = await response.arrayBuffer();
            const wb = XLSX.read(data, {
                type: 'array'
            });
            const firstSheet = wb.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet]);

            const newCatalog = {};
            if (jsonData.length > 0) {
                const keys = Object.keys(jsonData[0]);
                const skuKey = keys.find(k => k.toLowerCase().includes('sku'));
                const descKey = keys.find(k => k.toLowerCase().includes('descrip') || k.toLowerCase().includes('desc') || k.toLowerCase().includes('nombre'));
                if (!skuKey || !descKey) {
                    showDialog('Archivo de Excel sin columnas SKU/Descripcion. Asegúrate de que los encabezados existan.');
                    return;
                }
                jsonData.forEach(row => {
                    const sku = row[skuKey];
                    const descripcion = row[descKey];
                    if (sku) newCatalog[sku] = {
                        descripcion: descripcion || ''
                    };
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

    // localStorage helpers
    function saveToLocalStorage(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.warn(e);
        }
    }

    function loadFromLocalStorage(key, defaultVal) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    }

    function loadFromLocalStorageAll() {
        pickingData = loadFromLocalStorage('pickingData', []);
        almacenData = loadFromLocalStorage('almacenData', []);
        movimientosData = loadFromLocalStorage('movimientosData', []);
        productCatalog = loadFromLocalStorage('productCatalog', {});
        updateDatalist();
    }

    // Render tabla
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
            else if (dataKey === 'movimientosData') {
                if (Array.isArray(key)) {
                    await Promise.all(key.map(k => movimientosRef.child(k).remove()));
                } else {
                    await movimientosRef.child(key).remove();
                }
            }
        } else {
            if (dataKey === 'pickingData') {
                pickingData = pickingData.filter(it => it._key !== key);
                saveToLocalStorage('pickingData', pickingData);
            } else if (dataKey === 'almacenData') {
                almacenData = almacenData.filter(it => it._key !== key);
                saveToLocalStorage('almacenData', almacenData);
            } else if (dataKey === 'movimientosData') {
                if (Array.isArray(key)) {
                    movimientosData = movimientosData.filter(it => !key.includes(it._key));
                } else {
                    movimientosData = movimientosData.filter(it => it._key !== key);
                }
                saveToLocalStorage('movimientosData', movimientosData);
            }
            renderData();
        }
    }

    function updateDescription(skuInput, descriptionSpan) {
        const sku = skuInput.value;
        const description = productCatalog[sku] ? productCatalog[sku].descripcion : '';
        descriptionSpan.textContent = description || 'Descripción no encontrada';
    }

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

    
    // Escáner con html5-qrcode
    let html5QrCode = null;
    let currentScanInput = null;

    async function startScanner() {
        scannerContainer.innerHTML = "";
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 120 },
            formatsToSupport: [
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.ITF,
                Html5QrcodeSupportedFormats.CODABAR
            ],
            disableFlip: false,
            videoConstraints: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        };

        html5QrCode = new Html5Qrcode("scanner-container");

        try {
            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    if (decodedText && currentScanInput) {
                        currentScanInput.value = decodedText;
                        currentScanInput.dispatchEvent(new Event("input"));
                        stopScanner();
                    }
                },
                () => {}
            );
        } catch (err) {
            console.error("Error iniciando escáner:", err);
            alert("No se pudo iniciar la cámara: " + (err.message || err));
            stopScanner();
        }
    }

    async function stopScanner() {
        if (html5QrCode) {
            try {
                await html5QrCode.stop();
            } catch (e) {
                console.warn("Error deteniendo scanner", e);
            }
            html5QrCode.clear();
            html5QrCode = null;
        }
        scannerModal.classList.remove("open");
        scannerContainer.innerHTML = "";
    }

    // Bind de botones
    document.querySelectorAll(".scan-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            currentScanInput = document.getElementById(btn.dataset.input);
            scannerModal.classList.add("open");
            startScanner();
        });
    });

    stopScannerBtn.addEventListener("click", () => stopScanner());
    
    // Diálogo para notificaciones
    function showDialog(message, buttons = [{
        label: 'Aceptar',
        value: true
    }]) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-dialog-overlay';
            const box = document.createElement('div');
            box.className = 'custom-dialog-box';
            const msg = document.createElement('p');
            msg.textContent = message;
            msg.className = 'custom-dialog-message';
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'custom-dialog-buttons';
            buttons.forEach(b => {
                const btn = document.createElement('button');
                btn.textContent = b.label;
                btn.className = `custom-dialog-button ${b.value ? 'primary' : 'secondary'}`;
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(b.value);
                });
                buttonsDiv.appendChild(btn);
            });
            box.appendChild(msg);
            if (buttons.length > 0) {
                box.appendChild(buttonsDiv);
            }
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            if (buttons.length === 0) {
                resolve({
                    overlay: overlay,
                    box: box
                });
            }
        });
    }

    // setup forms
    function setupForm(form, dataKeyName) {
        const skuInput = form.querySelector('input[id$="-sku"]');
        const locationInput = form.querySelector('input[id$="-location"]');
        const boxesInput = form.querySelector('input[id$="-boxes"]');
        const perBoxInput = form.querySelector('input[id$="-per-box"]');
        const looseInput = form.querySelector('input[id$="-loose"]');
        const totalDisplay = form.querySelector('strong[id$="-total"]');
        const descriptionSpan = form.querySelector('.product-description');

        function updateTotal() {
            const boxes = parseInt(boxesInput.value) || 0;
            const perBox = parseInt(perBoxInput.value) || 0;
            const loose = parseInt(looseInput.value) || 0;
            totalDisplay.textContent = (boxes * perBox) + loose;
        }
        if (boxesInput) boxesInput.addEventListener('input', updateTotal);
        if (perBoxInput) perBoxInput.addEventListener('input', updateTotal);
        if (looseInput) looseInput.addEventListener('input', updateTotal);

        skuInput.addEventListener('input', () => updateDescription(skuInput, descriptionSpan));

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sku = skuInput.value.trim();
            const location = locationInput ? locationInput.value.trim() : '';
            const cantidad = parseInt(totalDisplay.textContent) || 0;
            const fecha = new Date().toLocaleString();

            if (!sku) {
                await showDialog('Debe ingresar un SKU');
                return;
            }

            if (!locationRequirementDisabled && dataKeyName !== 'movimientosData' && !location) {
                const ok = await showDialog('ADVERTENCIA: Se subirá el SKU sin ubicación. ¿Continuar?', [{
                    label: 'No',
                    value: false
                }, {
                    label: 'Si',
                    value: true
                }]);
                if (!ok) return;
            }

            if (cantidad === 0) {
                const ok2 = await showDialog('La cantidad ingresada es 0 ¿Continuar?', [{
                    label: 'No',
                    value: false
                }, {
                    label: 'Si',
                    value: true
                }]);
                if (!ok2) return;
            }

            // buscar duplicado por sku+ubicacion
            const dataArray = (dataKeyName === 'pickingData') ? pickingData : (dataKeyName === 'almacenData') ? almacenData : movimientosData;
            let itemToUpdate = null;
            if (dataKeyName !== 'movimientosData') itemToUpdate = dataArray.find(it => it.sku === sku && it.ubicacion === location);

            if (firebaseEnabled) {
                if (dataKeyName === 'pickingData') {
                    if (itemToUpdate) {
                        const key = itemToUpdate._key;
                        const newCantidad = (parseInt(itemToUpdate.cantidad) || 0) + cantidad;
                        await picksRef.child(key).update({
                            cantidad: newCantidad,
                            fecha
                        });
                    } else {
                        await picksRef.push({
                            fecha,
                            sku,
                            ubicacion: location,
                            cantidad
                        });
                    }
                } else if (dataKeyName === 'almacenData') {
                    if (itemToUpdate) {
                        const key = itemToUpdate._key;
                        const newCantidad = (parseInt(itemToUpdate.cantidad) || 0) + cantidad;
                        await almacenRef.child(key).update({
                            cantidad: newCantidad,
                            fecha
                        });
                    } else {
                        await almacenRef.push({
                            fecha,
                            sku,
                            ubicacion: location,
                            cantidad
                        });
                    }
                } else {
                    let movimientoToUpdate = movimientosData.find(it => it.sku === sku && it.origen === origenSelect.value && it.destino === destinoSelect.value);

                    if (movimientoToUpdate) {
                        const key = movimientoToUpdate._key;
                        const newCantidad = (parseInt(movimientoToUpdate.cantidad) || 0) + cantidad;
                        await movimientosRef.child(key).update({
                            cantidad: newCantidad,
                            fecha
                        });
                    } else {
                        await movimientosRef.push({
                            fecha,
                            origen: origenSelect.value,
                            destino: destinoSelect.value,
                            sku,
                            cantidad
                        });
                    }
                }
            } else {
                // modo local
                if (dataKeyName === 'pickingData') {
                    if (itemToUpdate) itemToUpdate.cantidad += cantidad;
                    else pickingData.push({
                        fecha,
                        sku,
                        ubicacion: location,
                        cantidad,
                        _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                    });
                    saveToLocalStorage('pickingData', pickingData);
                } else if (dataKeyName === 'almacenData') {
                    if (itemToUpdate) itemToUpdate.cantidad += cantidad;
                    else almacenData.push({
                        fecha,
                        sku,
                        ubicacion: location,
                        cantidad,
                        _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                    });
                    saveToLocalStorage('almacenData', almacenData);
                } else {
                    let movimientoToUpdate = movimientosData.find(it => it.sku === sku && it.origen === origenSelect.value && it.destino === destinoSelect.value);
                    if(movimientoToUpdate) movimientoToUpdate.cantidad += cantidad;
                    else movimientosData.push({
                        fecha,
                        origen: origenSelect.value,
                        destino: destinoSelect.value,
                        sku,
                        cantidad,
                        _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                    });
                    saveToLocalStorage('movimientosData', movimientosData);
                }
                renderData();
            }

            form.reset();
            updateTotal();
            if (descriptionSpan) descriptionSpan.textContent = '';
        });
    }

    setupForm(pickingForm, 'pickingData');
    setupForm(almacenForm, 'almacenData');

    origenSelect.addEventListener('change', (e) => {
        destinoSelect.value = e.target.value === 'Picking' ? 'Almacén' : 'Picking';
    });

    const movBoxesInput = document.getElementById('movimientos-boxes');
    const movPerBoxInput = document.getElementById('movimientos-per-box');
    const movLooseInput = document.getElementById('movimientos-loose');
    const movTotalDisplay = document.getElementById('movimientos-total');
    function updateMovTotal() {
        const boxes = parseInt(movBoxesInput.value) || 0;
        const perBox = parseInt(movPerBoxInput.value) || 0;
        const loose = parseInt(movLooseInput.value) || 0;
        movimientoCantidad.value = (boxes * perBox) + loose;
        movTotalDisplay.textContent = movimientoCantidad.value;
    }
    movBoxesInput.addEventListener('input', updateMovTotal);
    movPerBoxInput.addEventListener('input', updateMovTotal);
    movLooseInput.addEventListener('input', updateMovTotal);
    
    movimientosForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const sku = movimientoSKU.value.trim();
        const cantidad = parseInt(movimientoCantidad.value) || 0;
        const fecha = new Date().toLocaleString();
        if (!sku || cantidad <= 0) {
            alert('Por favor completa correctamente');
            return;
        }

        if (firebaseEnabled) {
            let movimientoToUpdate = movimientosData.find(it => it.sku === sku && it.origen === origenSelect.value && it.destino === destinoSelect.value);
            if (movimientoToUpdate) {
                const key = movimientoToUpdate._key;
                const newCantidad = (parseInt(movimientoToUpdate.cantidad) || 0) + cantidad;
                movimientosRef.child(key).update({ cantidad: newCantidad, fecha });
            } else {
                movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
            }
        } else {
            let movimientoToUpdate = movimientosData.find(it => it.sku === sku && it.origen === origenSelect.value && it.destino === destinoSelect.value);
            if(movimientoToUpdate) movimientoToUpdate.cantidad += cantidad;
            else {
                movimientosData.push({
                    fecha,
                    origen: origenSelect.value,
                    destino: destinoSelect.value,
                    sku,
                    cantidad,
                    _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
                });
            }
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        }
        movimientosForm.reset();
    });

    // Carga catálogo (MODIFICACIÓN: AHORA LEE EXCEL DESDE GITHUB)
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

    // Clear data
    async function clearData(dataKey, msg) {
        if (!confirm(msg)) return;
        if (firebaseEnabled) {
            if (dataKey === 'pickingData') await picksRef.remove();
            else if (dataKey === 'almacenData') await almacenRef.remove();
            else if (dataKey === 'movimientosData') await movimientosRef.remove();
        } else {
            if (dataKey === 'pickingData') {
                pickingData = [];
                localStorage.removeItem('pickingData');
            } else if (dataKey === 'almacenData') {
                almacenData = [];
                localStorage.removeItem('almacenData');
            } else if (dataKey === 'movimientosData') {
                movimientosData = [];
                localStorage.removeItem('movimientosData');
            }
            renderData();
        }
    }
    document.getElementById('clear-picking-btn').addEventListener('click', () => clearData('pickingData', 'Borrar Picking?'));
    document.getElementById('clear-almacen-btn').addEventListener('click', () => clearData('almacenData', 'Borrar Almacén?'));
    document.getElementById('clear-movimientos-btn').addEventListener('click', () => clearData('movimientosData', 'Borrar Movimientos?'));

    // Export helpers
    function exportToCsv(filename, data, columns) {
        const csvRows = [];
        const bom = '\uFEFF';
        csvRows.push(columns.map(c => `"${c.title}"`).join(';'));
        data.forEach(item => {
            csvRows.push(columns.map(col => `"${(item[col.key] != null ? String(item[col.key]) : '').replace(/"/g,'""')}"`).join(';'));
        });
        const blob = new Blob([bom + csvRows.join('\n')], {
            type: 'text/csv;charset=utf-8;'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function aggregateAndExport(dataArray, filenamePrefix) {
        const today = new Date().toISOString().slice(0, 10);
        const agg = {};
        dataArray.forEach(item => {
            if (!agg[item.sku]) agg[item.sku] = {
                SKU: item.sku,
                CANTIDAD: 0,
                FECHA: item.fecha || '',
                UBICACIONES: []
            };
            agg[item.sku].CANTIDAD += item.cantidad || 0;
            if (item.ubicacion) {
                if (!agg[item.sku].UBICACIONES.includes(item.ubicacion)) agg[item.sku].UBICACIONES.push(item.ubicacion);
            }
        });
        const out = Object.values(agg).map(it => {
            const hasMultipleLocations = it.UBICACIONES.length > 1;
            return {
                SKU: it.SKU,
                CANTIDAD: it.CANTIDAD,
                TXT: `${it.SKU},${it.CANTIDAD}`,
                FECHA: it.FECHA,
                UBICACIÓN: it.UBICACIONES.join(' ; '),
                REVISAR: hasMultipleLocations ? 'SI' : 'NO'
            };
        });
        const cols = [{
            key: 'SKU',
            title: 'SKU'
        }, {
            key: 'CANTIDAD',
            title: 'CANTIDAD'
        }, {
            key: 'TXT',
            title: 'TXT'
        }, {
            key: 'FECHA',
            title: 'FECHA'
        }, {
            key: 'UBICACIÓN',
            title: 'UBICACIÓN'
        }, {
            key: 'REVISAR',
            title: 'REVISAR'
        }];
        exportToCsv(`${filenamePrefix}_${today}.csv`, out, cols);
    }

    function aggregateMovements(movData) {
        const aggregated = {};
        movData.forEach(item => {
            const key = `${item.sku}-${item.origen}-${item.destino}`;
            if (!aggregated[key]) {
                aggregated[key] = {
                    fecha: item.fecha,
                    origen: item.origen,
                    destino: item.destino,
                    sku: item.sku,
                    cantidad: item.cantidad,
                    _key: [item._key] // Almacenar las claves originales en un array
                };
            } else {
                aggregated[key].cantidad += item.cantidad;
                if (!aggregated[key]._key.includes(item._key)) {
                     aggregated[key]._key.push(item._key);
                }
            }
        });
        return Object.values(aggregated);
    }

    document.getElementById('export-picking-btn').addEventListener('click', () => aggregateAndExport(pickingData, 'Picking'));
    document.getElementById('export-almacen-btn').addEventListener('click', () => aggregateAndExport(almacenData, 'Almacén'));
    document.getElementById('export-movimientos-btn').addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        const aggregatedMovs = aggregateMovements(movimientosData);
        const dataWithTxt = aggregatedMovs.map(item => ({
            ...item,
            TXT: `${item.sku},${item.cantidad}`
        }));
        const cols = [{
            key: 'fecha',
            title: 'FECHA'
        }, {
            key: 'origen',
            title: 'ORIGEN'
        }, {
            key: 'destino',
            title: 'DESTINO'
        }, {
            key: 'sku',
            title: 'SKU'
        }, {
            key: 'cantidad',
            title: 'CANTIDAD'
        }, {
            key: 'TXT',
            title: 'TXT'
        }];
        exportToCsv(`Movimientos_${today}.csv`, dataWithTxt, cols);
    });

    function renderData() {
        const pickingCols = [{
            key: 'fecha',
            title: 'Fecha'
        }, {
            key: 'sku',
            title: 'SKU'
        }, {
            key: 'ubicacion',
            title: 'Ubicación'
        }, {
            key: 'cantidad',
            title: 'Cantidad'
        }];
        renderTable('picking-data', pickingData, pickingCols, 'pickingData');
        const almacenCols = [{
            key: 'fecha',
            title: 'Fecha'
        }, {
            key: 'sku',
            title: 'SKU'
        }, {
            key: 'ubicacion',
            title: 'Ubicación'
        }, {
            key: 'cantidad',
            title: 'Cantidad'
        }];
        renderTable('almacen-data', almacenData, almacenCols, 'almacenData');
        const movCols = [{
            key: 'fecha',
            title: 'Fecha'
        }, {
            key: 'origen',
            title: 'Origen'
        }, {
            key: 'destino',
            title: 'Destino'
        }, {
            key: 'sku',
            title: 'SKU'
        }, {
            key: 'cantidad',
            title: 'Cantidad'
        }];
        const aggregatedMovData = aggregateMovements(movimientosData);
        renderTable('movimientos-data', aggregatedMovData, movCols, 'movimientosData');
    }

    // Init
    loadFromLocalStorageAll();
    initFirebase();
    loadCatalogFromGitHub();
});
