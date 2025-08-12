/* app.js - Versión con mejoras solicitadas */

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

  const skuSuggestionsContainer = document.getElementById('sku-suggestions-container');
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
  let storageRef = null;

  function isFirebaseAvailable() {
    return (typeof firebase !== 'undefined') && firebase?.database && firebaseConfig;
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
      storageRef = firebase.storage().ref();

      firebaseEnabled = true;
      firebaseStatus.textContent = 'Conectado a Firebase';
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
      pickingData = objToArray(snapshot.val());
      saveToLocalStorage('pickingData', pickingData);
      renderData();
    });

    almacenRef.on('value', snapshot => {
      almacenData = objToArray(snapshot.val());
      saveToLocalStorage('almacenData', almacenData);
      renderData();
    });

    movimientosRef.on('value', snapshot => {
      movimientosData = objToArray(snapshot.val());
      saveToLocalStorage('movimientosData', movimientosData);
      renderData();
    });

    catalogRef.on('value', snapshot => {
      productCatalog = snapshot.val() || {};
      saveToLocalStorage('productCatalog', productCatalog);
      updateSuggestions();
      renderData();
    });
  }

  function saveToLocalStorage(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }
  function loadFromLocalStorage(key, defaultVal) {
    try { return JSON.parse(localStorage.getItem(key)) || defaultVal; } catch { return defaultVal; }
  }
  function loadFromLocalStorageAll() {
    pickingData = loadFromLocalStorage('pickingData', []);
    almacenData = loadFromLocalStorage('almacenData', []);
    movimientosData = loadFromLocalStorage('movimientosData', []);
    productCatalog = loadFromLocalStorage('productCatalog', {});
    updateSuggestions();
  }

  // Autocompletado panel negro
  function updateSuggestions() {
    skuSuggestionsContainer.innerHTML = '';
    const input = document.querySelectorAll('#picking-sku, #almacen-sku, #movimiento-sku');
    input.forEach(inp => {
      inp.addEventListener('input', () => {
        const val = inp.value.trim().toLowerCase();
        const list = document.createElement('div');
        list.id = 'sku-suggestions-list';
        if (!val) { skuSuggestionsContainer.innerHTML = ''; return; }
        Object.keys(productCatalog)
          .filter(sku => sku.toLowerCase().includes(val))
          .slice(0, 10)
          .forEach(sku => {
            const opt = document.createElement('div');
            opt.textContent = sku + ' - ' + (productCatalog[sku]?.descripcion || '');
            opt.addEventListener('click', () => {
              inp.value = sku;
              skuSuggestionsContainer.innerHTML = '';
            });
            list.appendChild(opt);
          });
        skuSuggestionsContainer.innerHTML = '';
        if (list.children.length) skuSuggestionsContainer.appendChild(list);
      });
    });
  }

  // Render tablas
  function renderTable(containerId, data, columns, dataKey) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (!data.length) { container.innerHTML = '<p>No hay datos.</p>'; return; }
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
    thActions.textContent = 'Acción';
    headerRow.appendChild(thActions);
    thead.appendChild(headerRow);

    data.forEach(item => {
      const row = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        td.textContent = item[col.key] ?? '';
        row.appendChild(td);
      });
      const tdAct = document.createElement('td');
      const btn = document.createElement('button');
      btn.innerHTML = '<span class="material-icons">delete_forever</span>';
      btn.className = 'delete-btn';
      btn.onclick = () => deleteEntry(dataKey, item._key);
      tdAct.appendChild(btn);
      row.appendChild(tdAct);
      tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
  }

  async function deleteEntry(dataKey, key) {
    if (!confirm('¿Eliminar registro?')) return;
    if (firebaseEnabled) {
      if (dataKey === 'pickingData') await picksRef.child(key).remove();
      else if (dataKey === 'almacenData') await almacenRef.child(key).remove();
      else if (dataKey === 'movimientosData') await movimientosRef.child(key).remove();
    } else {
      if (dataKey === 'pickingData') pickingData = pickingData.filter(it => it._key !== key);
      else if (dataKey === 'almacenData') almacenData = almacenData.filter(it => it._key !== key);
      else movimientosData = movimientosData.filter(it => it._key !== key);
      saveToLocalStorage(dataKey, eval(dataKey));
      renderData();
    }
  }

  // Guardar formulario
  function setupForm(form, dataKeyName) {
    const skuInput = form.querySelector('input[id$="-sku"]');
    const locationInput = form.querySelector('input[id$="-location"]');
    const boxesInput = form.querySelector('input[id$="-boxes"]');
    const perBoxInput = form.querySelector('input[id$="-per-box"]');
    const looseInput = form.querySelector('input[id$="-loose"]');
    const totalDisplay = form.querySelector('strong[id$="-total"]');

    function updateTotal() {
      totalDisplay.textContent =
        (parseInt(boxesInput.value) || 0) * (parseInt(perBoxInput.value) || 0) +
        (parseInt(looseInput.value) || 0);
    }
    boxesInput?.addEventListener('input', updateTotal);
    perBoxInput?.addEventListener('input', updateTotal);
    looseInput?.addEventListener('input', updateTotal);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const sku = skuInput.value.trim();
      const location = locationInput ? locationInput.value.trim() : '';
      const cantidad = parseInt(totalDisplay.textContent) || 0;
      const fecha = new Date().toLocaleString();

      if (!sku) return alert('Debe ingresar un SKU');
      if (!locationRequirementDisabled && dataKeyName !== 'movimientosData' && !location) {
        if (!confirm('ADVERTENCIA: SKU sin ubicación. ¿Continuar?')) return;
      }

      if (cantidad === 0 && !confirm('Cantidad 0. ¿Continuar?')) return;

      if (firebaseEnabled) {
        const ref = dataKeyName === 'pickingData' ? picksRef :
                    dataKeyName === 'almacenData' ? almacenRef : movimientosRef;
        await ref.push({ fecha, sku, ubicacion: location, cantidad, origen: origenSelect?.value, destino: destinoSelect?.value });
      } else {
        const arr = dataKeyName === 'pickingData' ? pickingData :
                    dataKeyName === 'almacenData' ? almacenData : movimientosData;
        arr.push({ fecha, sku, ubicacion: location, cantidad, origen: origenSelect?.value, destino: destinoSelect?.value, _key: 'local-' + Date.now() });
        saveToLocalStorage(dataKeyName, arr);
        renderData();
      }

      form.reset();
      totalDisplay.textContent = '0';
    });
  }

  setupForm(pickingForm, 'pickingData');
  setupForm(almacenForm, 'almacenData');
  movimientosForm.addEventListener('submit', e => {
    e.preventDefault();
    const sku = movimientoSKU.value.trim();
    const cantidad = parseInt(movimientoCantidad.value) || 0;
    const fecha = new Date().toLocaleString();
    if (!sku) return;
    if (firebaseEnabled) movimientosRef.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad });
    else {
      movimientosData.push({ fecha, origen: origenSelect.value, destino: destinoSelect.value, sku, cantidad, _key: 'local-' + Date.now() });
      saveToLocalStorage('movimientosData', movimientosData);
      renderData();
    }
    movimientosForm.reset();
  });

  // Cargar catálogo y guardar en Storage
  document.getElementById('load-file-btn').addEventListener('click', () => {
    const file = document.getElementById('file-input').files[0];
    if (!file) return alert('Seleccione un archivo');
    const ext = file.name.split('.').pop().toLowerCase();
    const fr = new FileReader();
    fr.onload = async e => {
      let jsonData;
      if (ext === 'xlsx') {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        jsonData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      } else if (ext === 'csv') {
        jsonData = Papa.parse(e.target.result, { header: true }).data;
      } else return alert('Formato no soportado');

      const newCatalog = {};
      const keys = Object.keys(jsonData[0] || {});
      const skuKey = keys.find(k => k.toLowerCase().includes('sku'));
      const descKey = keys.find(k => k.toLowerCase().includes('desc'));
      jsonData.forEach(row => {
        if (row[skuKey]) newCatalog[row[skuKey]] = { descripcion: row[descKey] || '' };
      });
      productCatalog = newCatalog;
      saveToLocalStorage('productCatalog', productCatalog);
      if (firebaseEnabled) {
        await catalogRef.set(productCatalog);
        await storageRef.child('catalogo.' + ext).put(file);
      }
      alert('Catálogo cargado y guardado en servidor');
      updateSuggestions();
    };
    if (ext === 'xlsx') fr.readAsArrayBuffer(file); else fr.readAsText(file);
  });

  // Exportaciones
  function exportToCsv(filename, data, columns) {
    const bom = '\uFEFF';
    const rows = [columns.map(c => `"${c.title}"`).join(';')];
    data.forEach(item => {
      rows.push(columns.map(col => `"${(item[col.key] ?? '').toString().replace(/"/g,'""')}"`).join(';'));
    });
    const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  }

  function exportPickingAlmacen(data, prefix) {
    const today = new Date().toISOString().slice(0,10);
    const agg = {};
    data.forEach(item => {
      if (!agg[item.sku]) agg[item.sku] = { SKU: item.sku, CANTIDAD: 0, UBICACION: [], FECHA: item.fecha || '' };
      agg[item.sku].CANTIDAD += item.cantidad || 0;
      if (item.ubicacion && !agg[item.sku].UBICACION.includes(item.ubicacion)) agg[item.sku].UBICACION.push(item.ubicacion);
    });
    const out = Object.values(agg).map(it => ({
      SKU: it.SKU,
      CANTIDAD: it.CANTIDAD,
      TXT: `${it.SKU},${it.CANTIDAD}`,
      FECHA: it.FECHA,
      'UBICACIÓN': it.UBICACION.join(' ; '),
      REVISAR: it.UBICACION.length > 1 ? 'SI' : 'NO'
    }));
    const cols = [
      { key: 'SKU', title: 'SKU' },
      { key: 'CANTIDAD', title: 'CANTIDAD' },
      { key: 'TXT', title: 'TXT' },
      { key: 'FECHA', title: 'FECHA' },
      { key: 'UBICACIÓN', title: 'UBICACIÓN' },
      { key: 'REVISAR', title: 'REVISAR' }
    ];
    exportToCsv(`${prefix}_${today}.csv`, out, cols);
  }

  document.getElementById('export-picking-btn').addEventListener('click', () => exportPickingAlmacen(pickingData, 'Picking'));
  document.getElementById('export-almacen-btn').addEventListener('click', () => exportPickingAlmacen(almacenData, 'Almacén'));

  document.getElementById('export-movimientos-btn').addEventListener('click', () => {
    const today = new Date().toISOString().slice(0,10);
    const cols = [
      { key: 'fecha', title: 'FECHA' },
      { key: 'origen', title: 'ORIGEN' },
      { key: 'destino', title: 'DESTINO' },
      { key: 'sku', title: 'SKU' },
      { key: 'cantidad', title: 'CANTIDAD' },
      { key: 'TXT', title: 'TXT' }
    ];
    const out = movimientosData.map(m => ({
      ...m,
      TXT: `${m.sku},${m.cantidad}`
    }));
    exportToCsv(`Movimientos_${today}.csv`, out, cols);
  });

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

  navButtons.forEach(btn => btn.addEventListener('click', () => {
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tabContents.forEach(c => c.classList.remove('active'));
    document.getElementById(btn.dataset.tab).classList.add('active');
    renderData();
  }));

  menuBtn.addEventListener('click', () => sideMenu.classList.add('open'));
  closeMenuBtn.addEventListener('click', () => sideMenu.classList.remove('open'));

  initFirebase();
});
