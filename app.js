/* app.js - integrado con Firebase Realtime Database (y anonymous auth).
   Requiere que pegues firebaseConfig en index.html.
*/

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM refs ---
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

    // switch
    const toggleLocationRequirement = document.getElementById('toggle-location-requirement');
    let locationRequirementDisabled = false;
    toggleLocationRequirement.addEventListener('change', () => {
        locationRequirementDisabled = toggleLocationRequirement.checked;
    });

    let currentScanInput = null;

    // --- Datos locales (contendrán además _key si vienen de Firebase) ---
    let pickingData = [];
    let almacenData = [];
    let movimientosData = [];
    let productCatalog = {};

    // --- Modo y refs Firebase ---
    let firebaseEnabled = false;
    let dbRootRef = null;
    let picksRef = null;
    let almacenRef = null;
    let movimientosRef = null;
    let catalogRef = null;

    function isFirebaseAvailable() {
        return typeof firebase !== 'undefined' && firebase && firebase.app && firebase.apps && firebaseConfig;
    }

    async function initFirebase() {
        if (!isFirebaseAvailable()) {
            firebaseEnabled = false;
            firebaseStatus.textContent = 'Firebase no configurado / modo local';
            console.warn('Firebase no disponible -> modo localStorage');
            loadFromLocalStorageAll();
            renderData();
            return;
        }

        try {
            // sign in anonymous
            await firebase.auth().signInAnonymously();
            dbRootRef = firebase.database().ref('vaxel');
            picksRef = dbRootRef.child('picking');
            almacenRef = dbRootRef.child('almacen');
            movimientosRef = dbRootRef.child('movimientos');
            catalogRef = dbRootRef.child('catalog');

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
        // Helper to convert snapshot object -> array with keys
        const objToArray = (obj) => {
            if (!obj) return [];
            return Object.keys(obj).map(k => ({ ...obj[k], _key: k }));
        };

        // Picking
        picksRef.on('value', snapshot => {
            const val = snapshot.val();
            pickingData = objToArray(val);
            saveToLocalStorage('pickingData', pickingData);
            renderData();
        });

        // Almacén
        almacenRef.on('value', snapshot => {
            const val = snapshot.val();
            almacenData = objToArray(val);
            saveToLocalStorage('almacenData', almacenData);
            renderData();
        });

        // Movimientos
        movimientosRef.on('value', snapshot => {
            const val = snapshot.val();
            movimientosData = objToArray(val);
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        });

        // Catalogo
        catalogRef.on('value', snapshot => {
            const val = snapshot.val() || {};
            productCatalog = val;
            saveToLocalStorage('productCatalog', productCatalog);
            updateDatalist();
            renderData();
        });
    }

    // --- localStorage helpers ---
    function saveToLocalStorage(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.warn('No se pudo guardar en localStorage', e);
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
    }

    // --- Render / Tabla / Utilidades (sin cambios lógicos) ---
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

        data.forEach((item, index) => {
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
        if (!confirm('¿Estás seguro de que quieres eliminar este registro?')) return;

        if (firebaseEnabled) {
            if (dataKey === 'pickingData') {
                await picksRef.child(key).remove();
            } else if (dataKey === 'almacenData') {
                await almacenRef.child(key).remove();
            } else if (dataKey === 'movimientosData') {
                await movimientosRef.child(key).remove();
            }
            // los listeners de firebase actualizarán todo automáticamente
        } else {
            // modo local: buscar por _key o index
            if (dataKey === 'pickingData') {
                pickingData = pickingData.filter(item => item._key !== key);
                saveToLocalStorage('pickingData', pickingData);
            } else if (dataKey === 'almacenData') {
                almacenData = almacenData.filter(item => item._key !== key);
                saveToLocalStorage('almacenData', almacenData);
            } else if (dataKey === 'movimientosData') {
                movimientosData = movimientosData.filter(item => item._key !== key);
                saveToLocalStorage('movimientosData', movimientosData);
            }
            renderData();
        }
    }
    
    function updateDescription(skuInput, descriptionSpan) {
        const sku = skuInput.value;
        const description = productCatalog[sku] ? productCatalog[sku].descripcion : 'Descripción no encontrada';
        descriptionSpan.textContent = description;
    }

    // --- Navegación entre pestañas ---
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => content.classList.remove('active'));
            const targetTab = document.getElementById(button.dataset.tab);
            targetTab.classList.add('active');
            
            renderData();
        });
    });

    // --- Menu lateral ---
    menuBtn.addEventListener('click', () => sideMenu.classList.add('open'));
    closeMenuBtn.addEventListener('click', () => stopScanner());
    closeMenuBtn.addEventListener('click', () => sideMenu.classList.remove('open'));

    // -------------------------
    // Escáner: BarcodeDetector + ZXing fallback (sin cambios mayores)
    // -------------------------
    let videoStream = null;
    let videoElem = null;
    let useBarcodeDetector = false;
    let barcodeDetector = null;
    let zxingControls = null;
    let zxingCodeReader = null;

    const desiredFormats = [
        'code_128', 'code_39', 'ean_13', 'ean_8',
        'upc_a', 'upc_e', 'itf', 'codabar', 'code_93'
    ];

    function ensureVideoElement() {
        if (!videoElem) {
            videoElem = document.createElement('video');
            videoElem.setAttribute('autoplay', true);
            videoElem.setAttribute('playsinline', true);
            videoElem.style.width = '100%';
            videoElem.style.maxHeight = '320px';
            videoElem.style.objectFit = 'cover';
            scannerContainer.innerHTML = '';
            scannerContainer.appendChild(videoElem);
        }
    }

    function stopScanner() {
        if (videoElem && !videoElem.paused) {
            try { videoElem.pause(); } catch (e) {}
        }
        if (zxingControls && typeof zxingControls.stop === 'function') {
            try { zxingControls.stop(); } catch (e) {}
            zxingControls = null;
        }
        if (zxingCodeReader && typeof zxingCodeReader.reset === 'function') {
            try { zxingCodeReader.reset(); } catch(e) {}
            zxingCodeReader = null;
        }
        if (videoStream) {
            videoStream.getTracks().forEach(t => t.stop());
            videoStream = null;
        }
        scannerModal.classList.remove('open');
        if (scannerContainer) scannerContainer.innerHTML = '';
        videoElem = null;
        barcodeDetector = null;
        useBarcodeDetector = false;
    }

    function startScanner() {
        ensureVideoElement();
        if ('BarcodeDetector' in window) {
            if (typeof BarcodeDetector.getSupportedFormats === 'function') {
                BarcodeDetector.getSupportedFormats().then(supported => {
                    const supportsAny = desiredFormats.some(f => supported.includes(f));
                    if (supportsAny) {
                        useBarcodeDetector = true;
                        try {
                            barcodeDetector = new BarcodeDetector({ formats: desiredFormats.filter(f => supported.includes(f)) });
                        } catch (e) {
                            useBarcodeDetector = false;
                            barcodeDetector = null;
                        }
                    } else {
                        useBarcodeDetector = false;
                    }
                    _startVideoAndScan();
                }).catch(err => {
                    try {
                        barcodeDetector = new BarcodeDetector({ formats: desiredFormats });
                        useBarcodeDetector = true;
                    } catch(e) {
                        useBarcodeDetector = false;
                        barcodeDetector = null;
                    }
                    _startVideoAndScan();
                });
            } else {
                try {
                    barcodeDetector = new BarcodeDetector({ formats: desiredFormats });
                    useBarcodeDetector = true;
                } catch (e) {
                    useBarcodeDetector = false;
                    barcodeDetector = null;
                }
                _startVideoAndScan();
            }
        } else {
            useBarcodeDetector = false;
            _startVideoAndScan();
        }
    }

    async function _startVideoAndScan() {
        try {
            const constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
            videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            ensureVideoElement();
            videoElem.srcObject = videoStream;
            await videoElem.play();
        } catch (err) {
            alert('No se pudo acceder a la cámara: ' + (err && err.message ? err.message : err));
            stopScanner();
            return;
        }

        if (useBarcodeDetector && barcodeDetector) {
            let scanning = true;
            async function detectLoop() {
                if (!scanning) return;
                try {
                    const barcodes = await barcodeDetector.detect(videoElem);
                    if (barcodes && barcodes.length) {
                        const code = barcodes[0].rawValue || (barcodes[0].rawData && barcodes[0].rawData.toString());
                        if (code && currentScanInput) {
                            currentScanInput.value = code;
                            currentScanInput.dispatchEvent(new Event('input'));
                            scanning = false;
                            stopScanner();
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('BarcodeDetector.detect error:', e);
                    scanning = false;
                    stopScanner();
                    return;
                }
                requestAnimationFrame(detectLoop);
            }
            requestAnimationFrame(detectLoop);
        } else {
            try {
                let BrowserMultiFormatReader = null;
                if (window.BrowserMultiFormatReader) {
                    BrowserMultiFormatReader = window.BrowserMultiFormatReader;
                } else if (window.ZXing && window.ZXing.BrowserMultiFormatReader) {
                    BrowserMultiFormatReader = window.ZXing.BrowserMultiFormatReader;
                } else if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) {
                    BrowserMultiFormatReader = window.ZXingBrowser.BrowserMultiFormatReader;
                }
                if (!BrowserMultiFormatReader) {
                    alert('Fallback ZXing no disponible en este paquete. Verificar la carga de la librería.');
                    stopScanner();
                    return;
                }
                zxingCodeReader = new BrowserMultiFormatReader();
                const deviceId = await _pickBackCameraId();
                zxingControls = await zxingCodeReader.decodeFromVideoDevice(deviceId || null, videoElem, (result) => {
                    if (result && result.text) {
                        const code = result.text;
                        if (code && currentScanInput) {
                            currentScanInput.value = code;
                            currentScanInput.dispatchEvent(new Event('input'));
                            try { zxingCodeReader.reset(); } catch(e) {}
                            stopScanner();
                        }
                    }
                });
            } catch (e) {
                console.error('Error en ZXing fallback:', e);
                alert('Error iniciando el escáner fallback: ' + (e && e.message ? e.message : e));
                stopScanner();
                return;
            }
        }
    }

    async function _pickBackCameraId() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter(d => d.kind === 'videoinput');
            for (const v of videoInputs) {
                const lbl = (v.label || '').toLowerCase();
                if (lbl.includes('back') || lbl.includes('rear') || lbl.includes('environment')) {
                    return v.deviceId;
                }
            }
            return videoInputs.length ? videoInputs[0].deviceId : null;
        } catch (e) {
            return null;
        }
    }

    document.querySelectorAll('.scan-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentScanInput = document.getElementById(btn.dataset.input);
            scannerModal.classList.add('open');
            startScanner();
        });
    });

    stopScannerBtn.addEventListener('click', () => {
        stopScanner();
    });

    function showDialog(message, buttons = [{ label: 'Aceptar', value: true }]) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-dialog-overlay';
            const box = document.createElement('div');
            box.className = 'custom-dialog-box';
            const msg = document.createElement('p');
            msg.className = 'custom-dialog-message';
            msg.textContent = message;
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'custom-dialog-buttons';
            buttons.forEach((b) => {
                const btn = document.createElement('button');
                btn.textContent = b.label;
                btn.className = 'custom-dialog-button';
                if (b.label === 'Aceptar' || b.label === 'Si' || b.label === 'Guardar de todos modos') {
                    btn.classList.add('primary');
                } else if (b.label === 'Cancelar' || b.label === 'No') {
                    btn.classList.add('secondary');
                }
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(b.value);
                });
                buttonsDiv.appendChild(btn);
            });
            box.appendChild(msg);
            box.appendChild(buttonsDiv);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    // --- FORM SETUP: ahora escriben a Firebase si está activo ---
    function setupForm(form, dataKeyRef, dataKeyName) {
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

        boxesInput.addEventListener('input', updateTotal);
        perBoxInput.addEventListener('input', updateTotal);
        looseInput.addEventListener('input', updateTotal);
        
        skuInput.addEventListener('input', () => updateDescription(skuInput, descriptionSpan));

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sku = skuInput.value.trim();
            let location = locationInput ? locationInput.value.trim() : '';
            const cantidad = parseInt(totalDisplay.textContent) || 0;
            const fecha = new Date().toLocaleString();

            if (!sku) {
                await showDialog("Debe ingresar un SKU", [{ label: "Aceptar", value: false }]);
                return;
            }
            
            if (!locationRequirementDisabled && dataKeyName !== 'movimientosData' && !location) {
                const continuar = await showDialog("ADVERTENCIA: Se subirá el SKU sin ubicación. ¿Continuar?", [
                    { label: "No", value: false },
                    { label: "Si", value: true }
                ]);
                if (!continuar) return;
            }

            if (cantidad === 0) {
                const continuar = await showDialog("La cantidad ingresada es 0 ¿Continuar?", [
                    { label: "No", value: false },
                    { label: "Si", value: true }
                ]);
                if (!continuar) return;
            }

            // Lógica de mezcla/actualización: si ya existe SKU con misma ubicación -> sumar
            // Para simplificar con Firebase: buscamos item igual en la lista local y si existe actualizamos su cantidad.
            let itemToUpdate = null;
            const dataArray = (dataKeyName === 'pickingData') ? pickingData : (dataKeyName === 'almacenData') ? almacenData : movimientosData;
            if (dataKeyName !== 'movimientosData') {
                itemToUpdate = dataArray.find(item => item.sku === sku && item.ubicacion === location);
            }

            if (firebaseEnabled) {
                if (dataKeyName === 'pickingData') {
                    if (itemToUpdate) {
                        // actualizar cantidad en db
                        const key = itemToUpdate._key;
                        const newCantidad = (parseInt(itemToUpdate.cantidad) || 0) + cantidad;
                        await picksRef.child(key).update({ cantidad: newCantidad, fecha });
                    } else {
                        await picksRef.push({ fecha, sku, ubicacion: location, cantidad });
                    }
                } else if (dataKeyName === 'almacenData') {
                    if (itemToUpdate) {
                        const key = itemToUpdate._key;
                        const newCantidad = (parseInt(itemToUpdate.cantidad) || 0) + cantidad;
                        await almacenRef.child(key).update({ cantidad: newCantidad, fecha });
                    } else {
                        await almacenRef.push({ fecha, sku, ubicacion: location, cantidad });
                    }
                } else {
                    // movimientos
                    await movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
                }
                // Firebase listeners actualizarán la UI
            } else {
                // modo local: trabajar sobre arrays y guardar localStorage
                if (dataKeyName === 'pickingData') {
                    if (itemToUpdate) {
                        itemToUpdate.cantidad += cantidad;
                    } else {
                        const newObj = { fecha, sku, ubicacion: location, cantidad, _key: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) };
                        pickingData.push(newObj);
                    }
                    saveToLocalStorage('pickingData', pickingData);
                } else if (dataKeyName === 'almacenData') {
                    if (itemToUpdate) {
                        itemToUpdate.cantidad += cantidad;
                    } else {
                        const newObj = { fecha, sku, ubicacion: location, cantidad, _key: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) };
                        almacenData.push(newObj);
                    }
                    saveToLocalStorage('almacenData', almacenData);
                } else {
                    // movimientos local
                    const newObj = { fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad, _key: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) };
                    movimientosData.push(newObj);
                    saveToLocalStorage('movimientosData', movimientosData);
                }
                renderData();
            }

            form.reset();
            updateTotal();
            if (descriptionSpan) descriptionSpan.textContent = '';
        });
    }
    
    setupForm(pickingForm, null, 'pickingData');
    setupForm(almacenForm, null, 'almacenData');

    origenSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Picking') {
            destinoSelect.value = 'Almacén';
        } else {
            destinoSelect.value = 'Picking';
        }
    });

    // Movimientos form (usa setupForm? ya cubierto but keep listener for explicit behavior)
    movimientosForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const sku = movimientoSKU.value.trim();
        const cantidad = parseInt(movimientoCantidad.value) || 0;
        const fecha = new Date().toLocaleString();

        if (!sku || cantidad < 0) {
            alert('Por favor, completa todos los campos correctamente.');
            return;
        }

        if (firebaseEnabled) {
            movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
        } else {
            const newObj = { fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad, _key: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) };
            movimientosData.push(newObj);
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        }
        movimientosForm.reset();
    });

    // --- Carga de catálogo desde archivo (guarda en Firebase o local) ---
    document.getElementById('load-file-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('file-input');
        const file = fileInput.files[0];
        if (!file) {
            alert('Por favor, selecciona un archivo.');
            return;
        }

        const fileName = file.name;
        const fileType = fileName.split('.').pop().toLowerCase();
        
        let fileReader = new FileReader();
        fileReader.onload = async (e) => {
            let jsonData;
            if (fileType === 'xlsx') {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.SheetNames[0];
                jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
            } else if (fileType === 'csv') {
                const csvData = Papa.parse(e.target.result, { header: true });
                jsonData = csvData.data;
            } else {
                alert('Formato de archivo no soportado. Usa .csv o .xlsx');
                return;
            }
            
            const newCatalog = {};
            if (jsonData.length > 0) {
                const firstRow = jsonData[0];
                const keys = Object.keys(firstRow);
                
                const skuKey = keys.find(key => key.toLowerCase().includes('sku'));
                const descKey = keys.find(key => key.toLowerCase().includes('descrip') || key.toLowerCase().includes('desc'));
                
                if (skuKey && descKey) {
                    jsonData.forEach(row => {
                        const sku = row[skuKey];
                        const descripcion = row[descKey];
                        if (sku && descripcion) {
                            newCatalog[sku] = { descripcion: descripcion };
                        }
                    });
                } else {
                    alert('El archivo no contiene las columnas "SKU" y "Descripcion".');
                    return;
                }
            }

            productCatalog = newCatalog;
            saveToLocalStorage('productCatalog', productCatalog);
            updateDatalist();

            if (firebaseEnabled) {
                await catalogRef.set(productCatalog);
            }

            alert('Catálogo de productos cargado exitosamente.');
        };
        
        if (fileType === 'xlsx') {
            fileReader.readAsArrayBuffer(file);
        } else {
            fileReader.readAsText(file);
        }
    });

    function updateDatalist() {
        skuSuggestions.innerHTML = '';
        for (const sku in productCatalog) {
            const option = document.createElement('option');
            option.value = sku;
            skuSuggestions.appendChild(option);
        }
    }

    // --- Clear data (local + firebase) ---
    async function clearData(dataKey, confirmationMessage) {
        if (!confirm(confirmationMessage)) return;

        if (firebaseEnabled) {
            if (dataKey === 'pickingData') {
                await picksRef.remove();
            } else if (dataKey === 'almacenData') {
                await almacenRef.remove();
            } else if (dataKey === 'movimientosData') {
                await movimientosRef.remove();
            }
            // firebase listeners se encargarán de limpiar localStorage y UI
        } else {
            if (dataKey === 'pickingData') {
                localStorage.removeItem('pickingData');
                pickingData = [];
            } else if (dataKey === 'almacenData') {
                localStorage.removeItem('almacenData');
                almacenData = [];
            } else if (dataKey === 'movimientosData') {
                localStorage.removeItem('movimientosData');
                movimientosData = [];
            }
            renderData();
        }
    }

    document.getElementById('clear-picking-btn').addEventListener('click', () => clearData('pickingData', '¿Estás seguro de que quieres borrar todos los datos de Picking?'));
    document.getElementById('clear-almacen-btn').addEventListener('click', () => clearData('almacenData', '¿Estás seguro de que quieres borrar todos los datos de Almacén?'));
    document.getElementById('clear-movimientos-btn').addEventListener('click', () => clearData('movimientosData', '¿Estás seguro de que quieres borrar todos los datos de Movimientos?'));

    // --- Export helpers (no cambian) ---
    function exportToCsv(filename, data, columns) {
        const csvRows = [];
        const bom = '\uFEFF';
        
        const headers = columns.map(col => `"${col.title}"`).join(';');
        csvRows.push(headers);
        
        data.forEach(item => {
            const values = columns.map(col => {
                const value = item[col.key] != null ? String(item[col.key]) : '';
                return `"${value.replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(';'));
        });

        const csvString = csvRows.join('\n');
        const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function aggregateAndExport(dataArray, filenamePrefix) {
        const today = new Date().toISOString().slice(0, 10);
        const aggregatedData = {};
        dataArray.forEach(item => {
            if (!aggregatedData[item.sku]) {
                aggregatedData[item.sku] = {
                    SKU: item.sku,
                    CANTIDAD: 0,
                    FECHA: item.fecha ? item.fecha.split(',')[0] : '',
                    UBICACIONES: []
                };
            }
            aggregatedData[item.sku].CANTIDAD += item.cantidad || 0;

            const ubic = item.ubicacion ? String(item.ubicacion).trim() : '';
            if (ubic) {
                if (!aggregatedData[item.sku].UBICACIONES.includes(ubic)) {
                    aggregatedData[item.sku].UBICACIONES.push(ubic);
                }
            }
        });

        const dataToExport = Object.values(aggregatedData).map(item => {
            const cantidad = item.CANTIDAD !== undefined ? item.CANTIDAD : 0;
            return {
                SKU: item.SKU,
                CANTIDAD: cantidad,
                TXT: `${item.SKU},${cantidad}`,
                FECHA: item.FECHA,
                UBICACIONES: item.UBICACIONES.length ? item.UBICACIONES.join(' ; ') : ''
            };
        });

        const columns = [
            { key: 'SKU', title: 'SKU' },
            { key: 'CANTIDAD', title: 'CANTIDAD' },
            { key: 'TXT', title: 'TXT' },
            { key: 'FECHA', title: 'FECHA' },
            { key: 'UBICACIONES', title: 'Ubicaciones' }
        ];
        
        exportToCsv(`${filenamePrefix}_${today}.csv`, dataToExport, columns);
    }

    document.getElementById('export-picking-btn').addEventListener('click', () => aggregateAndExport(pickingData, 'Picking'));
    document.getElementById('export-almacen-btn').addEventListener('click', () => aggregateAndExport(almacenData, 'Almacén'));
    
    document.getElementById('export-movimientos-btn').addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        const columns = [
            { key: 'fecha', title: 'FECHA' },
            { key: 'origen', title: 'ORIGEN' },
            { key: 'destino', title: 'DESTINO' },
            { key: 'sku', title: 'SKU' },
            { key: 'cantidad', title: 'CANTIDAD' }
        ];
        exportToCsv(`Movimientos_${today}.csv`, movimientosData, columns);
    });

    function renderData() {
        const pickingColumns = [
            { key: 'fecha', title: 'Fecha' },
            { key: 'sku', title: 'SKU' },
            { key: 'ubicacion', title: 'Ubicación' },
            { key: 'cantidad', title: 'Cantidad' }
        ];
        renderTable('picking-data', pickingData, pickingColumns, 'pickingData');

        const almacenColumns = [
            { key: 'fecha', title: 'Fecha' },
            { key: 'sku', title: 'SKU' },
            { key: 'ubicacion', title: 'Ubicación' },
            { key: 'cantidad', title: 'Cantidad' }
        ];
        renderTable('almacen-data', almacenData, almacenColumns, 'almacenData');

        const movimientosColumns = [
            { key: 'fecha', title: 'Fecha' },
            { key: 'origen', title: 'Origen' },
            { key: 'destino', title: 'Destino' },
            { key: 'sku', title: 'SKU' },
            { key: 'cantidad', title: 'Cantidad' }
        ];
        renderTable('movimientos-data', movimientosData, movimientosColumns, 'movimientosData');
    }

    // --- Inicialización ---
    // Si hay firebaseConfig y firebase está cargado, inicializo firebase; si no, cargo localStorage
    initFirebase();

    // Si Firebase no quedó disponible en 2s (ej: config null), aseguro carga local
    setTimeout(() => {
        if (!firebaseEnabled && (!pickingData.length && !almacenData.length && !movimientosData.length && Object.keys(productCatalog).length === 0)) {
            loadFromLocalStorageAll();
            renderData();
        }
    }, 1500);
});
