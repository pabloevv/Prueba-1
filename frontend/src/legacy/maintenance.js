const PANEL_ID = 'luggoMaintenancePanel';
const STATUS_ID = 'luggoMaintenanceStatus';
const LOCAL_KEYS_TO_KEEP = ['luggo:auth:v2'];
const LOCAL_PREFIXES_TO_KEEP = ['firebase:', 'gapi.', 'auth.'];
const API_BASE = (typeof window !== 'undefined' && window.__API_BASE_URL__) || '/api';

let cleanupRunning = false;

function shouldKeepLocalKey(key) {
  if (!key) return false;
  if (LOCAL_KEYS_TO_KEEP.includes(key)) return true;
  return LOCAL_PREFIXES_TO_KEEP.some(prefix => key.startsWith(prefix));
}

function preserveLocalStorageAuth() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const keep = new Map();
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (shouldKeepLocalKey(key)) {
      keep.set(key, window.localStorage.getItem(key));
    }
  }
  window.localStorage.clear();
  keep.forEach((value, key) => {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn('No se pudo restaurar la clave protegida de localStorage', key, error);
    }
  });
}

function clearSessionStorageSafe() {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.clear();
  } catch (error) {
    console.warn('No se pudo limpiar sessionStorage:', error);
  }
}

function deleteDatabase(name) {
  return new Promise(resolve => {
    try {
      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch (error) {
      console.warn('No se pudo eliminar la base de datos', name, error);
      resolve(false);
    }
  });
}

async function clearIndexedDbPreservingAuth() {
  if (typeof window === 'undefined' || !window.indexedDB || typeof window.indexedDB.databases !== 'function') {
    return;
  }
  try {
    const dbs = await window.indexedDB.databases();
    const deletions = dbs
      .filter(db => db?.name && !/firebase/i.test(db.name) && !/auth/i.test(db.name))
      .map(db => deleteDatabase(db.name));
    await Promise.all(deletions);
  } catch (error) {
    console.warn('No se pudieron consultar las bases de datos de IndexedDB:', error);
  }
}

async function clearCachesPreservingAuth() {
  if (typeof window === 'undefined' || !window.caches || typeof window.caches.keys !== 'function') {
    return;
  }
  try {
    const keys = await window.caches.keys();
    const deletions = keys
      .filter(name => !/firebase/i.test(name) && !/auth/i.test(name))
      .map(name => window.caches.delete(name).catch(() => false));
    await Promise.all(deletions);
  } catch (error) {
    console.warn('No se pudieron limpiar los caches:', error);
  }
}

async function getAuthToken() {
  if (typeof window === 'undefined' || !window.firebase?.auth) {
    throw new Error('Firebase no está disponible.');
  }
  const auth = window.firebase.auth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión para limpiar los datos.');
  }
  return user.getIdToken();
}

async function resetBackendData(seedDefaults = false) {
  const token = await getAuthToken();
  const response = await fetch(`${API_BASE}/admin/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ seedDefaults })
  });
  if (response.status === 404) {
    throw new Error('El servidor no reconoce el endpoint /api/admin/reset. Revisa que el backend esté actualizado y reiniciado.');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      (payload && typeof payload.error === 'string' && payload.error) ||
      'No se pudieron limpiar los datos del servidor.';
    throw new Error(message);
  }
  return payload || { ok: true };
}

function setStatus(message) {
  const statusEl = document.getElementById(STATUS_ID);
  if (statusEl) {
    statusEl.textContent = message || '';
  }
}

async function runCleanup(options = {}) {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    setStatus('Limpiando almacenamiento local...');
    preserveLocalStorageAuth();
    clearSessionStorageSafe();
    await clearIndexedDbPreservingAuth();
    await clearCachesPreservingAuth();

    setStatus('Limpiando datos del servidor...');
    const result = await resetBackendData(Boolean(options.seedDefaults));

    const stats = [];
    const cleared = result?.cleared || {};
    if (typeof cleared.reviews === 'number') stats.push(`${cleared.reviews} resenas`);
    if (typeof cleared.places === 'number') stats.push(`${cleared.places} lugares`);
    if (typeof cleared.images === 'number') stats.push(`${cleared.images} imagenes`);
    if (typeof cleared.votes === 'number') stats.push(`${cleared.votes} votos`);

    const storageInfo = result?.storage || {};
    if (typeof storageInfo.deleted === 'number' && !storageInfo.skipped) {
      stats.push(`${storageInfo.deleted} archivos en Firebase Storage`);
    }

    const summary = stats.length ? `Limpieza completa (${stats.join(', ')}).` : 'Limpieza completa.';
    const storageErrors = Array.isArray(storageInfo.errors) ? storageInfo.errors.filter(Boolean) : [];

    if (storageErrors.length > 0) {
      setStatus(`${summary} No se pudieron eliminar ${storageErrors.length} archivos de Storage.`);
    } else if (storageInfo.skipped) {
      setStatus(`${summary} Storage omitido (${storageInfo.reason || 'no configurado'}). Recargando...`);
      setTimeout(() => window.location.reload(), 1400);
    } else {
      setStatus(`${summary} Recargando...`);
      setTimeout(() => window.location.reload(), 1200);
    }
    return result;
  } catch (error) {
    console.error('No se pudo completar la limpieza:', error);
    setStatus(error?.message || 'Ocurrio un error al limpiar los datos.');
    throw error;
  } finally {
    cleanupRunning = false;
  }
}

function createMaintenancePanel() {
  if (typeof document === 'undefined' || document.getElementById(PANEL_ID)) return;

  const details = document.createElement('details');
  details.id = PANEL_ID;
  details.style.position = 'fixed';
  details.style.bottom = '16px';
  details.style.left = '16px';
  details.style.zIndex = '9999';
  details.style.maxWidth = '280px';
  details.style.background = 'rgba(12, 20, 43, 0.92)';
  details.style.border = '1px solid rgba(255, 255, 255, 0.12)';
  details.style.borderRadius = '12px';
  details.style.padding = '0.5rem 0.8rem';
  details.style.boxShadow = '0 8px 22px rgba(0, 0, 0, 0.45)';
  details.style.fontSize = '0.85rem';
  details.style.color = '#e2e8f0';

  const summary = document.createElement('summary');
  summary.textContent = 'Herramientas de limpieza';
  summary.style.cursor = 'pointer';
  summary.style.fontWeight = '600';
  summary.style.outline = 'none';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.style.marginTop = '0.6rem';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '0.6rem';

  const info = document.createElement('p');
  info.textContent = 'Borra caches locales y datos dinámicos, conserva tu sesión de autenticación.';
  info.style.margin = '0';
  info.style.lineHeight = '1.4';
  body.appendChild(info);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Limpiar datos';
  button.style.background = '#2563eb';
  button.style.color = '#fff';
  button.style.border = 'none';
  button.style.borderRadius = '8px';
  button.style.padding = '0.55rem 0.8rem';
  button.style.fontWeight = '600';
  button.style.cursor = 'pointer';
  button.style.boxShadow = '0 4px 14px rgba(37, 99, 235, 0.35)';
  button.addEventListener('click', async () => {
    if (cleanupRunning) return;
    const confirmed = window.confirm('Se eliminarán los datos guardados (reseñas, lugares, imágenes y caches locales). Tu sesión se mantiene. ¿Deseas continuar?');
    if (!confirmed) return;
    try {
      await runCleanup();
    } catch {
      /* El estado ya se actualizó en runCleanup */
    }
  });
  body.appendChild(button);

  const status = document.createElement('div');
  status.id = STATUS_ID;
  status.style.minHeight = '1.2rem';
  status.style.fontSize = '0.8rem';
  status.style.color = '#facc15';
  status.style.lineHeight = '1.2';
  body.appendChild(status);

  details.appendChild(body);
  document.body.appendChild(details);
}

function initMaintenancePanel() {
  if (typeof window === 'undefined') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createMaintenancePanel, { once: true });
  } else {
    createMaintenancePanel();
  }
}

if (typeof window !== 'undefined') {
  initMaintenancePanel();
  window.luggoMaintenance = {
    runCleanup,
    clearLocalStorage: preserveLocalStorageAuth,
    clearIndexedDb: clearIndexedDbPreservingAuth
  };
}
