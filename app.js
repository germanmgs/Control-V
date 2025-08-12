/* app.js - Versión limpia y compatible con index.html de arriba.
   Usa Firebase Realtime Database (compat) y Anonymous Auth.
*/

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

  // Firebase refs
  let firebaseEnabled = false;
  let dbRootRef = null;
  let picksRef = null;
  let almacenRef = null;
  let movimientosRef = null;
  let catalogRef = null;

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
      catalogRef = dbRootRef.child('catalog');

      firebaseEnabled = true;
      firebaseStatus.textContent = 'Conectado a Firebase (Realtime DB)';
      setupFirebaseListeners();
      try {
        const storageRef = firebase.storage().ref('catalog');
        const list = await storageRef.listAll();
        if (list.items.length > 0) {
          const url = await list.items[0].getDownloadURL();
          const resp = await fetch(url);
          const blob = await resp.blob();
          const ext = list.items[0].name.split('.').pop().toLowerCase();
          let jsonData;
          if (ext === 'xlsx') {
            const data = await blob.arrayBuffer();
            const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
            const first = wb.SheetNames[0];
            jsonData = XLSX.utils.sheet_to_json(wb.Sheets[first]);
          } else if (ext === 'csv') {
            const text = await blob.text();
            const parsed = Papa.parse(text, { header: true });
            jsonData = parsed.data;
          }
          const newCatalog = {};
          if (jsonData && jsonData.length > 0) {
            const keys = Object.keys(jsonData[0]);
            const skuKey = keys.find(k => k.toLowerCase().includes('sku'));
            const descKey = keys.find(k => k.toLowerCase().includes('descrip') || k.toLowerCase().includes('desc') || k.toLowerCase().includes('nombre'));
            if (skuKey && descKey) {
              jsonData.forEach(row => {
                const sku = row[skuKey];
                const descripcion = row[descKey];
                if (sku) newCatalog[sku] = { descripcion: descripcion || '' };
              });
              productCatalog = newCatalog;
              saveToLocalStorage('productCatalog', productCatalog);
              updateDatalist();
            }
          }
        }
      } catch (err) {
        console.warn('No se pudo cargar catálogo desde Storage:', err);
      }

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

    catalogRef.on('value', snapshot => {
      const val = snapshot.val() || {};
      productCatalog = val;
      saveToLocalStorage('productCatalog', productCatalog);
      updateDatalist();
      renderData();
    });
  }

  // localStorage helpers
  function saveToLocalStorage(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn(e); }
  }
  function loadFromLocalStorage(key, defaultVal) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : defaultVal; } catch (e) { return defaultVal; }
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
      else if (dataKey === 'movimientosData') await movimientosRef.child(key).remove();
    } else {
      if (dataKey === 'pickingData') { pickingData = pickingData.filter(it => it._key !== key); saveToLocalStorage('pickingData', pickingData); }
      else if (dataKey === 'almacenData') { almacenData = almacenData.filter(it => it._key !== key); saveToLocalStorage('almacenData', almacenData); }
      else if (dataKey === 'movimientosData') { movimientosData = movimientosData.filter(it => it._key !== key); saveToLocalStorage('movimientosData', movimientosData); }
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

  // Escáner (BarcodeDetector o ZXing)
  let videoStream = null;
  let videoElem = null;
  let barcodeDetector = null;
  let useBarcodeDetector = false;
  let zxingCodeReader = null;
  const desiredFormats = ['code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','codabar','code_93'];

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
    if (videoElem && !videoElem.paused) try { videoElem.pause(); } catch(e){}
    if (zxingCodeReader && zxingCodeReader.reset) try{ zxingCodeReader.reset(); }catch(e){}
    if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; }
    scannerModal.classList.remove('open');
    scannerContainer.innerHTML = '';
    videoElem = null;
    barcodeDetector = null;
    useBarcodeDetector = false;
  }

  async function startScanner() {
    ensureVideoElement();
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      videoElem.srcObject = videoStream;
      await videoElem.play();
    } catch (err) {
      alert('No se pudo acceder a la cámara: ' + (err.message || err));
      stopScanner(); return;
    }

    if ('BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        useBarcodeDetector = desiredFormats.some(f => supported.includes(f));
        if (useBarcodeDetector) barcodeDetector = new BarcodeDetector({ formats: supported.filter(f => desiredFormats.includes(f)) });
      } catch (e) { useBarcodeDetector = false; barcodeDetector = null; }
    }

    if (useBarcodeDetector && barcodeDetector) {
      let scanning = true;
      async function loop() {
        if (!scanning) return;
        try {
          const codes = await barcodeDetector.detect(videoElem);
          if (codes && codes.length) {
            const code = codes[0].rawValue || '';
            if (code && currentScanInput) { currentScanInput.value = code; currentScanInput.dispatchEvent(new Event('input')); scanning = false; stopScanner(); return; }
          }
        } catch (e) {
          console.warn('BarcodeDetector error', e);
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    } else {
      // ZXing fallback
      if (window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader) || (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader)) {
        const Reader = window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader) || (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader);
        try {
          zxingCodeReader = new Reader();
          const deviceId = await pickBackCameraId();
          await zxingCodeReader.decodeFromVideoDevice(deviceId || null, videoElem, (result, err) => {
            if (result && result.text) {
              if (currentScanInput) {
                currentScanInput.value = result.text;
                currentScanInput.dispatchEvent(new Event('input'));
                try { zxingCodeReader.reset(); } catch(e){}
                stopScanner();
              }
            }
            if (err) {
              // ignorable errors while scanning
            }
          });
        } catch (e) {
          console.warn('ZXing fallback error', e);
        }
      } else {
        alert('No hay método de escaneo disponible en este navegador.');
        stopScanner();
      }
    }
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
    } catch (e) { return null; }
  }

  document.querySelectorAll('.scan-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentScanInput = document.getElementById(btn.dataset.input);
      scannerModal.classList.add('open');
      startScanner();
    });
  });

  stopScannerBtn.addEventListener('click', () => stopScanner());

  function showDialog(message, buttons = [{ label: 'Aceptar', value: true }]) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-dialog-overlay';
      const box = document.createElement('div');
      box.className = 'custom-dialog-box';
      const msg = document.createElement('p');
      msg.textContent = message;
      const buttonsDiv = document.createElement('div');
      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.addEventListener('click', () => { document.body.removeChild(overlay); resolve(b.value); });
        buttonsDiv.appendChild(btn);
      });
      box.appendChild(msg);
      box.appendChild(buttonsDiv);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
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
    boxesInput.addEventListener('input', updateTotal);
    perBoxInput.addEventListener('input', updateTotal);
    looseInput.addEventListener('input', updateTotal);

    skuInput.addEventListener('input', () => updateDescription(skuInput, descriptionSpan));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sku = skuInput.value.trim();
      const location = locationInput ? locationInput.value.trim() : '';
      const cantidad = parseInt(totalDisplay.textContent) || 0;
      const fecha = new Date().toLocaleString();

      if (!sku) { await showDialog('Debe ingresar un SKU'); return; }

      if (!locationRequirementDisabled && dataKeyName !== 'movimientosData' && !location) {
        const ok = await showDialog('ADVERTENCIA: Se subirá el SKU sin ubicación. ¿Continuar?', [{label:'No', value:false},{label:'Si', value:true}]);
        if (!ok) return;
      }

      if (cantidad === 0) {
        const ok2 = await showDialog('La cantidad ingresada es 0 ¿Continuar?', [{label:'No', value:false},{label:'Si', value:true}]);
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
          await movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
        }
      } else {
        // modo local
        if (dataKeyName === 'pickingData') {
          if (itemToUpdate) itemToUpdate.cantidad += cantidad;
          else pickingData.push({ fecha, sku, ubicacion: location, cantidad, _key: 'local-' + Date.now() + Math.random().toString(36).slice(2,8) });
          saveToLocalStorage('pickingData', pickingData);
        } else if (dataKeyName === 'almacenData') {
          if (itemToUpdate) itemToUpdate.cantidad += cantidad;
          else almacenData.push({ fecha, sku, ubicacion: location, cantidad, _key: 'local-' + Date.now() + Math.random().toString(36).slice(2,8) });
          saveToLocalStorage('almacenData', almacenData);
        } else {
          movimientosData.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad, _key: 'local-' + Date.now() + Math.random().toString(36).slice(2,8) });
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

  movimientosForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const sku = movimientoSKU.value.trim();
    const cantidad = parseInt(movimientoCantidad.value) || 0;
    const fecha = new Date().toLocaleString();
    if (!sku || cantidad < 0) { alert('Por favor completa correctamente'); return; }
    if (firebaseEnabled) movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
    else { movimientosData.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad, _key: 'local-' + Date.now() + Math.random().toString(36).slice(2,8) }); saveToLocalStorage('movimientosData', movimientosData); renderData(); }
    movimientosForm.reset();
  });

  // Carga catálogo
  
document.getElementById('load-file-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];
    if (!file) { alert('Por favor seleccioná un archivo'); return; }
    const fname = file.name;
    const ext = fname.split('.').pop().toLowerCase();
    const fr = new FileReader();
    fr.onload = async (e) => {
      let jsonData;
      if (ext === 'xlsx') {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const first = wb.SheetNames[0];
        jsonData = XLSX.utils.sheet_to_json(wb.Sheets[first]);
      } else if (ext === 'csv') {
        const parsed = Papa.parse(e.target.result, { header: true });
        jsonData = parsed.data;
      } else { alert('Formato no soportado'); return; }

      const newCatalog = {};
      if (jsonData.length > 0) {
        const keys = Object.keys(jsonData[0]);
        const skuKey = keys.find(k => k.toLowerCase().includes('sku'));
        const descKey = keys.find(k => k.toLowerCase().includes('descrip') || k.toLowerCase().includes('desc') || k.toLowerCase().includes('nombre'));
        if (!skuKey || !descKey) { alert('Archivo sin columnas SKU/Descripcion'); return; }
        jsonData.forEach(row => {
          const sku = row[skuKey];
          const descripcion = row[descKey];
          if (sku) newCatalog[sku] = { descripcion: descripcion || '' };
        });
      }
      productCatalog = newCatalog;
      saveToLocalStorage('productCatalog', productCatalog);
      updateDatalist();
      if (firebaseEnabled) {
        await catalogRef.set(productCatalog);
        try {
          const storageRef = firebase.storage().ref('catalog/catalog_file.' + ext);
          await storageRef.put(file);
        } catch (err) {
          console.error('Error subiendo archivo a Storage:', err);
        }
      }
      showDialog('Catálogo cargado correctamente', [{label:'OK', value:true}]);
    };
    if (ext === 'xlsx') fr.readAsArrayBuffer(file); else fr.readAsText(file);
  });

    if (ext === 'xlsx') fr.readAsArrayBuffer(file); else fr.readAsText(file);
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
      if (dataKey === 'pickingData') { pickingData = []; localStorage.removeItem('pickingData'); }
      else if (dataKey === 'almacenData') { almacenData = []; localStorage.removeItem('almacenData'); }
      else if (dataKey === 'movimientosData') { movimientosData = []; localStorage.removeItem('movimientosData'); }
      renderData();
    }
  }
  document.getElementById('clear-picking-btn').addEventListener('click', () => clearData('pickingData','Borrar Picking?'));
  document.getElementById('clear-almacen-btn').addEventListener('click', () => clearData('almacenData','Borrar Almacén?'));
  document.getElementById('clear-movimientos-btn').addEventListener('click', () => clearData('movimientosData','Borrar Movimientos?'));

  // Export helpers
  function exportToCsv(filename, data, columns) {
    const csvRows = [];
    const bom = '\uFEFF';
    csvRows.push(columns.map(c => `"${c.title}"`).join(';'));
    data.forEach(item => {
      csvRows.push(columns.map(col => `"${(item[col.key] != null ? String(item[col.key]) : '').replace(/"/g,'""')}"`).join(';'));
    });
    const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  
function aggregateAndExport(dataArray, filenamePrefix) {
    const today = new Date().toISOString().slice(0,10);
    const agg = {};
    dataArray.forEach(item => {
      if (!agg[item.sku]) agg[item.sku] = { SKU: item.sku, CANTIDAD: 0, FECHA: item.fecha || '', UBICACIONES: [] };
      agg[item.sku].CANTIDAD += item.cantidad || 0;
      if (item.ubicacion) {
        if (!agg[item.sku].UBICACIONES.includes(item.ubicacion)) agg[item.sku].UBICACIONES.push(item.ubicacion);
      }
    });
    const out = Object.values(agg).map(it => {
      const ubicacionesStr = it.UBICACIONES.join(' ; ');
      const revisar = (it.UBICACIONES.length > 1) ? 'SI' : 'NO';
      return { SKU: it.SKU, CANTIDAD: it.CANTIDAD, TXT: `${it.SKU},${it.CANTIDAD}`, FECHA: it.FECHA, UBICACIÓN: ubicacionesStr, REVISAR: revisar };
    });
    const cols = [
        {key:'SKU',title:'SKU'},
        {key:'CANTIDAD',title:'CANTIDAD'},
        {key:'TXT',title:'TXT'},
        {key:'FECHA',title:'FECHA'},
        {key:'UBICACIÓN',title:'UBICACIÓN'},
        {key:'REVISAR',title:'REVISAR'}
    ];
    exportToCsv(`${filenamePrefix}_${today}.csv`, out, cols);
  }

  document.getElementById('export-picking-btn').addEventListener('click', () => aggregateAndExport(pickingData, 'Picking'));
  document.getElementById('export-almacen-btn').addEventListener('click', () => aggregateAndExport(almacenData, 'Almacén'));
  document.getElementById('export-movimientos-btn').addEventListener('click', () => {
    const today = new Date().toISOString().slice(0,10);
    const data = movimientosData.map(m => ({...m, TXT: `${m.sku},${m.cantidad}`}));
    const cols = [
        {key:'fecha',title:'FECHA'},
        {key:'origen',title:'ORIGEN'},
        {key:'destino',title:'DESTINO'},
        {key:'sku',title:'SKU'},
        {key:'cantidad',title:'CANTIDAD'},
        {key:'TXT',title:'TXT'}
    ];
    exportToCsv(`Movimientos_${today}.csv`, data, cols);
  });

  function renderData() {
    const pickingCols = [{key:'fecha',title:'Fecha'},{key:'sku',title:'SKU'},{key:'ubicacion',title:'Ubicación'},{key:'cantidad',title:'Cantidad'}];
    renderTable('picking-data', pickingData, pickingCols, 'pickingData');
    const almacenCols = [{key:'fecha',title:'Fecha'},{key:'sku',title:'SKU'},{key:'ubicacion',title:'Ubicación'},{key:'cantidad',title:'Cantidad'}];
    renderTable('almacen-data', almacenData, almacenCols, 'almacenData');
    const movCols = [{key:'fecha',title:'Fecha'},{key:'origen',title:'Origen'},{key:'destino',title:'Destino'},{key:'sku',title:'SKU'},{key:'cantidad',title:'Cantidad'}];
    renderTable('movimientos-data', movimientosData, movCols, 'movimientosData');
  }

  // Init
  initFirebase();
  setTimeout(() => {
    if (!firebaseEnabled && !pickingData.length && !almacenData.length && !movimientosData.length && Object.keys(productCatalog).length === 0) {
      loadFromLocalStorageAll();
      renderData();
    }
  }, 1200);

});
