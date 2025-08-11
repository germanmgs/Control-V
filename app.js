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

  // ... [todo lo demás de tu código original] ...

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

  // CAMBIO: función modificada
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
    const out = Object.values(agg).map(it => ({
      SKU: it.SKU,
      CANTIDAD: it.CANTIDAD,
      TXT: `${it.SKU},${it.CANTIDAD}`,
      FECHA: it.FECHA,
      'UBICACIÓN': it.UBICACIONES.join(' ; '),
      REVISAR: it.UBICACIONES.length > 1 ? 'SI' : 'NO'
    }));
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

  // CAMBIO: exportación de movimientos con TXT
  document.getElementById('export-movimientos-btn').addEventListener('click', () => {
    const today = new Date().toISOString().slice(0,10);
    const out = movimientosData.map(it => ({
      fecha: it.fecha,
      origen: it.origen,
      destino: it.destino,
      sku: it.sku,
      cantidad: it.cantidad,
      TXT: `${it.sku},${it.cantidad}`
    }));
    const cols = [
      {key:'fecha',title:'FECHA'},
      {key:'origen',title:'ORIGEN'},
      {key:'destino',title:'DESTINO'},
      {key:'sku',title:'SKU'},
      {key:'cantidad',title:'CANTIDAD'},
      {key:'TXT',title:'TXT'}
    ];
    exportToCsv(`Movimientos_${today}.csv`, out, cols);
  });

  // ... [resto de tu código original sin cambios] ...
});
