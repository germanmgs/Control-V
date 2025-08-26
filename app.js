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
        if (locationRequirementDisabled) {
            document.getElementById('picking-ubicacion').required = false;
            document.getElementById('almacen-ubicacion').required = false;
        } else {
            document.getElementById('picking-ubicacion').required = true;
            document.getElementById('almacen-ubicacion').required = true;
        }
    });

    // Estado de la aplicación
    let catalogoSKU = [];
    let pickingData = [];
    let almacenData = [];
    let movimientosData = [];
    let contarData = []; // Nueva variable para los datos de conteo
    let firebaseEnabled = false;
    let scanner = null;
    let activeScannerInput = null;

    // Firebase
    let dbRootRef = null;
    let pickingRef = null;
    let almacenRef = null;
    let movimientosRef = null;
    let contarRef = null; // Nueva referencia para Firebase

    async function initFirebase() {
        if (firebaseEnabled) return;
        try {
            firebase.initializeApp(firebaseConfig);
            await firebase.auth().signInAnonymously();
            dbRootRef = firebase.database().ref('vaxel');
            pickingRef = dbRootRef.child('picking');
            almacenRef = dbRootRef.child('almacen');
            movimientosRef = dbRootRef.child('movimientos');
            contarRef = dbRootRef.child('contar'); // Inicialización de la nueva referencia
            firebaseEnabled = true;
            firebaseStatus.textContent = "Firebase: Conectado";
            console.log("Firebase conectado.");
            setupFirebaseListeners();
        } catch (err) {
            firebaseStatus.textContent = "Firebase: Error de Conexión";
            console.error("Error al conectar a Firebase: ", err);
            // Cargar datos desde localStorage si Firebase falla
            pickingData = loadFromLocalStorage('pickingData') || [];
            almacenData = loadFromLocalStorage('almacenData') || [];
            movimientosData = loadFromLocalStorage('movimientosData') || [];
            contarData = loadFromLocalStorage('contarData') || []; // Cargar datos de conteo
            renderData();
        }
    }

    function setupFirebaseListeners() {
        pickingRef.on('value', snapshot => {
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
            updateMovementLocations();
        });

        movimientosRef.on('value', snapshot => {
            const val = snapshot.val();
            movimientosData = objToArray(val);
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        });

        contarRef.on('value', snapshot => { // Listener para la nueva colección
            const val = snapshot.val();
            contarData = objToArray(val);
            saveToLocalStorage('contarData', contarData);
            renderData();
        });
    }

    // Funciones de utilidad
    function objToArray(obj) {
        if (!obj) return [];
        return Object.keys(obj).map(key => ({ _key: key, ...obj[key] }));
    }

    function saveToLocalStorage(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.warn("No se pudo guardar en localStorage.", e);
        }
    }

    function loadFromLocalStorage(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.warn("No se pudo cargar desde localStorage.", e);
            return null;
        }
    }

    async function showDialog(message, buttons) {
        return new Promise(resolve => {
            const overlay = document.getElementById('custom-dialog-overlay');
            const messageEl = document.getElementById('custom-dialog-message');
            const actionsEl = document.getElementById('custom-dialog-actions');

            messageEl.textContent = message;
            actionsEl.innerHTML = '';
            buttons.forEach(btnConfig => {
                const btn = document.createElement('button');
                btn.className = 'btn';
                if (btnConfig.label === 'Si') btn.classList.add('btn-primary');
                btn.textContent = btnConfig.label;
                btn.onclick = () => {
                    overlay.style.display = 'none';
                    resolve(btnConfig.value);
                };
                actionsEl.appendChild(btn);
            });
            overlay.style.display = 'flex';
        });
    }

    // Lógica del Catálogo de SKUs
    async function fetchCatalogo() {
        try {
            const response = await fetch('https://raw.githubusercontent.com/vaxel-sa/stock/main/vaxel-skus.csv');
            const csv = await response.text();
            const { data } = Papa.parse(csv, { header: true, dynamicTyping: true });
            catalogoSKU = data.map(item => item.SKU).filter(sku => sku);
            console.log("Catálogo de SKUs cargado.");
        } catch (err) {
            console.error("Error al cargar el catálogo de SKUs:", err);
        }
    }

    // Lógica de los Formularios
    pickingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sku = document.getElementById('picking-sku').value.toUpperCase().trim();
        const ubicacion = document.getElementById('picking-ubicacion').value.toUpperCase().trim();
        const cantidad = parseInt(document.getElementById('picking-cantidad').value);

        if (locationRequirementDisabled && !ubicacion) {
            const ok = await showDialog('La ubicación no se ha ingresado. ¿Continuar?', [{ label: 'No', value: false }, { label: 'Si', value: true }]);
            if (!ok) return;
        }

        const newEntry = {
            sku,
            ubicacion,
            cantidad,
            fecha: new Date().toLocaleString()
        };

        if (firebaseEnabled) {
            pickingRef.push(newEntry).catch(console.error);
        } else {
            pickingData.push({ ...newEntry, _key: `local-${Date.now()}` });
            saveToLocalStorage('pickingData', pickingData);
            renderData();
        }
        pickingForm.reset();
    });

    almacenForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sku = document.getElementById('almacen-sku').value.toUpperCase().trim();
        const ubicacion = document.getElementById('almacen-ubicacion').value.toUpperCase().trim();
        const cantidad = parseInt(document.getElementById('almacen-cantidad').value);

        if (locationRequirementDisabled && !ubicacion) {
            const ok = await showDialog('La ubicación no se ha ingresado. ¿Continuar?', [{ label: 'No', value: false }, { label: 'Si', value: true }]);
            if (!ok) return;
        }

        const newEntry = {
            sku,
            ubicacion,
            cantidad,
            fecha: new Date().toLocaleString()
        };

        if (firebaseEnabled) {
            almacenRef.push(newEntry).catch(console.error);
        } else {
            almacenData.push({ ...newEntry, _key: `local-${Date.now()}` });
            saveToLocalStorage('almacenData', almacenData);
            renderData();
        }
        almacenForm.reset();
    });

    movimientosForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const origen = origenSelect.value;
        const destino = destinoSelect.value;
        const sku = movimientoSKU.value.toUpperCase().trim();
        const cantidad = parseInt(movimientoCantidad.value);

        if (!origen || !destino || !sku || !cantidad) {
            alert('Por favor, complete todos los campos.');
            return;
        }

        const newEntry = {
            sku,
            origen,
            destino,
            cantidad,
            fecha: new Date().toLocaleString()
        };

        if (firebaseEnabled) {
            movimientosRef.push(newEntry).catch(console.error);
        } else {
            movimientosData.push({ ...newEntry, _key: `local-${Date.now()}` });
            saveToLocalStorage('movimientosData', movimientosData);
            renderData();
        }
        movimientosForm.reset();
    });

    // Lógica para la nueva pestaña "Por Contar"
    async function loadCountListFromFile(file) {
        if (!file) return;
        const statusEl = document.getElementById('file-status');
        statusEl.textContent = 'Cargando archivo...';
        try {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array' });
            const firstSheet = wb.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet]);

            if (!jsonData.length) {
                statusEl.textContent = 'El archivo está vacío.';
                return;
            }

            const skuKey = Object.keys(jsonData[0]).find(k => k.toLowerCase().includes('sku'));
            if (!skuKey) {
                statusEl.textContent = 'El archivo no contiene una columna "SKU".';
                return;
            }

            const newList = jsonData.map((row, index) => ({
                sku: row[skuKey] || '',
                ubicacion: '',
                cantidad: 0,
                contado: false,
                _key: firebaseEnabled ? null : `local-${Date.now()}-${index}`
            })).filter(item => item.sku);

            if (firebaseEnabled) {
                await contarRef.remove();
                const updates = {};
                newList.forEach(item => {
                    const newKey = contarRef.push().key;
                    updates[newKey] = {
                        sku: item.sku,
                        ubicacion: '',
                        cantidad: 0,
                        contado: false
                    };
                });
                await contarRef.update(updates);
            } else {
                contarData = newList;
                saveToLocalStorage('contarData', contarData);
            }

            statusEl.textContent = `Lista de ${newList.length} SKUs cargada correctamente.`;
            renderData();
        } catch (err) {
            console.error('Error al cargar la lista:', err);
            statusEl.textContent = 'Error al procesar el archivo.';
        }
    }

    document.getElementById('upload-count-list-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('file-input');
        if (fileInput.files.length > 0) {
            await loadCountListFromFile(fileInput.files[0]);
        } else {
            document.getElementById('file-status').textContent = 'Selecciona un archivo primero.';
        }
    });

    document.getElementById('clear-contar-btn').addEventListener('click', async () => {
        const ok = await showDialog('¿Estás seguro de que quieres borrar la lista de conteo?', [{ label: 'No', value: false }, { label: 'Si', value: true }]);
        if (ok) {
            if (firebaseEnabled) {
                await contarRef.remove();
            } else {
                contarData = [];
                saveToLocalStorage('contarData', contarData);
                renderData();
            }
        }
    });


    // Funciones de Renderizado
    function renderTable(containerId, data, cols, dataKey) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (!data || data.length === 0) {
            container.innerHTML = '<p>No hay datos para mostrar.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'data-table';
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        cols.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col.title;
            headerRow.appendChild(th);
        });

        const tbody = table.createTBody();
        data.forEach(item => {
            const row = tbody.insertRow();
            cols.forEach(col => {
                const cell = row.insertCell();
                cell.textContent = item[col.key];
            });
        });

        container.appendChild(table);
    }

    function renderContarList(containerId, data) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (!data || data.length === 0) {
            container.innerHTML = '<p>No hay SKUs por contar. Carga una lista.</p>';
            return;
        }

        data.forEach(item => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'contar-entry';
            if (item.contado) entryDiv.classList.add('contado');

            const headerDiv = document.createElement('div');
            headerDiv.className = 'contar-header';
            headerDiv.innerHTML = `
                <span>${item.sku}</span>
                ${item.contado ? '<span class="material-icons check-icon">check_circle</span>' : ''}
            `;
            headerDiv.onclick = () => {
                entryDiv.classList.toggle('expanded');
            };

            const formContainer = document.createElement('div');
            formContainer.className = 'contar-form-container';
            const form = createContarForm(item);
            formContainer.appendChild(form);

            entryDiv.appendChild(headerDiv);
            entryDiv.appendChild(formContainer);
            container.appendChild(entryDiv);
        });
    }

    function createContarForm(item) {
        const form = document.createElement('form');
        form.innerHTML = `
            <div class="input-group">
                <label for="contar-location-${item._key}">Ubicación</label>
                <div class="input-with-scan">
                    <input type="text" id="contar-location-${item._key}" placeholder="Ej: 1-20-3-4" value="${item.ubicacion || ''}">
                    <button type="button" class="scan-btn" data-input="contar-location-${item._key}"><span class="material-icons">qr_code_scanner</span></button>
                </div>
            </div>
            <div class="input-group">
                <label>Cantidad por Cajas</label>
                <div class="quantity-inputs">
                    <span class="material-icons">inventory_2</span>
                    <input type="number" id="contar-boxes-${item._key}" placeholder="Cajas">
                    <span>x</span>
                    <input type="number" id="contar-per-box-${item._key}" placeholder="Unidades/caja">
                </div>
            </div>
            <div class="input-group">
                <label>Unidades Sueltas</label>
                <div class="quantity-inputs">
                    <span class="material-icons">add_box</span>
                    <input type="number" id="contar-loose-${item._key}" placeholder="Sueltas">
                </div>
            </div>
            <div class="input-group">
                <p>Total: <strong id="contar-total-${item._key}">0</strong></p>
            </div>
            <button type="submit" class="btn btn-primary">Guardar Conteo</button>
        `;

        const boxesInput = form.querySelector(`#contar-boxes-${item._key}`);
        const perBoxInput = form.querySelector(`#contar-per-box-${item._key}`);
        const looseInput = form.querySelector(`#contar-loose-${item._key}`);
        const totalDisplay = form.querySelector(`#contar-total-${item._key}`);

        function updateTotal() {
            const boxes = parseInt(boxesInput.value) || 0;
            const perBox = parseInt(perBoxInput.value) || 0;
            const loose = parseInt(looseInput.value) || 0;
            totalDisplay.textContent = (boxes * perBox) + loose;
        }
        boxesInput.addEventListener('input', updateTotal);
        perBoxInput.addEventListener('input', updateTotal);
        looseInput.addEventListener('input', updateTotal);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cantidad = parseInt(totalDisplay.textContent) || 0;
            const ubicacion = form.querySelector(`#contar-location-${item._key}`).value.trim();

            if (cantidad === 0) {
                const ok = await showDialog('La cantidad es 0. ¿Continuar?', [{ label: 'No', value: false }, { label: 'Si', value: true }]);
                if (!ok) return;
            }

            if (firebaseEnabled) {
                await contarRef.child(item._key).update({
                    ubicacion: ubicacion,
                    cantidad: cantidad,
                    contado: true,
                    fecha: new Date().toLocaleString()
                });
            } else {
                const localItem = contarData.find(it => it._key === item._key);
                if (localItem) {
                    localItem.ubicacion = ubicacion;
                    localItem.cantidad = cantidad;
                    localItem.contado = true;
                    localItem.fecha = new Date().toLocaleString();
                    saveToLocalStorage('contarData', contarData);
                }
            }
            form.parentElement.parentElement.classList.remove('expanded');
            renderData();
        });

        return form;
    }

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
        renderContarList('contar-list-container', contarData);
    }

    // Exportación de datos
    function downloadCSV(data, filename) {
        const csv = Papa.unparse(data);
        const blob = new Blob([csv], {
            type: 'text/csv;charset=utf-8;'
        });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    document.getElementById('export-picking-btn').addEventListener('click', () => downloadCSV(pickingData, 'picking-vaxel.csv'));
    document.getElementById('export-almacen-btn').addEventListener('click', () => downloadCSV(almacenData, 'almacen-vaxel.csv'));
    document.getElementById('export-movimientos-btn').addEventListener('click', () => downloadCSV(movimientosData, 'movimientos-vaxel.csv'));
    document.getElementById('export-contar-btn').addEventListener('click', () => {
        const countedItems = contarData.filter(item => item.contado).map(item => ({
            SKU: item.sku,
            Ubicacion: item.ubicacion,
            Cantidad: item.cantidad,
            Fecha: item.fecha
        }));
        if (countedItems.length > 0) {
            downloadCSV(countedItems, 'conteo-vaxel.csv');
        } else {
            showDialog('No hay datos contados para exportar.', [{ label: 'OK', value: true }]);
        }
    });
    
    // Funcionalidades adicionales (Movimientos y Menú)
    function aggregateMovements(data) {
        const aggregated = {};
        data.forEach(item => {
            const key = `${item.sku}-${item.origen}-${item.destino}`;
            if (!aggregated[key]) {
                aggregated[key] = {
                    ...item,
                    cantidad: 0
                };
            }
            aggregated[key].cantidad += item.cantidad;
        });
        return Object.values(aggregated);
    }

    function updateMovementLocations() {
        const ubicaciones = [...new Set(almacenData.map(item => item.ubicacion).filter(loc => loc))].sort();
        const optionsHTML = ubicaciones.map(loc => `<option value="${loc}">${loc}</option>`).join('');
        origenSelect.innerHTML = `<option value="">Seleccione o escanee</option>${optionsHTML}`;
        destinoSelect.innerHTML = `<option value="">Seleccione o escanee</option>${optionsHTML}`;
    }

    // Funcionalidad de Escáner
    document.querySelectorAll('.scan-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeScannerInput = btn.dataset.input;
            startScanner();
        });
    });

    stopScannerBtn.addEventListener('click', stopScanner);

    function startScanner() {
        if (scanner) {
            stopScanner();
        }
        scannerModal.style.display = 'block';
        scanner = new ZXing.BrowserMultiFormatReader();
        scanner.decodeFromVideoDevice(null, 'scanner-container', (result, err) => {
            if (result) {
                const inputElement = document.getElementById(activeScannerInput);
                if (inputElement) {
                    inputElement.value = result.text;
                    stopScanner();
                }
            }
            if (err && !(err instanceof ZXing.NotFoundException)) {
                console.error(err);
            }
        });
    }

    function stopScanner() {
        if (scanner) {
            scanner.reset();
        }
        scannerModal.style.display = 'none';
        activeScannerInput = null;
    }

    // Menú Lateral
    menuBtn.addEventListener('click', () => {
        sideMenu.classList.add('open');
    });

    closeMenuBtn.addEventListener('click', () => {
        sideMenu.classList.remove('open');
    });

    // Pestañas
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(tab => tab.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // Inicialización
    initFirebase();
    fetchCatalogo();
    const cachedCatalogo = loadFromLocalStorage('catalogoSKU');
    if (cachedCatalogo) {
        catalogoSKU = cachedCatalogo;
    }
    renderData();
});
