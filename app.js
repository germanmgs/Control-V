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
    const guardadoForm = document.getElementById('guardado-form');
    const guardadoSkuInput = document.getElementById('guardado-sku');
    const guardadoMarcaBanner = document.getElementById('guardado-marca-banner');
    const guardadoMarcaActual = document.getElementById('guardado-marca-actual');
    const guardadoMarcaQuitarBtn = document.getElementById('guardado-marca-quitar');

    const skuSuggestions = document.getElementById('sku-suggestions');
    const scannerModal = document.getElementById('scanner-modal');
    const scannerContainer = document.getElementById('scanner-container');
    const scanEngineStatus = document.getElementById('scan-engine-status');
    const stopScannerBtn = document.getElementById('stop-scanner-btn');

    const origenSelect = document.getElementById('origen-select');
    const destinoSelect = document.getElementById('destino-select');
    const movimientoSKU = document.getElementById('movimiento-sku');
    const movimientoCantidad = document.getElementById('movimiento-cantidad');

    const firebaseStatus = document.getElementById('firebase-status');
    const catalogStatus = document.getElementById('catalog-status');
    const locationCatalogStatus = document.getElementById('location-catalog-status');
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
    let guardadoData = [];
    let productCatalog = {};

    // Catálogo de ubicaciones (Articulos_-_Ubicación.txt, separado por tabulaciones)
    // byArticleCode: normalizado codigoarticulo (Vaxel, único) -> {codigoarticulo, codigofabrica, ubicacion, marca}
    // byFabricaCode: normalizado codigofabrica (puede repetirse) -> array de las filas que lo tienen
    let locationByArticleCode = {};
    let locationByFabricaCode = {};

    // Marca "pegada" en la sesión de Guardado, para no volver a preguntar por cada código de fábrica repetido
    let guardadoMarcaFijada = null;

    // URL del catálogo en GitHub - USAMOS EL NOMBRE EXACTO DEL ARCHIVO XLSX
    const githubCatalogUrl = './Catalogo.xlsx';
    // URL del archivo de ubicaciones (TXT separado por tabs) en GitHub
    // (La URL del archivo de ubicaciones se resuelve dinámicamente en fetchLocationText,
    // probando variantes de normalización Unicode del nombre de archivo)

    // Firebase refs
    let firebaseEnabled = false;
    let dbRootRef = null;
    let picksRef = null;
    let almacenRef = null;
    let movimientosRef = null;
    let guardadoRef = null;

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
            guardadoRef = dbRootRef.child('guardado');

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

        guardadoRef.on('value', snapshot => {
            const val = snapshot.val();
            guardadoData = objToArray(val);
            saveToLocalStorage('guardadoData', guardadoData);
            renderData();
        });
    }

    // Funciones de carga de catálogo
    async function loadCatalogFromGitHub() {
        if (catalogStatus) catalogStatus.textContent = 'Cargando...';
        try {
            // *******************************************************************
            // LECTURA DE ARCHIVOS XLSX
            const response = await fetch(githubCatalogUrl);
            if (!response.ok) {
                throw new Error('Error al obtener el catálogo. Código de estado: ' + response.status);
            }

            // 1. Leer el archivo como ArrayBuffer (necesario para archivos binarios como XLSX)
            const arrayBuffer = await response.arrayBuffer();

            // 2. Usar la librería XLSX (SheetJS) para leer el libro de trabajo
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });

            // 3. Obtener el nombre de la primera hoja
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // 4. Convertir la hoja de trabajo a formato CSV para que PapaParse la maneje
            const csvData = XLSX.utils.sheet_to_csv(worksheet);
            // *******************************************************************

            // 5. Usamos PapaParse para procesar los datos CSV convertidos
            Papa.parse(csvData, {
                header: true,
                skipEmptyLines: true,
                complete: function (results) {

                    if (results.data.length === 0 || !results.meta.fields) {
                        if (catalogStatus) catalogStatus.textContent = 'Error: el archivo Excel está vacío o no contiene encabezados válidos.';
                        return;
                    }

                    const headers = results.meta.fields || [];
                    const newCatalog = {};

                    // Buscamos las columnas que contienen las palabras clave, ignorando mayúsculas/minúsculas/acentos
                    const cleanHeaders = headers.map(h => String(h).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());

                    const skuKey = headers.find((k, i) => cleanHeaders[i].includes('sku'));
                    const descKey = headers.find((k, i) => cleanHeaders[i].includes('descrip') || cleanHeaders[i].includes('desc') || cleanHeaders[i].includes('nombre'));

                    let locKey = headers.find((h, i) => cleanHeaders[i] === 'ubicaciones' || cleanHeaders[i] === 'ubicacion' || cleanHeaders[i] === 'locacion' || cleanHeaders[i] === 'loc');

                    if (!skuKey || !descKey) {
                        if (catalogStatus) catalogStatus.textContent = 'Error: el catálogo no tiene columnas con encabezados que contengan "SKU" y "Descripcion/Nombre".';
                        return;
                    }

                    if (!locKey) {
                        console.warn("ADVERTENCIA: No se encontró una columna con el encabezado 'Ubicación' o similar.");
                        locKey = null;
                    }

                    results.data.forEach(row => {
                        const sku = row[skuKey];
                        const descripcion = row[descKey];
                        const ubicacion = locKey && row[locKey] ? String(row[locKey]).trim() : '';

                        // Clave normalizada (mayúsculas/sin tildes/sin espacios extra) para que
                        // matchee siempre con normalizeSku() al buscar, sin importar el escaneo.
                        if (sku) newCatalog[normalizeSku(sku)] = {
                            descripcion: descripcion || '',
                            ubicacion: ubicacion
                        };
                    });

                    productCatalog = newCatalog;
                    saveToLocalStorage('productCatalog', productCatalog);
                    updateDatalist();
                    const cantidad = Object.keys(newCatalog).length;
                    if (catalogStatus) catalogStatus.textContent = `Cargado: ${cantidad} productos.`;

                },
                error: function (err) {
                    console.error('Error al parsear CSV (PapaParse):', err);
                    if (catalogStatus) catalogStatus.textContent = 'Error al parsear el catálogo: ' + err.message;
                }
            });

        } catch (error) {
            console.error('Error al cargar catálogo:', error);
            if (catalogStatus) catalogStatus.textContent = 'Error al cargar el archivo. Verificá que "Catalogo.xlsx" esté en la raíz del repo (GitHub) y que estés entrando por la URL de GitHub Pages.';
        }
    }

    // Normaliza un código (SKU/código de fábrica) para comparar sin importar
    // mayúsculas, espacios extra o tildes, tanto al armar los catálogos como al buscar.
    function normalizeSku(value) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function getCatalogEntry(sku) {
        return productCatalog[normalizeSku(sku)] || null;
    }

    // Carga el archivo de Ubicaciones (Articulos_-_Ubicación.txt) desde GitHub.
    // Es un TXT separado por TABULACIONES con columnas:
    // codigoarticulo (Vaxel, único) | codigofabrica (puede repetirse) | ubicacion | codigodemarca | nombre_marca
    async function fetchLocationText() {
        // Priorizamos el nombre simple (sin espacios/acentos), que es el más confiable
        // para GitHub Pages. Dejamos los nombres viejos como respaldo por compatibilidad.
        const candidatos = [
            './ubicaciones.txt',
            encodeURI('./Articulos_-_Ubicación.txt'),
            encodeURI('./Articulos_-_Ubicación.txt'.normalize('NFD')),
            encodeURI('./Articulos_-_Ubicación.txt'.normalize('NFC')),
            encodeURI('./Articulos - Ubicación.txt'),
            encodeURI('./Articulos - Ubicación.txt'.normalize('NFD'))
        ];
        let lastError = null;
        for (const url of candidatos) {
            try {
                const response = await fetch(url);
                if (response.ok) return await response.text();
                lastError = new Error('HTTP ' + response.status + ' en ' + url);
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error('No se pudo obtener el archivo de ubicaciones.');
    }

    async function loadLocationCatalogFromGitHub() {
        if (locationCatalogStatus) locationCatalogStatus.textContent = 'Cargando...';
        try {
            const text = await fetchLocationText();

            // El archivo puede venir en dos formatos:
            // 1) Formato viejo: con fila de encabezado, separado por TABULACIONES.
            // 2) Formato nuevo: SIN encabezado, separado por COMAS, mismo orden de columnas:
            //    codigoarticulo, codigofabrica, ubicacion, codigodemarca, nombre_marca
            const primeraLinea = text.split(/\r?\n/, 1)[0] || '';
            const tieneEncabezado = /codigoarticulo/i.test(primeraLinea);
            const delimitador = tieneEncabezado ? '\t' : ',';

            await new Promise((resolve) => {
                Papa.parse(text, {
                    header: tieneEncabezado,
                    delimiter: delimitador,
                    skipEmptyLines: true,
                    complete: function (results) {
                        let caKey, cfKey, ubKey, marcaKey;
                        let rows = results.data;

                        if (tieneEncabezado) {
                            if (!results.meta.fields) {
                                const msg = 'El archivo de ubicaciones no tiene encabezados válidos.';
                                console.warn(msg);
                                if (locationCatalogStatus) locationCatalogStatus.textContent = 'Error: ' + msg;
                                resolve();
                                return;
                            }
                            const headers = results.meta.fields;
                            const cleanHeaders = headers.map(h => String(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());
                            caKey = headers.find((h, i) => cleanHeaders[i] === 'codigoarticulo');
                            cfKey = headers.find((h, i) => cleanHeaders[i] === 'codigofabrica');
                            ubKey = headers.find((h, i) => cleanHeaders[i] === 'ubicacion');
                            marcaKey = headers.find((h, i) => cleanHeaders[i] === 'nombre_marca' || cleanHeaders[i] === 'marca');

                            if (!caKey) {
                                const msg = 'El archivo de ubicaciones no tiene columna "codigoarticulo".';
                                console.warn(msg);
                                if (locationCatalogStatus) locationCatalogStatus.textContent = 'Error: ' + msg;
                                resolve();
                                return;
                            }
                        } else {
                            // Sin encabezado: columnas por posición fija.
                            // 0: codigoarticulo, 1: codigofabrica, 2: ubicacion, 3: codigodemarca, 4: nombre_marca
                            caKey = 0;
                            cfKey = 1;
                            ubKey = 2;
                            marcaKey = 4;
                        }

                        const newByArticle = {};
                        const newByFabrica = {};

                        rows.forEach(row => {
                            const codigoarticuloRaw = row[caKey];
                            if (!codigoarticuloRaw) return;
                            const codigoarticulo = normalizeSku(codigoarticuloRaw);
                            const codigofabricaRaw = row[cfKey];
                            const codigofabrica = codigofabricaRaw ? normalizeSku(codigofabricaRaw) : '';
                            const ubicacion = row[ubKey] ? String(row[ubKey]).trim() : '';
                            const marca = row[marcaKey] ? String(row[marcaKey]).trim() : '';

                            const entry = {
                                codigoarticulo: String(codigoarticuloRaw).trim(),
                                codigofabrica: codigofabricaRaw ? String(codigofabricaRaw).trim() : '',
                                ubicacion,
                                marca
                            };

                            newByArticle[codigoarticulo] = entry;

                            if (codigofabrica) {
                                if (!newByFabrica[codigofabrica]) newByFabrica[codigofabrica] = [];
                                newByFabrica[codigofabrica].push(entry);
                            }
                        });

                        locationByArticleCode = newByArticle;
                        locationByFabricaCode = newByFabrica;
                        saveToLocalStorage('locationByArticleCode', locationByArticleCode);
                        saveToLocalStorage('locationByFabricaCode', locationByFabricaCode);

                        const cantidad = Object.keys(newByArticle).length;
                        if (locationCatalogStatus) {
                            locationCatalogStatus.textContent = cantidad > 0 ?
                                `Cargado: ${cantidad} artículos con ubicación/código de fábrica.` :
                                'El archivo se cargó pero no contiene filas válidas.';
                        }
                        resolve();
                    },
                    error: function (err) {
                        console.error('Error al parsear el archivo de ubicaciones:', err);
                        if (locationCatalogStatus) locationCatalogStatus.textContent = 'Error al parsear el archivo: ' + err.message;
                        resolve();
                    }
                });
            });
        } catch (error) {
            console.error('Error al cargar el archivo de ubicaciones:', error);
            if (locationCatalogStatus) locationCatalogStatus.textContent = 'Error al cargar el archivo. Verificá que "ubicaciones.txt" esté en la raíz del repo (GitHub).';
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
        guardadoData = loadFromLocalStorage('guardadoData', []);
        productCatalog = loadFromLocalStorage('productCatalog', {});
        locationByArticleCode = loadFromLocalStorage('locationByArticleCode', {});
        locationByFabricaCode = loadFromLocalStorage('locationByFabricaCode', {});
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
            else if (dataKey === 'guardadoData') await guardadoRef.child(key).remove();
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
            } else if (dataKey === 'guardadoData') {
                guardadoData = guardadoData.filter(it => it._key !== key);
                saveToLocalStorage('guardadoData', guardadoData);
            }
            renderData();
        }
    }

    function updateDescription(skuInput, descriptionSpan) {
        const entry = getCatalogEntry(skuInput.value);
        const description = entry ? entry.descripcion : '';
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

    // Escáner (BarcodeDetector o ZXing)
    let videoStream = null;
    let videoElem = null;
    let barcodeDetector = null;
    let useBarcodeDetector = false;
    let zxingCodeReader = null;
    let scanCanvas = null;
    let imageCaptureInstance = null;
    let scanLoopActive = false;
    // Restringido SOLO a Code 128, que es el formato real de tus etiquetas (verificado con la
    // etiqueta de ejemplo SRFZ1). Formatos como ITF/Codabar no tienen checksum fuerte y son
    // la causa típica de que el escáner "lea" cosas que no son códigos (reflejos, texturas, etc).
    const desiredFormats = ['code_128'];

    function ensureVideoElement() {
        if (!videoElem) {
            videoElem = document.createElement('video');
            videoElem.setAttribute('autoplay', true);
            videoElem.setAttribute('playsinline', true);
            videoElem.style.width = '100%';
            videoElem.style.maxHeight = '320px';
            videoElem.style.objectFit = 'cover';
            // Insertamos el video como primer hijo, sin borrar la guía visual que ya está en el HTML.
            scannerContainer.insertBefore(videoElem, scannerContainer.firstChild);
        }
        if (scanEngineStatus) scanEngineStatus.textContent = 'Iniciando cámara...';
    }

    function stopScanner() {
        scanLoopActive = false;
        if (videoElem && !videoElem.paused) try {
            videoElem.pause();
        } catch (e) {}
        if (zxingCodeReader && zxingCodeReader.reset) try {
            zxingCodeReader.reset();
        } catch (e) {}
        if (videoStream) {
            videoStream.getTracks().forEach(t => t.stop());
            videoStream = null;
        }
        scannerModal.classList.remove('open');
        if (videoElem && videoElem.parentNode) videoElem.parentNode.removeChild(videoElem);
        videoElem = null;
        barcodeDetector = null;
        useBarcodeDetector = false;
        imageCaptureInstance = null;
        if (scanEngineStatus) scanEngineStatus.textContent = '';
    }

    async function startScanner() {
        ensureVideoElement();
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: {
                        ideal: 'environment'
                    },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            videoElem.srcObject = videoStream;
            await videoElem.play();

            // Intentar forzar enfoque continuo (ayuda mucho con etiquetas chicas/de cerca).
            // No todos los celulares/navegadores lo soportan, por eso va en un try/catch aparte.
            try {
                const [track] = videoStream.getVideoTracks();
                const capabilities = track.getCapabilities ? track.getCapabilities() : {};
                const advanced = [];
                if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                    advanced.push({ focusMode: 'continuous' });
                }
                // Un poco de zoom óptico/digital si el celular lo soporta: permite escanear
                // sin tener que pegar tanto la cámara al código (ahí es donde más cuesta enfocar).
                if (capabilities.zoom && capabilities.zoom.max) {
                    const zoomTarget = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min || 1, 2));
                    advanced.push({ zoom: zoomTarget });
                }
                if (advanced.length) {
                    await track.applyConstraints({ advanced });
                }
            } catch (focusErr) {
                console.warn('No se pudo ajustar enfoque/zoom de la cámara:', focusErr);
            }

            // ImageCapture permite pedirle a la cámara fotos de alta calidad (resolución real
            // de foto, no de video) de forma automática y en segundo plano, sin ningún botón
            // ni diálogo — la persona sigue viendo exactamente la misma pantalla de siempre.
            imageCaptureInstance = null;
            try {
                const [track] = videoStream.getVideoTracks();
                if ('ImageCapture' in window && track) {
                    imageCaptureInstance = new ImageCapture(track);
                }
            } catch (icErr) {
                console.warn('ImageCapture no disponible:', icErr);
                imageCaptureInstance = null;
            }
        } catch (err) {
            alert('No se pudo acceder a la cámara: ' + (err.message || err));
            stopScanner();
            return;
        }

        let nativeDiag = '';
        if ('BarcodeDetector' in window) {
            try {
                const supported = await BarcodeDetector.getSupportedFormats();
                useBarcodeDetector = desiredFormats.some(f => supported.includes(f));
                if (useBarcodeDetector) barcodeDetector = new BarcodeDetector({
                    formats: supported.filter(f => desiredFormats.includes(f))
                });
                nativeDiag = 'Nativo existe. Formatos: ' + (supported && supported.length ? supported.join(',') : '(vacío)');
                console.log('BarcodeDetector formatos soportados por este navegador:', supported);
            } catch (e) {
                useBarcodeDetector = false;
                barcodeDetector = null;
                nativeDiag = 'Nativo existe pero falló: ' + (e && e.message ? e.message.slice(0, 80) : String(e));
                console.warn('BarcodeDetector falló al iniciar:', e);
            }
        } else {
            nativeDiag = 'BarcodeDetector no existe en este navegador (window.BarcodeDetector es undefined)';
        }
        window.__vaxelScanDiag = nativeDiag;

        // Preparamos también ZXing como respaldo (o único método si no hay BarcodeDetector nativo)
        const Reader = window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader) || (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader);
        if (Reader) {
            const hints = new Map();
            // TRY_HARDER y POSSIBLE_FORMATS son "hints" (DecodeHintType), no BarcodeFormat.
            const DecodeHintType = (window.ZXing && window.ZXing.DecodeHintType) || (window.ZXingBrowser && window.ZXingBrowser.DecodeHintType);
            const BarcodeFormat = (window.ZXing && window.ZXing.BarcodeFormat) || (window.ZXingBrowser && window.ZXingBrowser.BarcodeFormat);
            if (DecodeHintType && BarcodeFormat) {
                hints.set(DecodeHintType.TRY_HARDER, true);
                // Restringido SOLO a Code 128 (ver nota en desiredFormats más arriba).
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                    BarcodeFormat.CODE_128
                ]);
            }
            try {
                zxingCodeReader = new Reader(hints, 120);
            } catch (e) {
                zxingCodeReader = null;
            }
        }

        if (!useBarcodeDetector && !zxingCodeReader) {
            alert('No hay método de escaneo disponible en este navegador.');
            stopScanner();
            return;
        }

        scanAttempts = 0;
        lastScanError = '';
        updateScanEngineStatus();

        startScanLoop();
    }

    // Diagnóstico visible en pantalla: qué motor está usando y cuántos intentos lleva.
    // Esto es clave para saber si el celular está usando el detector nativo (rápido, como
    // cualquier app de escaneo) o si por algún motivo cae al modo de respaldo (mucho más débil).
    let scanAttempts = 0;
    let lastScanError = '';
    function updateScanEngineStatus() {
        if (!scanEngineStatus) return;
        let engine = 'Ninguno disponible';
        if (useBarcodeDetector) engine = 'Detector nativo del celular';
        else if (zxingCodeReader) engine = 'Librería de respaldo (ZXing)';
        const modo = imageCaptureInstance ? ' + fotos automáticas' : ' + video en vivo';
        const diag = window.__vaxelScanDiag ? ` — [${window.__vaxelScanDiag}]` : '';
        scanEngineStatus.textContent = `Motor: ${engine}${modo} — Intentos: ${scanAttempts}` + (lastScanError ? ` — Último error: ${lastScanError}` : '') + diag;
    }

    function handleScanSuccess(code) {
        if (currentScanInput) {
            currentScanInput.value = code;
            currentScanInput.dispatchEvent(new Event('input'));
            currentScanInput.dispatchEvent(new CustomEvent('scan-complete', { detail: { code } }));
        }
        stopScanner();
    }

    // Convierte un Blob de foto (de ImageCapture) en un canvas listo para decodificar.
    async function photoBlobToCanvas(blob) {
        const bitmap = await createImageBitmap(blob);
        if (!scanCanvas) scanCanvas = document.createElement('canvas');
        scanCanvas.width = bitmap.width;
        scanCanvas.height = bitmap.height;
        scanCanvas.getContext('2d').drawImage(bitmap, 0, 0);
        if (bitmap.close) bitmap.close();
        return scanCanvas;
    }

    // Prioriza fotos reales de alta calidad (ImageCapture.takePhoto), automáticas y en
    // segundo plano — sin ningún botón ni diálogo visible — porque tienen mucha más
    // resolución y nitidez que un frame de video en vivo, especialmente quando el celular
    // no tiene el detector nativo (ML Kit) disponible y depende de la librería de respaldo.
    // Si el celular no soporta ImageCapture, se usa el frame de video como venía siendo.
    async function captureFrameCanvas() {
        if (imageCaptureInstance) {
            try {
                const blob = await imageCaptureInstance.takePhoto();
                return await photoBlobToCanvas(blob);
            } catch (e) {
                // Algunos celulares fallan la primera vez o mientras enfocan: seguimos con video.
            }
        }
        if (!scanCanvas) scanCanvas = document.createElement('canvas');
        scanCanvas.width = videoElem.videoWidth || 640;
        scanCanvas.height = videoElem.videoHeight || 480;
        scanCanvas.getContext('2d').drawImage(videoElem, 0, 0, scanCanvas.width, scanCanvas.height);
        return scanCanvas;
    }

    function startScanLoop() {
        scanLoopActive = true;

        async function tick() {
            if (!scanLoopActive) return;
            scanAttempts++;

            const canvas = await captureFrameCanvas();

            if (useBarcodeDetector && barcodeDetector) {
                try {
                    const codes = await barcodeDetector.detect(canvas);
                    if (codes && codes.length && codes[0].rawValue) {
                        handleScanSuccess(codes[0].rawValue);
                        return;
                    }
                } catch (e) {
                    lastScanError = (e && e.message) ? e.message.slice(0, 60) : String(e).slice(0, 60);
                }
            } else if (zxingCodeReader && zxingCodeReader.decodeFromCanvas) {
                try {
                    const result = zxingCodeReader.decodeFromCanvas(canvas);
                    if (result && result.text) {
                        handleScanSuccess(result.text);
                        return;
                    }
                } catch (e) {
                    // NotFoundException es normal cuando todavía no encontró nada: no lo mostramos como error
                    if (!e || !/not found/i.test(e.message || '')) {
                        lastScanError = (e && e.message) ? e.message.slice(0, 60) : String(e).slice(0, 60);
                    }
                }
            }

            updateScanEngineStatus();
            // takePhoto() ya tarda un poco por sí solo (enfoque + captura real), así que no
            // hace falta forzar más demora entre intentos cuando se usa ImageCapture.
            if (scanLoopActive) setTimeout(tick, imageCaptureInstance ? 30 : 100);
        }

        tick();
    }



    async function pickBackCameraId() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoInputs = devices.filter(d => d.kind === 'videoinput');
            for (const v of videoInputs) {
                const lbl = (v.label || '').toLowerCase();
                if (lbl.includes('back') || lbl.includes('rear') || lbl.includes('environment')) return v.deviceId;
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

    stopScannerBtn.addEventListener('click', () => stopScanner());

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

        // MODIFICACIÓN: Autocompletado de Ubicación
        if (skuInput) skuInput.addEventListener('input', () => {
            updateDescription(skuInput, descriptionSpan);

            // Solo aplicar la lógica de ubicación si existe el campo y no estamos en el formulario de movimientos
            if (locationInput && dataKeyName !== 'movimientosData') {
                const sku = skuInput.value.trim();
                const productInfo = getCatalogEntry(sku);
                
                // Determina la nueva ubicación (o cadena vacía si no se encuentra SKU/ubicación)
                const nuevaUbicacion = (productInfo && productInfo.ubicacion) ? productInfo.ubicacion : '';
                
                // FUERZA la actualización del campo de Ubicación con el nuevo valor.
                if (locationInput.value.trim() !== nuevaUbicacion) {
                    locationInput.value = nuevaUbicacion;
                }
            }
        });
        // FIN MODIFICACIÓN

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

            // obtener el array de datos
            const dataArray = (dataKeyName === 'pickingData') ? pickingData : (dataKeyName === 'almacenData') ? almacenData : movimientosData;

            // MODIFICACIÓN: Alerta de Ubicación Diferente
            if (dataKeyName !== 'movimientosData' && location) {
                // Buscar si el SKU ya existe con una ubicación DIFERENTE a la actual (y que la ubicación existente no esté vacía)
                const existingEntryWithDifferentLocation = dataArray.find(it => 
                    it.sku === sku && 
                    it.ubicacion && // Asegura que el registro existente tenga una ubicación
                    it.ubicacion !== location // Comprueba que la ubicación sea diferente a la que se está ingresando
                );

                if (existingEntryWithDifferentLocation) {
                    const warningMessage = `ADVERTENCIA: El SKU ${sku} ya está registrado en la ubicación ${existingEntryWithDifferentLocation.ubicacion}. ¿Estás seguro de que querés registrarlo también en ${location}?`;
                    const ok = await showDialog(warningMessage, [{
                        label: 'No',
                        value: false
                    }, {
                        label: 'Si, continuar',
                        value: true
                    }]);
                    if (!ok) return; // Detiene el envío
                }
            }
            // FIN MODIFICACIÓN

            // buscar duplicado por sku+ubicacion (Lógica existente para acumular cantidad)
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
    movLooseInput.addEventListener('input', updateMovTotal); // Corregido: Llamar a updateTotal

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
        
        movimientoSKU.value = '';     // Resetear SKU
        movBoxesInput.value = '';     // Resetear Cajas
        movPerBoxInput.value = '';    // Resetear Unidades por Caja
        movLooseInput.value = '';     // Resetear Sueltos
        updateMovTotal();             // Actualizar el total a 0
    });

    // Carga catálogo 
    document.getElementById('load-file-btn').addEventListener('click', async () => {
        await loadCatalogFromGitHub();
    });

    document.getElementById('load-location-btn').addEventListener('click', async () => {
        await loadLocationCatalogFromGitHub();
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
            else if (dataKey === 'guardadoData') await guardadoRef.remove();
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
            } else if (dataKey === 'guardadoData') {
                guardadoData = [];
                localStorage.removeItem('guardadoData');
            }
            renderData();
        }
    }
    document.getElementById('clear-picking-btn').addEventListener('click', () => clearData('pickingData', 'Borrar Picking?'));
    document.getElementById('clear-almacen-btn').addEventListener('click', () => clearData('almacenData', 'Borrar Almacén?'));
    document.getElementById('clear-movimientos-btn').addEventListener('click', () => clearData('movimientosData', 'Borrar Movimientos?'));
    document.getElementById('clear-guardado-btn').addEventListener('click', () => clearData('guardadoData', 'Borrar Guardado?'));

    // NUEVA FUNCIÓN: Genera el timestamp DDMMAA_HHMMSS para el nombre de archivo
    function generateTimestampFilename() {
        const now = new Date();
        const year = String(now.getFullYear()).slice(-2);
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${day}${month}${year}_${hours}${minutes}${seconds}`;
    }

    // FUNCIÓN: Agrega la bandera de revisión por multi-ubicación Y el campo 'txt' para Picking/Almacén
    function addReviewFlagToData(data) {
        // 1. Agrupa los datos por SKU y recolecta todas las ubicaciones únicas.
        const skuLocationMap = {};
        data.forEach(item => {
            const sku = item.sku;
            const ubicacion = item.ubicacion;
            if (!skuLocationMap[sku]) {
                skuLocationMap[sku] = new Set();
            }
            // Solo cuenta las ubicaciones si NO están vacías
            if (ubicacion && String(ubicacion).trim() !== '') {
                skuLocationMap[sku].add(ubicacion);
            }
        });

        // 2. Identifica los SKUs que tienen más de una ubicación única.
        const skusToReview = new Set();
        for (const sku in skuLocationMap) {
            if (skuLocationMap[sku].size > 1) {
                skusToReview.add(sku);
            }
        }

        // 3. Mapea los datos originales y añade la bandera y el campo 'txt'.
        return data.map(item => {
            const reviewFlag = skusToReview.has(item.sku) ? 'REVISAR MULTI-UBICACION' : 'OK';
            return {
                ...item,
                reviewNeeded: reviewFlag,
                // CAMPO TXT: SKU,CANTIDAD
                txt: `${item.sku},${item.cantidad}`
            };
        });
    }

    // FUNCIÓN: Agrega el campo 'txt' para Movimientos para la exportación (solo SKU,CANTIDAD)
    function addTxtToMovements(data) {
        return data.map(item => {
            return {
                ...item,
                // TXT con formato SKU,CANTIDAD
                txt: `${item.sku},${item.cantidad}`
            };
        });
    }


    // Export helpers
    function exportToCsv(filename, data, columns) {
        const csvRows = [];
        const bom = '\uFEFF';
        csvRows.push(columns.map(c => `"${c.title}"`).join(';'));
        data.forEach(item => {
            csvRows.push(columns.map(col => {
                const value = item[col.key] != null ? String(item[col.key]) : '';
                return `"${value.replace(/"/g,'""')}"`;
            }).join(';'));
        });
        const blob = new Blob([bom + csvRows.join('\n')], {
            type: 'text/csv;charset=utf-8;'
        });
        const link = document.createElement('a');

        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
    
    // MODIFICADA: Ahora usa SKU,CANTIDAD para el campo TXT en la tabla
    function aggregateMovements(data) {
        const aggregated = {};
        data.forEach(item => {
            // Se usa el origen, destino y sku para la clave de agregación
            const key = `${item.sku}-${item.origen}-${item.destino}`;
            if (aggregated[key]) {
                aggregated[key].cantidad += item.cantidad;
            } else {
                aggregated[key] = { ...item, _key: [item._key] };
            }
        });
        // Se añade el campo 'txt' al final para la vista en tabla
        return Object.values(aggregated).map(item => ({
            ...item,
            // MODIFICACIÓN: TXT solo con SKU,CANTIDAD para la vista de tabla
            txt: `${item.sku},${item.cantidad}`
        }));
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
        renderTable('picking-data', [...pickingData].reverse(), pickingCols, 'pickingData');
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
        renderTable('almacen-data', [...almacenData].reverse(), almacenCols, 'almacenData');
        
        // Columnas para renderizar la tabla de Movimientos (incluye TXT)
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
        }, {
            key: 'txt',
            title: 'TXT' // Columna TXT para la tabla de Movimientos agregados
        }];
        const aggregatedMovData = aggregateMovements(movimientosData);
        renderTable('movimientos-data', [...aggregatedMovData].reverse(), movCols, 'movimientosData');

        const guardadoCols = [{
            key: 'fecha',
            title: 'Fecha'
        }, {
            key: 'sku',
            title: 'Código'
        }, {
            key: 'descripcion',
            title: 'Descripción'
        }, {
            key: 'marca',
            title: 'Marca'
        }, {
            key: 'ubicacion',
            title: 'Ubicación'
        }];
        renderTable('guardado-data', [...guardadoData].reverse(), guardadoCols, 'guardadoData');
    }
    
    // EXPORTACIÓN PICKING MODIFICADA (Añade TXT Y TIMESTAMP en nombre)
    document.getElementById('export-picking-btn').addEventListener('click', () => {
        // 1. Calcular la bandera de revisión y el campo TXT (SKU,CANTIDAD)
        const dataForExport = addReviewFlagToData(pickingData);
        // 2. Definir las columnas incluyendo la nueva 'Revisión Ubicación' y 'TXT'
        const pickingCols = [
            { key: 'fecha', title: 'Fecha' }, 
            { key: 'sku', title: 'SKU' }, 
            { key: 'ubicacion', title: 'Ubicación' }, 
            { key: 'cantidad', title: 'Cantidad' }, 
            { key: 'reviewNeeded', title: 'Revisión Ubicación' }, 
            { key: 'txt', title: 'TXT' } // Columna TXT
        ];
        // 3. Exportar con el nuevo nombre de archivo
        exportToCsv(`picking-data-${generateTimestampFilename()}.csv`, dataForExport, pickingCols); 
    });
    
    // EXPORTACIÓN ALMACÉN MODIFICADA (Añade TXT Y TIMESTAMP en nombre)
    document.getElementById('export-almacen-btn').addEventListener('click', () => {
        // 1. Calcular la bandera de revisión y el campo TXT (SKU,CANTIDAD)
        const dataForExport = addReviewFlagToData(almacenData);
        // 2. Definir las columnas incluyendo la nueva 'Revisión Ubicación' y 'TXT'
        const almacenCols = [
            { key: 'fecha', title: 'Fecha' }, 
            { key: 'sku', title: 'SKU' }, 
            { key: 'ubicacion', title: 'Ubicación' }, 
            { key: 'cantidad', title: 'Cantidad' }, 
            { key: 'reviewNeeded', title: 'Revisión Ubicación' }, 
            { key: 'txt', title: 'TXT' } // Columna TXT
        ];
        // 3. Exportar con el nuevo nombre de archivo
        exportToCsv(`almacen-data-${generateTimestampFilename()}.csv`, dataForExport, almacenCols);
    });

    // EXPORTACIÓN MOVIMIENTOS MODIFICADA (Añade TXT y TIMESTAMP en nombre)
    document.getElementById('export-movimientos-btn').addEventListener('click', () => {
        // 1. Agregar el campo 'txt' con formato SKU,CANTIDAD
        const dataForExport = addTxtToMovements(movimientosData);
        // 2. Definir las columnas incluyendo la nueva 'TXT'
        const movColsWithTxt = [
            { key: 'fecha', title: 'Fecha' }, 
            { key: 'origen', title: 'Origen' }, 
            { key: 'destino', title: 'Destino' }, 
            { key: 'sku', title: 'SKU' }, 
            { key: 'cantidad', title: 'Cantidad' }, 
            { key: 'txt', title: 'TXT' } // Columna TXT
        ];
        // 3. Exportar con el nuevo nombre de archivo
        exportToCsv(`movimientos-data-${generateTimestampFilename()}.csv`, dataForExport, movColsWithTxt);
    });


    // ================== GUARDADO (mercadería recibida) ==================

    function setMarcaFijada(marca) {
        guardadoMarcaFijada = marca || null;
        if (guardadoMarcaFijada) {
            guardadoMarcaActual.textContent = guardadoMarcaFijada;
            guardadoMarcaBanner.style.display = 'flex';
        } else {
            guardadoMarcaBanner.style.display = 'none';
        }
    }

    guardadoMarcaQuitarBtn.addEventListener('click', () => setMarcaFijada(null));

    // Busca la(s) fila(s) del archivo de ubicaciones que corresponden a un código escaneado.
    // Devuelve { tipo: 'vaxel'|'fabrica'|'no-encontrado', entries: [...] }
    function resolveLocationEntries(codeRaw) {
        const code = normalizeSku(codeRaw);

        // 1. Código Vaxel (codigoarticulo) - único, prioridad absoluta
        const porArticulo = locationByArticleCode[code];
        if (porArticulo) {
            return { tipo: 'vaxel', entries: [porArticulo] };
        }

        // 2. Código de fábrica - puede repetirse entre marcas
        const porFabrica = locationByFabricaCode[code];
        if (porFabrica && porFabrica.length) {
            return { tipo: 'fabrica', entries: porFabrica };
        }

        return { tipo: 'no-encontrado', entries: [] };
    }

    // Guarda una entrada de Guardado (código + ubicación colocada), igual que las otras ventanas
    async function saveGuardadoEntry(sku, descripcion, ubicacion, marca) {
        const fecha = new Date().toLocaleString();
        const payload = {
            fecha,
            sku,
            descripcion: descripcion || '',
            marca: marca || '',
            ubicacion
        };
        if (firebaseEnabled) {
            await guardadoRef.push(payload);
        } else {
            guardadoData.push({
                ...payload,
                _key: 'local-' + Date.now() + Math.random().toString(36).slice(2, 8)
            });
            saveToLocalStorage('guardadoData', guardadoData);
            renderData();
        }
    }

    // Cartel final: muestra descripción + ubicación (ya resuelta) y permite escribirla si falta.
    function showGuardadoResultCard(sku, descripcion, marca, ubicacionEncontrada) {
        const overlay = document.createElement('div');
        overlay.className = 'custom-dialog-overlay';
        const box = document.createElement('div');
        box.className = 'custom-dialog-box guardado-card';

        const title = document.createElement('h3');
        title.className = 'guardado-card-sku';
        title.textContent = sku;
        box.appendChild(title);

        const desc = document.createElement('p');
        desc.className = 'custom-dialog-message';
        desc.textContent = descripcion || 'Descripción no encontrada en el catálogo';
        box.appendChild(desc);

        if (marca) {
            const marcaP = document.createElement('p');
            marcaP.className = 'guardado-card-marca';
            marcaP.innerHTML = '<span class="material-icons">local_offer</span> Marca: <strong></strong>';
            marcaP.querySelector('strong').textContent = marca;
            box.appendChild(marcaP);
        }

        const locWrap = document.createElement('div');
        locWrap.className = 'guardado-card-location';

        let locationInputEl = null;
        let saveBtn = null;

        if (ubicacionEncontrada) {
            const locP = document.createElement('p');
            locP.className = 'guardado-card-location-found';
            locP.innerHTML = '<span class="material-icons">place</span> Ubicación: <strong></strong>';
            locP.querySelector('strong').textContent = ubicacionEncontrada;
            locWrap.appendChild(locP);
        } else {
            const locP = document.createElement('p');
            locP.className = 'guardado-card-location-missing';
            locP.innerHTML = '<span class="material-icons">warning_amber</span> No tiene ubicación';
            locWrap.appendChild(locP);

            locationInputEl = document.createElement('input');
            locationInputEl.type = 'text';
            locationInputEl.className = 'guardado-card-location-input';
            locationInputEl.placeholder = 'Escribir ubicación';
            locWrap.appendChild(locationInputEl);
        }
        box.appendChild(locWrap);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'custom-dialog-buttons';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'custom-dialog-button secondary';
        closeBtn.textContent = 'Cerrar';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
            guardadoForm.reset();
        });
        buttonsDiv.appendChild(closeBtn);

        if (!ubicacionEncontrada) {
            saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'custom-dialog-button primary';
            saveBtn.textContent = 'Guardar';
            saveBtn.addEventListener('click', async () => {
                const finalLocation = locationInputEl.value.trim();
                if (!finalLocation) {
                    await showDialog('Debe escribir una ubicación para guardar.');
                    return;
                }
                await saveGuardadoEntry(sku, descripcion, finalLocation, marca);
                document.body.removeChild(overlay);
                guardadoForm.reset();
            });
            buttonsDiv.appendChild(saveBtn);
        }

        box.appendChild(buttonsDiv);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        if (locationInputEl) locationInputEl.focus();

        // Si ya había ubicación (código Vaxel directo, o fábrica ya resuelto), se guarda automáticamente
        if (ubicacionEncontrada) {
            saveGuardadoEntry(sku, descripcion, ubicacionEncontrada, marca);
        }
    }

    // Diálogo para elegir la marca cuando un código de fábrica es ambiguo (varias marcas posibles)
    function askMarca(marcas) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-dialog-overlay';
            const box = document.createElement('div');
            box.className = 'custom-dialog-box guardado-card';

            const msg = document.createElement('p');
            msg.className = 'custom-dialog-message';
            msg.textContent = 'Este código de fábrica pertenece a varias marcas. ¿De qué marca es?';
            box.appendChild(msg);

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'custom-dialog-buttons guardado-marca-options';
            marcas.forEach(marca => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'custom-dialog-button secondary';
                btn.textContent = marca;
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(marca);
                });
                buttonsDiv.appendChild(btn);
            });
            box.appendChild(buttonsDiv);

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'custom-dialog-button secondary';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            box.appendChild(cancelBtn);

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    // Diálogo para elegir entre varias filas candidatas (mismo código+marca, distintas ubicaciones, ej. talles)
    function askEntry(entries) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'custom-dialog-overlay';
            const box = document.createElement('div');
            box.className = 'custom-dialog-box guardado-card';

            const msg = document.createElement('p');
            msg.className = 'custom-dialog-message';
            msg.textContent = 'Hay varios artículos con este código. Elegí el correcto:';
            box.appendChild(msg);

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'custom-dialog-buttons guardado-marca-options';
            entries.forEach(entry => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'custom-dialog-button secondary';
                const catEntry = getCatalogEntry(entry.codigoarticulo);
                const descripcion = catEntry ? catEntry.descripcion : '';
                btn.innerHTML = `<strong>${entry.codigoarticulo}</strong><br>${descripcion || ''}<br>${entry.ubicacion || 'Sin ubicación'}`;
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(entry);
                });
                buttonsDiv.appendChild(btn);
            });
            box.appendChild(buttonsDiv);

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'custom-dialog-button secondary';
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            box.appendChild(cancelBtn);

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    // Flujo principal: recibe el código escaneado/ingresado y resuelve descripción + ubicación + marca
    async function handleGuardadoCode(codeRaw) {
        const codeInput = String(codeRaw || '').trim();
        if (!codeInput) return;

        const resultado = resolveLocationEntries(codeInput);

        if (resultado.tipo === 'vaxel') {
            const entry = resultado.entries[0];
            const catEntry = getCatalogEntry(entry.codigoarticulo);
            const descripcion = catEntry ? catEntry.descripcion : '';
            const ubicacion = entry.ubicacion || (catEntry ? catEntry.ubicacion : '');
            showGuardadoResultCard(entry.codigoarticulo, descripcion, entry.marca, ubicacion);
            return;
        }

        if (resultado.tipo === 'fabrica') {
            let entries = resultado.entries;
            const marcasDisponibles = [...new Set(entries.map(e => e.marca).filter(Boolean))];

            let marcaElegida = null;
            if (marcasDisponibles.length <= 1) {
                marcaElegida = marcasDisponibles[0] || null;
            } else if (guardadoMarcaFijada && marcasDisponibles.includes(guardadoMarcaFijada)) {
                marcaElegida = guardadoMarcaFijada;
            } else {
                marcaElegida = await askMarca(marcasDisponibles);
                if (!marcaElegida) return; // canceló
                setMarcaFijada(marcaElegida);
            }

            const entriesDeMarca = marcaElegida ? entries.filter(e => e.marca === marcaElegida) : entries;

            let entryFinal = null;
            if (entriesDeMarca.length === 1) {
                entryFinal = entriesDeMarca[0];
            } else if (entriesDeMarca.length > 1) {
                entryFinal = await askEntry(entriesDeMarca);
                if (!entryFinal) return; // canceló
            }

            if (entryFinal) {
                const catEntry = getCatalogEntry(entryFinal.codigoarticulo);
                const descripcion = catEntry ? catEntry.descripcion : '';
                const ubicacion = entryFinal.ubicacion || (catEntry ? catEntry.ubicacion : '');
                showGuardadoResultCard(entryFinal.codigoarticulo, descripcion, entryFinal.marca, ubicacion);
            }
            return;
        }

        // No encontrado en ningún catálogo: cartel sin ubicación, código tal cual se escaneó
        showGuardadoResultCard(codeInput, '', guardadoMarcaFijada, '');
    }

    // Escaneo: al terminar de escanear un código en la pestaña Guardado, se procesa automáticamente
    guardadoSkuInput.addEventListener('scan-complete', (e) => {
        const code = (e.detail && e.detail.code) ? e.detail.code : guardadoSkuInput.value;
        handleGuardadoCode(code);
    });

    // Ingreso manual (sin cámara): buscar mediante el formulario
    guardadoForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleGuardadoCode(guardadoSkuInput.value);
    });

    // Exportación de Guardado (código y ubicación colocada)
    document.getElementById('export-guardado-btn').addEventListener('click', () => {
        const guardadoCols = [
            { key: 'fecha', title: 'Fecha' },
            { key: 'sku', title: 'Código' },
            { key: 'descripcion', title: 'Descripción' },
            { key: 'marca', title: 'Marca' },
            { key: 'ubicacion', title: 'Ubicación' }
        ];
        exportToCsv(`guardado-data-${generateTimestampFilename()}.csv`, guardadoData, guardadoCols);
    });

    // Inicialización
    // 1. Cargamos el catálogo de productos (descripciones) y el de ubicaciones (Vaxel/fábrica/marca) en paralelo.
    // 2. Luego inicializamos Firebase.
    Promise.all([loadCatalogFromGitHub(), loadLocationCatalogFromGitHub()]).then(() => initFirebase());
});
