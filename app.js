document.addEventListener('DOMContentLoaded', () => {
    // --- Referencias a elementos del DOM ---
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

    // Nuevo: referencia al switch
    const toggleLocationRequirement = document.getElementById('toggle-location-requirement');
    let locationRequirementDisabled = false;
    toggleLocationRequirement.addEventListener('change', () => {
        locationRequirementDisabled = toggleLocationRequirement.checked;
    });

    let currentScanInput = null;

    // --- Almacenamiento de Datos en localStorage ---
    let pickingData = JSON.parse(localStorage.getItem('pickingData')) || [];
    let almacenData = JSON.parse(localStorage.getItem('almacenData')) || [];
    let movimientosData = JSON.parse(localStorage.getItem('movimientosData')) || [];
    let productCatalog = JSON.parse(localStorage.getItem('productCatalog')) || {};

    // --- Funciones de Utilidad ---
    function saveToLocalStorage(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    function renderTable(containerId, data, columns, dataKey) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (data.length === 0) {
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
                td.textContent = item[col.key];
                row.appendChild(td);
            });
            
            const tdActions = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<span class="material-icons">delete_forever</span>';
            deleteBtn.className = 'delete-btn';
            deleteBtn.onclick = () => deleteEntry(dataKey, index);
            tdActions.appendChild(deleteBtn);
            row.appendChild(tdActions);

            tbody.appendChild(row);
        });

        table.appendChild(thead);
        table.appendChild(tbody);
        container.appendChild(table);
    }
    
    function deleteEntry(dataKey, index) {
        if (confirm('¿Estás seguro de que quieres eliminar este registro?')) {
            let dataArray;
            if (dataKey === 'pickingData') {
                dataArray = pickingData;
            } else if (dataKey === 'almacenData') {
                dataArray = almacenData;
            } else if (dataKey === 'movimientosData') {
                dataArray = movimientosData;
            }
            dataArray.splice(index, 1);
            saveToLocalStorage(dataKey, dataArray);
            
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

    // --- Menú Lateral ---
    menuBtn.addEventListener('click', () => sideMenu.classList.add('open'));
    closeMenuBtn.addEventListener('click', () => stopScanner());
    closeMenuBtn.addEventListener('click', () => sideMenu.classList.remove('open'));

    // -------------------------
    // Escáner: implementacion con BarcodeDetector + fallback ZXing
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

    function setupForm(form, dataArray, dataKey) {
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
            let location = locationInput.value.trim();
            const cantidad = parseInt(totalDisplay.textContent) || 0;
            const fecha = new Date().toLocaleString();

            if (!sku) {
                await showDialog("Debe ingresar un SKU", [{ label: "Aceptar", value: false }]);
                return;
            }
            
            // Advertencia ubicación (solo si switch está apagado)
            if (!locationRequirementDisabled && dataKey !== 'movimientosData' && !location) {
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

            const sameSkuDifferentLocation = dataArray.find(item => item.sku === sku && item.ubicacion && item.ubicacion !== location);
            if (sameSkuDifferentLocation) {
                const guardar = await showDialog("Este SKU ya fue cargado con otra ubicacion", [
                    { label: "Cancelar", value: false },
                    { label: "Guardar de todos modos", value: true }
                ]);
                if (!guardar) return;
            }

            const itemToUpdate = dataArray.find(item => item.sku === sku && item.ubicacion === location);
            if (itemToUpdate) {
                itemToUpdate.cantidad += cantidad;
            } else {
                dataArray.push({ fecha, sku, ubicacion: location, cantidad });
            }

            saveToLocalStorage(dataKey, dataArray);
            renderData();
            form.reset();
            updateTotal();
            descriptionSpan.textContent = '';
        });
    }
    
    setupForm(pickingForm, pickingData, 'pickingData');
    setupForm(almacenForm, almacenData, 'almacenData');

    origenSelect.addEventListener('change', (e) => {
        if (e.target.value === 'Picking') {
            destinoSelect.value = 'Almacén';
        } else {
            destinoSelect.value = 'Picking';
        }
    });

    movimientosForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const origen = origenSelect.value;
        const destino = destinoSelect.value;
        const sku = movimientoSKU.value.trim();
        const cantidad = parseInt(movimientoCantidad.value) || 0;
        const fecha = new Date().toLocaleString();
        
        if (!sku || cantidad < 0) {
            alert('Por favor, completa todos los campos correctamente.');
            return;
        }
        
        movimientosData.push({ fecha, origen, destino, sku, cantidad });
        saveToLocalStorage('movimientosData', movimientosData);
        renderData();
        movimientosForm.reset();
    });

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
        fileReader.onload = (e) => {
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
            
            productCatalog = {};
            if (jsonData.length > 0) {
                const firstRow = jsonData[0];
                const keys = Object.keys(firstRow);
                
                const skuKey = keys.find(key => key.toLowerCase().includes('sku'));
                const descKey = keys.find(key => key.toLowerCase().includes('descrip'));
                
                if (skuKey && descKey) {
                    jsonData.forEach(row => {
                        const sku = row[skuKey];
                        const descripcion = row[descKey];
                        if (sku && descripcion) {
                            productCatalog[sku] = { descripcion: descripcion };
                        }
                    });
                } else {
                    alert('El archivo no contiene las columnas "SKU" y "Descripcion".');
                    return;
                }
            }
            
            saveToLocalStorage('productCatalog', productCatalog);
            updateDatalist();
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

    function clearData(dataKey, confirmationMessage) {
        if (confirm(confirmationMessage)) {
            localStorage.removeItem(dataKey);
            eval(`${dataKey} = []`);
            renderData();
        }
    }

    document.getElementById('clear-picking-btn').addEventListener('click', () => clearData('pickingData', '¿Estás seguro de que quieres borrar todos los datos de Picking?'));
    document.getElementById('clear-almacen-btn').addEventListener('click', () => clearData('almacenData', '¿Estás seguro de que quieres borrar todos los datos de Almacén?'));
    document.getElementById('clear-movimientos-btn').addEventListener('click', () => clearData('movimientosData', '¿Estás seguro de que quieres borrar todos los datos de Movimientos?'));

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

    // ---------- CORRECCIÓN: agrego recolección/agrupación de ubicaciones ----------
    function aggregateAndExport(dataArray, filenamePrefix) {
        const today = new Date().toISOString().slice(0, 10);
        const aggregatedData = {};
        dataArray.forEach(item => {
            if (!aggregatedData[item.sku]) {
                aggregatedData[item.sku] = {
                    SKU: item.sku,
                    CANTIDAD: 0,
                    FECHA: item.fecha ? item.fecha.split(',')[0] : '',
                    UBICACIONES: [] // almacenamos un array temporal de ubicaciones
                };
            }
            aggregatedData[item.sku].CANTIDAD += item.cantidad || 0;

            const ubic = item.ubicacion ? String(item.ubicacion).trim() : '';
            if (ubic) {
                // agregamos solo si no está ya presente (evita duplicados)
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
                // convertimos el array de ubicaciones a string; uso " ; " como separador
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
    // ------------------------------------------------------------------------------

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
    
    renderData();
    updateDatalist();
});
