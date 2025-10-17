// --- Datos dinamicos ---
let PLACES = [];
let placeById = {};

function normalizePlaceEntry(place) {
  if (!place || !place.id) return null;
  const hasCoords =
    place.coords &&
    typeof place.coords.lat === 'number' &&
    typeof place.coords.lng === 'number';
  return {
    id: place.id,
    name: place.name || 'Lugar',
    address: place.address || '',
    coords: hasCoords ? { lat: place.coords.lat, lng: place.coords.lng } : null,
    photo: place.photo || ''
  };
}

function setPlaces(source) {
  const next = Array.isArray(source) ? source : [];
  PLACES = [];
  placeById = {};
  next.forEach(item => {
    const normalized = normalizePlaceEntry(item);
    if (!normalized) return;
    PLACES.push(normalized);
    placeById[normalized.id] = normalized;
  });
}

function upsertPlace(place) {
  const normalized = normalizePlaceEntry(place);
  if (!normalized) return;
  const existingIndex = PLACES.findIndex(item => item.id === normalized.id);
  if (existingIndex >= 0) {
    PLACES[existingIndex] = { ...PLACES[existingIndex], ...normalized };
    placeById[normalized.id] = PLACES[existingIndex];
  } else {
    PLACES.push(normalized);
    placeById[normalized.id] = normalized;
  }
}

let reviews = [];
let dataLoaded = false;

function normalizeReviewEntry(rawReview, currentUser) {
  if (!rawReview) return null;
  const user = currentUser || getStoredUser();
  const place = rawReview.placeId ? placeById[rawReview.placeId] : null;
  const hasCoords =
    rawReview.coords &&
    typeof rawReview.coords.lat === 'number' &&
    typeof rawReview.coords.lng === 'number';
  const coords = hasCoords
    ? { lat: rawReview.coords.lat, lng: rawReview.coords.lng }
    : place?.coords || null;
  const createdAt =
    typeof rawReview.createdAt === 'number'
      ? rawReview.createdAt
      : Date.parse(rawReview.createdAt) || Date.now();
  const userUid = rawReview.userUid || rawReview.uid || null;
  const belongsToUser = Boolean(
    user &&
      ((userUid && user.uid === userUid) ||
        (rawReview.userId && user.id && String(user.id) === String(rawReview.userId)))
  );
  const resolvedName =
    rawReview.userName && String(rawReview.userName).trim()
      ? String(rawReview.userName).trim()
      : belongsToUser
      ? user?.displayName || user?.email || 'Yo'
      : 'Visitante';

  const images = Array.isArray(rawReview.images)
    ? rawReview.images
        .map(item => (item && item.url ? { ...item } : null))
        .filter(Boolean)
    : [];
  const fallbackPhoto = place?.photo || '';
  const photo =
    rawReview.photo ||
    (images.length ? images[0].url : '') ||
    fallbackPhoto;

  return {
    id: rawReview.id,
    placeId: rawReview.placeId,
    city: rawReview.city || place?.address || '',
    rating: Number(rawReview.rating) || 0,
    photo,
    note: rawReview.note || '',
    tags: Array.isArray(rawReview.tags)
      ? rawReview.tags.map(tag => String(tag).trim()).filter(Boolean)
      : [],
    userId: rawReview.userId ?? null,
    userUid,
    userName: resolvedName,
    me: belongsToUser,
    up: Number(rawReview.up) || 0,
    down: Number(rawReview.down) || 0,
    createdAt,
    coords,
    myVote: Number(rawReview.myVote || 0),
    images
  };
}

function setReviews(source, currentUser) {
  const next = Array.isArray(source) ? source : [];
  reviews = next
    .map(item => normalizeReviewEntry(item, currentUser))
    .filter(Boolean);
}

function refreshReviewOwnership() {
  const currentUser = getStoredUser();
  reviews.forEach(review => {
    const isOwner = Boolean(
      currentUser &&
        ((review.userUid && review.userUid === currentUser.uid) ||
          (review.userId && currentUser.id && String(review.userId) === String(currentUser.id)))
    );
    review.me = isOwner;
    if (isOwner) {
      review.userName =
        currentUser.displayName ||
        currentUser.email ||
        currentUser.username ||
        review.userName;
    }
  });
}

async function getIdToken(forceRefresh = false) {
  if (!firebaseAuth || !firebaseAuth.currentUser) return null;
  if (!forceRefresh && cachedIdToken) {
    return cachedIdToken;
  }
  if (!forceRefresh && pendingIdTokenPromise) {
    return pendingIdTokenPromise;
  }
  const promise = firebaseAuth.currentUser.getIdToken(forceRefresh);
  pendingIdTokenPromise = promise;
  try {
    const token = await promise;
    cachedIdToken = token;
    return token;
  } catch (error) {
    console.error('No se pudo obtener el ID token de Firebase:', error);
    return null;
  } finally {
    pendingIdTokenPromise = null;
  }
}

async function requestJSON(url, options = {}, { auth = true } = {}) {
  const config = { ...options };
  const originalHeaders = config.headers instanceof Headers
    ? new Headers(config.headers)
    : new Headers(config.headers || {});

  if (config.body && !(config.body instanceof FormData) && !originalHeaders.has('Content-Type')) {
    originalHeaders.set('Content-Type', 'application/json');
  }
  originalHeaders.set('Accept', 'application/json');

  async function execute(forceRefreshToken = false) {
    const headers = new Headers(originalHeaders);
    if (auth) {
      const token = await getIdToken(forceRefreshToken);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        headers.delete('Authorization');
      }
    }
    const response = await fetch(url, { ...config, headers });
    return response;
  }

  let response = await execute(false);
  if (auth && response.status === 401 && firebaseAuth?.currentUser) {
    cachedIdToken = null;
    response = await execute(true);
  }

  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch (parseError) {
    console.warn('No se pudo interpretar la respuesta JSON de', url, parseError);
  }

  return { response, payload };
}

async function loadInitialData(force = false) {
  if (dataLoaded && !force) return;
  try {
    const [placesResult, reviewsResult] = await Promise.all([
      requestJSON(`${API_BASE}/places`),
      requestJSON(`${API_BASE}/reviews`)
    ]);

    if (!placesResult.response?.ok) {
      throw new Error(
        placesResult.payload?.error || 'No se pudieron cargar los lugares.'
      );
    }
    if (!reviewsResult.response?.ok) {
      throw new Error(
        reviewsResult.payload?.error || 'No se pudieron cargar las reseñas.'
      );
    }

    setPlaces(placesResult.payload?.places);
    const currentUser = getStoredUser();
    setReviews(reviewsResult.payload?.reviews, currentUser);
    refreshReviewOwnership();
    recomputeRep();
    renderAll();
    dataLoaded = true;
  } catch (error) {
    console.error('Error al cargar datos iniciales', error);
  }
}
// --- Reputación ---
const userRep = new Map();
function recomputeRep() {
  userRep.clear();
  reviews.forEach(review => {
    const key = review.userUid || review.userId;
    if (!key) return;
    const karma = (userRep.get(key) || 0) + (review.up - review.down);
    userRep.set(key, karma);
  });
}
function rankFromKarma(karma) {
  if (karma >= 10) return { label: 'Experto', color: '#fbbf24' };
  if (karma >= 3) return { label: 'Confiable', color: '#34d399' };
  return { label: 'Novato', color: '#94a3b8' };
}

// --- Referencias DOM ---
const screens = document.querySelectorAll('.screen');
const tabs = document.querySelectorAll('.tabs button');
const feedList = document.getElementById('feedList');
const profileList = document.getElementById('profileList');
const searchInput = document.getElementById('searchInput');
const profileStats = document.getElementById('profileStats');
const profileName = document.getElementById('profileName');
const profileHandle = document.getElementById('profileHandle');
const mapContainer = document.getElementById('map');
const mapSearchForm = document.getElementById('mapSearchForm');
const mapSearchInput = document.getElementById('mapSearchInput');
const mapSearchStatus = document.getElementById('mapSearchStatus');
const mapSuggestionsContainer = document.getElementById('mapSearchSuggestions');
const addPlaceSearchForm = document.getElementById('addPlaceSearchForm');
const addPlaceSearchInput = document.getElementById('addPlaceSearchInput');
const addPlaceSuggestionsContainer = document.getElementById('addPlaceSuggestions');
const addPlaceStatus = document.getElementById('addPlaceStatus');
const modalMapContainer = document.getElementById('addPlaceMap');
const placeNameInput = document.getElementById('f_placeName');
const placeAddressInput = document.getElementById('f_placeAddress');
const ratingInput = document.getElementById('f_rating');
const photoInput = document.getElementById('f_photo');
const noteInput = document.getElementById('f_note');
const tagsInput = document.getElementById('f_tags');
const photoFileInput = document.getElementById('f_photo_file');
const photoPreview = document.getElementById('photoPreview');
const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const loginEmailInput = document.getElementById('loginEmail');
const loginPasswordInput = document.getElementById('loginPassword');
const loginGoogleButton = document.getElementById('loginGoogle');

const AUTH_STORAGE_KEY = 'luggo:auth:v2';
const API_BASE = window.__API_BASE_URL__ || '/api';
const MAX_PHOTO_DIMENSION = 720;
const FIREBASE_CONFIG = window.__FIREBASE_CONFIG__ || null;
const FIREBASE_STORAGE_ROOT = 'luggo';

let firebaseApp = null;
let firebaseAuth = null;
let firebaseStorage = null;
let authReady = false;
let cachedIdToken = null;
let pendingIdTokenPromise = null;

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl, maxDimension = MAX_PHOTO_DIMENSION) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return Promise.resolve(dataUrl);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const { width, height } = image;
      if (!width || !height) {
        resolve(dataUrl);
        return;
      }

      const largestSide = Math.max(width, height);
      if (largestSide <= maxDimension) {
        resolve(dataUrl);
        return;
      }

      const scale = maxDimension / largestSide;
      const targetWidth = Math.round(width * scale);
      const targetHeight = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      try {
        const optimised = canvas.toDataURL('image/jpeg', 0.82);
        resolve(optimised);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
    image.src = dataUrl;
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
    };
    image.onerror = () => reject(new Error('No se pudieron obtener las dimensiones de la imagen.'));
    image.src = dataUrl;
  });
}

async function ensureOptimisedPhoto(photo) {
  if (!photo || typeof photo !== 'string') return null;
  const trimmed = photo.trim();
  if (!trimmed) return null;
  try {
    return await resizeImageDataUrl(trimmed);
  } catch (error) {
    console.warn('No se pudo optimizar la imagen en el cliente:', error);
    return trimmed;
  }
}

// --- Utilidades ---
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(value) {
  return escapeHTML(value);
}
function formatAgo(timestamp) {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'hace un momento';
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}
function stars(count) {
  return '★'.repeat(count) + '☆'.repeat(5 - count);
}
function autoPhotoFor(query) {
  return `https://source.unsplash.com/600x400/?${encodeURIComponent(query)}`;
}
function placeholderPhoto(name) {
  const safe = escapeHTML(name || 'Lugar');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect fill="#1f2937" width="640" height="360"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Roboto, sans-serif" font-size="36" fill="#e5e7eb">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'lugar';
}
function uniquePlaceId(baseText) {
  const base = slugify(baseText || `lugar-${Date.now()}`);
  if (!placeById[base]) return base;
  let i = 1;
  while (placeById[`${base}-${i}`]) i += 1;
  return `${base}-${i}`;
}
function getPlaceName(id) {
  return placeById[id]?.name || 'Lugar';
}
function getPlaceAddress(id) {
  return placeById[id]?.address || '';
}
function getPlacePhoto(id) {
  const place = placeById[id];
  if (!place) return '';
  if (!place.photo) {
    place.photo = autoPhotoFor(place.name || place.address || place.id);
  }
  return place.photo;
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}
function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
function updatePhotoPreview(src, alt = 'Vista previa') {
  if (!photoPreview) return;
  if (src) {
    photoPreview.innerHTML = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />`;
  } else {
    photoPreview.innerHTML = '<div class="placeholder">Selecciona un lugar o carga una imagen para ver la vista previa.</div>';
  }
}

updatePhotoPreview(null);

// --- Autenticaci�n ---
function getStoredUser() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredUser(user) {
  if (user) {
    const payload = {
      uid: user.uid,
      id: user.id ?? null,
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || null,
      role: user.role || 'usr',
      stats: user.stats || { reviews: 0 }
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    updateProfileFromAuth(payload);
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    updateProfileFromAuth(null);
  }
}

function setLoginError(message) {
  if (!loginStatus) return;
  loginStatus.textContent = message || '';
}

function setLoginPending(pending) {
  if (loginForm) {
    loginForm.classList.toggle('pending', pending);
  }
  [loginEmailInput, loginPasswordInput, loginGoogleButton].forEach(input => {
    if (!input) return;
    input.disabled = pending;
  });
}

function hideLogin() {
  if (loginOverlay) {
    loginOverlay.classList.add('hidden');
  }
}

function showLogin() {
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
  }
}

function updateProfileFromAuth(user) {
  if (!profileName || !profileHandle) return;
  if (!user) {
    profileName.textContent = 'Visitante';
    profileHandle.textContent = '';
    return;
  }
  profileName.textContent = user.displayName || user.email || 'Visitante';
  const handle = user.email
    ? user.email
    : user.uid
    ? `@${String(user.uid).slice(0, 8)}`
    : '';
  profileHandle.textContent = handle;
  if (profileStats && user.stats?.reviews !== undefined) {
    const karmaKey = user.uid || user.id;
    const karma = karmaKey ? userRep.get(karmaKey) || 0 : 0;
    const rank = rankFromKarma(karma);
    profileStats.textContent = `${user.stats.reviews} reseñas - Rango: ${rank.label} (${karma})`;
  }
}

function mapFirebaseError(error) {
  const code = error?.code || '';
  switch (code) {
    case 'auth/wrong-password':
      return 'Contraseña incorrecta.';
    case 'auth/user-not-found':
      return 'No encontramos tu cuenta. La crearemos si completas los datos.';
    case 'auth/invalid-email':
      return 'El correo no es válido.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con este correo.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/popup-closed-by-user':
      return 'Cierra la ventana solo después de completar el inicio de sesión.';
    default:
      return error?.message || 'No se pudo iniciar sesión.';
  }
}

async function ensureBackendSession() {
  try {
    const { response, payload } = await requestJSON(
      `${API_BASE}/auth/session`,
      { method: 'POST' }
    );
    if (response.ok && payload?.user) {
      setStoredUser(payload.user);
      refreshReviewOwnership();
      recomputeRep();
      renderAll();
    }
  } catch (error) {
    console.error('No se pudo sincronizar la sesión con el backend:', error);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (!firebaseAuth) {
    setLoginError('Firebase no está configurado.');
    return;
  }
  if (!loginEmailInput || !loginPasswordInput) return;

  const email = loginEmailInput.value.trim().toLowerCase();
  const password = loginPasswordInput.value;

  if (!email || !password) {
    setLoginError('Completa correo y contraseña.');
    return;
  }

  setLoginPending(true);
  setLoginError('');

  try {
    await firebaseAuth.signInWithEmailAndPassword(email, password);
    loginPasswordInput.value = '';
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      try {
        await firebaseAuth.createUserWithEmailAndPassword(email, password);
        loginPasswordInput.value = '';
      } catch (createError) {
        console.error('No se pudo crear la cuenta con correo:', createError);
        setLoginError(mapFirebaseError(createError));
      }
    } else {
      console.error('Error al iniciar sesión con correo:', error);
      setLoginError(mapFirebaseError(error));
    }
  } finally {
    setLoginPending(false);
  }
}

async function handleGoogleLogin() {
  if (!firebaseAuth || typeof firebase === 'undefined' || !firebase.auth) {
    setLoginError('Firebase no está configurado.');
    return;
  }
  setLoginPending(true);
  setLoginError('');
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await firebaseAuth.signInWithPopup(provider);
  } catch (error) {
    console.error('No se pudo iniciar sesión con Google:', error);
    setLoginError(mapFirebaseError(error));
  } finally {
    setLoginPending(false);
  }
}

async function logout() {
  try {
    if (firebaseAuth) {
      await firebaseAuth.signOut();
    }
  } catch (error) {
    console.error('No se pudo cerrar sesión:', error);
  } finally {
    cachedIdToken = null;
    setStoredUser(null);
    showLogin();
    refreshReviewOwnership();
    recomputeRep();
    renderAll();
  }
}
window.logout = logout;

async function initFirebase() {
  if (authReady) return;
  if (!FIREBASE_CONFIG) {
    console.warn('No se definió window.__FIREBASE_CONFIG__.');
    authReady = true;
    return;
  }
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK no está disponible.');
    authReady = true;
    return;
  }
  firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
  firebaseAuth = firebase.auth();
  firebaseStorage = firebase.storage();

  firebaseAuth.onIdTokenChanged(() => {
    cachedIdToken = null;
  });

  firebaseAuth.onAuthStateChanged(async user => {
    authReady = true;
    if (!user) {
      setStoredUser(null);
      showLogin();
      refreshReviewOwnership();
      recomputeRep();
      renderAll();
      return;
    }
    hideLogin();
    await ensureBackendSession();
    if (!dataLoaded) {
      await loadInitialData(true).catch(() => {});
    } else {
      refreshReviewOwnership();
      recomputeRep();
      renderAll();
    }
  });
}

function setupAuthUI() {
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }
  if (loginGoogleButton) {
    loginGoogleButton.addEventListener('click', handleGoogleLogin);
  }

  const storedUser = getStoredUser();
  if (storedUser) {
    updateProfileFromAuth(storedUser);
    hideLogin();
  } else {
    showLogin();
  }

  initFirebase().catch(error => {
    console.error('No se pudo inicializar Firebase:', error);
    setLoginError('Revisa la configuración de Firebase.');
  });
}

// --- Votaciones ---
const voteLocks = new Set();
async function vote(reviewId, delta) {
  const key = String(reviewId);
  if (voteLocks.has(key)) return;
  const review = reviews.find(item => String(item.id) === key);
  if (!review) return;

  if (!firebaseAuth?.currentUser) {
    showLogin();
    return;
  }

  const previousVote = Number(review.myVote || 0);
  let nextVote = delta;

  if (previousVote === delta) {
    nextVote = 0;
  }

  voteLocks.add(key);
  try {
    const { response, payload } = await requestJSON(
      `${API_BASE}/reviews/${reviewId}/vote`,
      {
        method: 'POST',
        body: JSON.stringify({ value: nextVote })
      }
    );

    if (!response.ok) {
      voteLocks.delete(key);
      console.error('No se pudo registrar el voto', payload?.error);
      return;
    }

    review.up = Number(payload?.up) || review.up;
    review.down = Number(payload?.down) || review.down;
    review.myVote = nextVote;
    recomputeRep();
    renderAll();
    voteLocks.delete(key);
  } catch (error) {
    voteLocks.delete(key);
    console.error('Error al registrar voto', error);
  }
}
window.vote = vote;

// --- Filtros y tarjetas ---
function applyFilter(list) {
  const query = (searchInput?.value || '').toLowerCase().trim();
  if (!query) return list;
  return list.filter(item => [
    getPlaceName(item.placeId),
    getPlaceAddress(item.placeId),
    item.city,
    item.note,
    ...item.tags
  ].join(' ').toLowerCase().includes(query));
}

function reviewCardHTML(review) {
  const placeName = getPlaceName(review.placeId);
  const tags = review.tags.map(tag => `<span class="tag">#${escapeHTML(tag)}</span>`).join(' ');
  const mediaUrl = review.photo || getPlacePhoto(review.placeId);
  const placeholder = placeholderPhoto(placeName);
  const imageSrc = mediaUrl || placeholder;
  const safeSrc = escapeAttr(imageSrc);
  const safeAlt = escapeAttr(placeName);
  const fallbackSrc = escapeAttr(placeholder);
  const karma = userRep.get(review.userUid || review.userId) || 0;
  const rank = rankFromKarma(karma);
  const likeActive = review.myVote === 1 ? 'active' : '';
  const dislikeActive = review.myVote === -1 ? 'active' : '';
  return `
    <article class="card">
      <div class="media">
        <img src="${safeSrc}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${fallbackSrc}'" />
      </div>
      <div class="content">
        <div class="row">
          <div>
            <div class="title">${escapeHTML(placeName)}</div>
            <div class="muted">${escapeHTML(review.city || getPlaceAddress(review.placeId))}</div>
          </div>
          <div style="text-align:right">
            <div class="chip" title="Autor">${review.me ? 'Tú' : escapeHTML(review.userName)}</div>
            <div class="rank" style="margin-top:.3rem;border-color:${rank.color};color:${rank.color}" title="Rango por confiabilidad">${rank.label}</div>
          </div>
        </div>
        <div class="sp-1"></div>
        <div class="row">
          <div class="meta"><span class="stars">${stars(review.rating)}</span><span>${review.rating}.0</span></div>
          <div class="muted">${formatAgo(review.createdAt)}</div>
        </div>
        <div class="sp-1"></div>
        <div>${escapeHTML(review.note)}</div>
        <div class="sp-1"></div>
        <div class="row">
          <div>${tags}</div>
          <div class="vote">
            <button class="${likeActive}" data-vote="up" onclick="vote('${escapeAttr(String(review.id))}', 1)" aria-pressed="${review.myVote === 1}" aria-label="Me gusta">
              <span class="icon">👍</span>
              <span class="count">${review.up}</span>
            </button>
            <button class="${dislikeActive}" data-vote="down" onclick="vote('${escapeAttr(String(review.id))}', -1)" aria-pressed="${review.myVote === -1}" aria-label="No me gusta">
              <span class="icon">👎</span>
              <span class="count">${review.down}</span>
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderFeed() {
  const data = applyFilter([...reviews]).sort((a, b) => b.createdAt - a.createdAt);
  if (feedList) feedList.innerHTML = data.map(reviewCardHTML).join('');
}

function renderProfile() {
  const mine = applyFilter(reviews.filter(review => review.me)).sort((a, b) => b.createdAt - a.createdAt);
  if (profileList) profileList.innerHTML = mine.map(reviewCardHTML).join('');
  const myKey = mine[0]?.userUid || mine[0]?.userId || 'self';
  const karma = userRep.get(myKey) || 0;
  const rank = rankFromKarma(karma);
  if (profileStats) profileStats.textContent = `${mine.length} reseñas - Rango: ${rank.label} (${karma})`;
}

function renderAll() {
  renderFeed();
  renderProfile();
  renderMapMarkers();
}

// --- Leaflet global ---
let mapInstance = null;
let mapPlaceLayer = null;
let mapSearchLayer = null;

function invalidateMapView() {
  if (!mapInstance) return;
  requestAnimationFrame(() => mapInstance.invalidateSize());
}

function initMap() {
  if (!mapContainer || typeof L === 'undefined') return;
  if (mapInstance) {
    invalidateMapView();
    return;
  }
  mapInstance = L.map(mapContainer, { zoomControl: false }).setView([9.935, -84.09], 13);
  L.control.zoom({ position: 'topright' }).addTo(mapInstance);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(mapInstance);
  mapPlaceLayer = L.layerGroup().addTo(mapInstance);
  mapSearchLayer = L.layerGroup().addTo(mapInstance);
  renderMapMarkers();
  setTimeout(invalidateMapView, 200);
}

function renderMapMarkers() {
  if (!mapInstance || !mapPlaceLayer) return;
  mapPlaceLayer.clearLayers();
  PLACES.filter(place => place.coords).forEach(place => {
    const marker = L.marker([place.coords.lat, place.coords.lng]);
    const popup = `<strong>${escapeHTML(place.name)}</strong><br>${escapeHTML(place.address || '')}`;
    marker.bindPopup(popup);
    marker.addTo(mapPlaceLayer);
  });
}

let mapStatusTimeout = null;
function updateMapStatus(message) {
  if (!mapSearchStatus) return;
  mapSearchStatus.textContent = message || '';
  if (mapStatusTimeout) clearTimeout(mapStatusTimeout);
  if (message) {
    mapStatusTimeout = setTimeout(() => {
      mapSearchStatus.textContent = '';
    }, 5000);
  }
}

async function nominatimSearch(query, limit = 5) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    dedupe: '1',
    limit: String(limit)
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'Accept-Language': 'es' },
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error('No se pudo buscar');
  return response.json();
}

async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    zoom: '16'
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: { 'Accept-Language': 'es' },
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) return null;
  return response.json();
}

let userLocation = null;
function initUserLocation() {
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    position => {
      userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      if (mapInstance) mapInstance.flyTo([userLocation.lat, userLocation.lng], 14, { duration: 0.8 });
      if (modalMap) modalMap.setView([userLocation.lat, userLocation.lng], 14);
    },
    error => {
      console.warn('No se pudo obtener la ubicación del usuario', error);
    },
    { enableHighAccuracy: true, maximumAge: 60000, timeout: 7000 }
  );
}

function enrichSuggestion(raw, query) {
  const lat = parseFloat(raw.lat);
  const lon = parseFloat(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const title = raw.title || raw.namedetails?.name || raw.name || raw.display_name?.split(',')[0] || query;
  const subtitle = raw.subtitle || raw.address?.city || raw.address?.town || raw.address?.village || raw.address?.state || raw.display_name || '';
  const distance = userLocation ? distanceKm(userLocation.lat, userLocation.lng, lat, lon) : null;
  return {
    title,
    subtitle,
    displayName: raw.display_name || `${title}${subtitle ? `, ${subtitle}` : ''}`,
    lat,
    lon,
    distance,
    photo: raw.photo || autoPhotoFor(title || subtitle || query)
  };
}

function buildLocalSuggestions(query) {
  const normalized = query.toLowerCase();
  return PLACES
    .filter(place => place.name.toLowerCase().startsWith(normalized) || place.address.toLowerCase().startsWith(normalized))
    .map(place => enrichSuggestion({
      title: place.name,
      subtitle: place.address,
      display_name: `${place.name}, ${place.address}`,
      lat: place.coords?.lat,
      lon: place.coords?.lng,
      photo: place.photo
    }, query))
    .filter(Boolean);
}

async function buildSuggestions(query) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const normalized = trimmed.toLowerCase();
  const local = buildLocalSuggestions(trimmed);
  let remote = [];
  try {
    const results = await nominatimSearch(trimmed, 8);
    remote = results
      .map(res => enrichSuggestion(res, trimmed))
      .filter(Boolean)
      .filter(s => s.title.toLowerCase().startsWith(normalized) || s.displayName.toLowerCase().startsWith(normalized));
  } catch (error) {
    console.error('Error buscando sugerencias remotas', error);
  }

  const combined = [...local, ...remote];
  const unique = [];
  const seen = new Set();
  combined.forEach(item => {
    const key = `${item.title.toLowerCase()}|${item.lat?.toFixed(4) || ''}|${item.lon?.toFixed(4) || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  unique.sort((a, b) => {
    if (userLocation && a.distance != null && b.distance != null) {
      return a.distance - b.distance;
    }
    return a.title.localeCompare(b.title, 'es');
  });

  return unique.slice(0, 5);
}

function renderSuggestionList(container, suggestions, onSelect) {
  if (!container) return;
  container.innerHTML = '';
  if (!suggestions.length) return;
  suggestions.forEach(suggestion => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-suggestion-item';
    const distanceLabel = suggestion.distance != null ? formatDistance(suggestion.distance) : '';
    button.innerHTML = `
      <div>
        <strong>${escapeHTML(suggestion.title)}</strong><br>
        <span>${escapeHTML(suggestion.subtitle || '')}</span>
      </div>
      ${distanceLabel ? `<span>${escapeHTML(distanceLabel)}</span>` : ''}
    `;
    button.addEventListener('click', () => onSelect(suggestion));
    container.appendChild(button);
  });
}

function focusMapOnResult(lat, lon, displayName, photoUrl) {
  initMap();
  if (mapSearchLayer) {
    mapSearchLayer.clearLayers();
    const marker = L.marker([lat, lon]);
    marker.bindPopup(`
      <strong>${escapeHTML(displayName)}</strong><br>
      <img src="${escapeAttr(photoUrl)}" alt="${escapeAttr(displayName)}" style="margin-top:8px;border-radius:12px;max-width:220px;height:auto;" loading="lazy" referrerpolicy="no-referrer" />
    `);
    marker.addTo(mapSearchLayer).openPopup();
  }
  mapInstance?.flyTo([lat, lon], 15, { duration: 0.8 });
}

const suggestMapPlaces = debounce(async query => {
  const suggestions = await buildSuggestions(query);
  renderSuggestionList(mapSuggestionsContainer, suggestions, suggestion => {
    mapSearchInput.value = suggestion.title;
    renderSuggestionList(mapSuggestionsContainer, [], () => {});
    focusMapOnResult(suggestion.lat, suggestion.lon, suggestion.displayName, suggestion.photo);
  });
}, 250);

const suggestModalPlaces = debounce(async query => {
  const suggestions = await buildSuggestions(query);
  renderSuggestionList(addPlaceSuggestionsContainer, suggestions, suggestion => {
    addPlaceSearchInput.value = suggestion.title;
    renderSuggestionList(addPlaceSuggestionsContainer, [], () => {});
    ensureModalMap();
    if (modalMarker) {
      modalMarker.setLatLng([suggestion.lat, suggestion.lon]).bindPopup(escapeHTML(suggestion.displayName)).openPopup();
    }
    modalMap?.flyTo([suggestion.lat, suggestion.lon], 16, { duration: 0.6 });
    updateModalSelection({
      name: suggestion.title,
      address: suggestion.subtitle || suggestion.displayName,
      coords: { lat: suggestion.lat, lng: suggestion.lon },
      photo: suggestion.photo
    });
  });
}, 250);

function setupSuggestionInputs() {
  mapSearchInput?.addEventListener('input', () => {
    const value = mapSearchInput.value.trim();
    if (value.length < 2) {
      renderSuggestionList(mapSuggestionsContainer, [], () => {});
      return;
    }
    suggestMapPlaces(value);
  });

  addPlaceSearchInput?.addEventListener('input', () => {
    const value = addPlaceSearchInput.value.trim();
    if (value.length < 2) {
      renderSuggestionList(addPlaceSuggestionsContainer, [], () => {});
      return;
    }
    suggestModalPlaces(value);
  });
}

function setupMapSearch() {
  if (!mapSearchForm) return;
  mapSearchForm.addEventListener('submit', async event => {
    event.preventDefault();
    const query = mapSearchInput?.value.trim();
    if (!query) return;
    updateMapStatus('Buscando lugar...');
    try {
      const results = await buildSuggestions(query);
      if (!results.length) {
        updateMapStatus('No se encontró ningún resultado.');
        return;
      }
      const first = results[0];
      focusMapOnResult(first.lat, first.lon, first.displayName, first.photo);
      updateMapStatus('Marcador agregado desde la búsqueda.');
      renderSuggestionList(mapSuggestionsContainer, [], () => {});
    } catch (error) {
      console.error('Error buscando lugar', error);
      updateMapStatus('Error al buscar el lugar. Intenta nuevamente.');
    }
  });
}

// --- Modal: mapa y selección ---
let modalMap = null;
let modalMarker = null;
let modalSelection = null;

function updateAddPlaceStatus(message) {
  if (addPlaceStatus) addPlaceStatus.textContent = message || '';
}

function ensureModalMap() {
  if (!modalMapContainer || typeof L === 'undefined') return;
  if (modalMap) {
    setTimeout(() => modalMap.invalidateSize(), 200);
    return;
  }
  const start = userLocation ? [userLocation.lat, userLocation.lng] : [9.935, -84.09];
  modalMap = L.map(modalMapContainer, { zoomControl: true, attributionControl: false }).setView(start, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(modalMap);
  modalMarker = L.marker(start).addTo(modalMap);
  modalMarker.bindPopup('Haz clic en el mapa o usa la búsqueda.');
  modalMap.on('click', async event => {
    const { lat, lng } = event.latlng;
    modalMarker.setLatLng(event.latlng);
    const info = await reverseGeocode(lat, lng);
    const name = info?.name || info?.display_name?.split(',')[0] || placeNameInput?.value || 'Lugar sin nombre';
    const address = info?.display_name || placeAddressInput?.value || '';
    updateModalSelection({
      name,
      address,
      coords: { lat, lng },
      photo: autoPhotoFor(name || address || 'lugar')
    });
    modalMarker.bindPopup(escapeHTML(name)).openPopup();
  });
  setTimeout(() => modalMap.invalidateSize(), 200);
}

function updateModalSelection({ name, address, coords, photo }) {
  const previous = modalSelection || {};
  const autoPhoto = photo ?? previous.autoPhoto ?? null;
  const manualPhoto = previous.manualPhoto || '';
  const hasManual = Boolean(manualPhoto);

  modalSelection = {
    ...previous,
    name: name ?? previous.name ?? '',
    address: address ?? previous.address ?? '',
    coords: coords ?? previous.coords ?? null,
    autoPhoto,
    manualPhoto,
    photo: hasManual
      ? manualPhoto
      : previous.uploadBlob
      ? previous.photo
      : autoPhoto || '',
    uploadBlob: hasManual ? null : previous.uploadBlob ?? null,
    uploadMeta: hasManual ? null : previous.uploadMeta ?? null,
    uploadFileName: hasManual ? null : previous.uploadFileName ?? null
  };

  if (photo !== undefined && !hasManual) {
    modalSelection.photo = autoPhoto || '';
    modalSelection.uploadBlob = null;
    modalSelection.uploadMeta = null;
    modalSelection.uploadFileName = null;
  }

  if (placeNameInput && modalSelection.name) placeNameInput.value = modalSelection.name;
  if (placeAddressInput && modalSelection.address) placeAddressInput.value = modalSelection.address;

  if (photoInput && !hasManual) {
    if (modalSelection.photo) {
      photoInput.value = modalSelection.photo;
      photoInput.dataset.auto = 'true';
    } else {
      photoInput.value = '';
      photoInput.dataset.auto = 'false';
    }
  }

  if (!hasManual || !modalSelection.photo) {
    updatePhotoPreview(modalSelection.photo, modalSelection.name || 'Vista previa');
  }

  if (modalSelection.coords) {
    const { lat, lng } = modalSelection.coords;
    updateAddPlaceStatus(`Lugar seleccionado: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }
}

if (photoInput) {
  photoInput.dataset.manual = 'false';
  photoInput.dataset.auto = 'false';
  photoInput.addEventListener('input', () => {
    const value = photoInput.value.trim();
    if (!modalSelection) modalSelection = {};
    if (value) {
      modalSelection.manualPhoto = value;
      modalSelection.photo = value;
      modalSelection.uploadBlob = null;
      modalSelection.uploadMeta = null;
      modalSelection.uploadFileName = null;
      photoInput.dataset.manual = 'true';
      photoInput.dataset.auto = 'false';
      if (photoFileInput) photoFileInput.value = '';
      updatePhotoPreview(value, placeNameInput?.value || 'Imagen personalizada');
    } else {
      modalSelection.manualPhoto = '';
      modalSelection.photo = modalSelection.autoPhoto || '';
      photoInput.dataset.manual = 'false';
      photoInput.dataset.auto = modalSelection.photo ? 'true' : 'false';
      updatePhotoPreview(modalSelection.photo, modalSelection.name || 'Vista previa');
    }
  });
}
if (photoFileInput) {
  photoFileInput.addEventListener('change', async () => {
    const file = photoFileInput.files?.[0];
    if (!file) return;

    updateAddPlaceStatus('Procesando imagen (máx 720p)...');
    try {
      const originalDataUrl = await readFileAsDataURL(file);
      const optimisedDataUrl = await ensureOptimisedPhoto(originalDataUrl);
      if (!modalSelection) modalSelection = {};
      const blob = await dataUrlToBlob(optimisedDataUrl);
      const dimensions = await getImageDimensions(optimisedDataUrl);
      modalSelection.manualPhoto = '';
      modalSelection.autoPhoto = modalSelection.autoPhoto || modalSelection.photo || '';
      modalSelection.photo = optimisedDataUrl;
      modalSelection.uploadBlob = blob;
      modalSelection.uploadMeta = {
        width: dimensions.width,
        height: dimensions.height,
        size: blob.size,
        contentType: blob.type || 'image/webp'
      };
      modalSelection.uploadFileName = `foto-${Date.now()}.webp`;
      photoInput.value = '';
      photoInput.dataset.manual = 'false';
      photoInput.dataset.auto = 'false';
      updatePhotoPreview(optimisedDataUrl, file.name || placeNameInput?.value || 'Imagen local');
      updateAddPlaceStatus('Imagen optimizada lista para subir.');
    } catch (error) {
      console.error('Error al procesar la imagen local:', error);
      updateAddPlaceStatus('No se pudo procesar la imagen. Intenta con otro archivo.');
    }
  });
}

addPlaceSearchForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const query = addPlaceSearchInput?.value.trim();
  if (!query) return;
  updateAddPlaceStatus('Buscando en el mapa...');
  try {
    const suggestions = await buildSuggestions(query);
    if (!suggestions.length) {
      updateAddPlaceStatus('No se encontró ningún resultado.');
      return;
    }
    const best = suggestions[0];
    ensureModalMap();
    modalMarker?.setLatLng([best.lat, best.lon]).bindPopup(escapeHTML(best.displayName)).openPopup();
    modalMap?.flyTo([best.lat, best.lon], 16, { duration: 0.6 });
    updateModalSelection({
      name: best.title,
      address: best.subtitle || best.displayName,
      coords: { lat: best.lat, lng: best.lon },
      photo: best.photo
    });
    renderSuggestionList(addPlaceSuggestionsContainer, [], () => {});
  } catch (error) {
    console.error('Error en búsqueda del modal', error);
    updateAddPlaceStatus('Error al buscar. Intenta nuevamente.');
  }
});

const modal = document.getElementById('modal');

function resetModalFields() {
  if (placeNameInput) placeNameInput.value = '';
  if (placeAddressInput) placeAddressInput.value = '';
  if (ratingInput) ratingInput.value = '5';
  if (photoInput) {
    photoInput.value = '';
    photoInput.dataset.manual = 'false';
    photoInput.dataset.auto = 'false';
  }
  if (photoFileInput) photoFileInput.value = '';
  if (noteInput) noteInput.value = '';
  if (tagsInput) tagsInput.value = '';
  modalSelection = null;
  renderSuggestionList(addPlaceSuggestionsContainer, [], () => {});
  const fallbackCenter = userLocation ? [userLocation.lat, userLocation.lng] : [9.935, -84.09];
  updateAddPlaceStatus('Selecciona una ubicación en el mapa.');
  updatePhotoPreview(null);

  if (modalMarker && modalMap) {
    modalMarker.setLatLng(fallbackCenter).bindPopup('Haz clic en el mapa o usa la búsqueda.');
    modalMap.setView(fallbackCenter, 13);
  }
}

function openCreateModal() {
  modal?.classList.add('show');
  ensureModalMap();
  resetModalFields();
  setTimeout(() => modalMap?.invalidateSize(), 250);
}
function closeCreateModal() {
  modal?.classList.remove('show');
}
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;

async function saveReview() {
  const placeName = (placeNameInput?.value || '').trim();
  const placeAddress = (placeAddressInput?.value || '').trim();
  const rating = Number(ratingInput?.value || 5);
  const manualPhoto = (photoInput?.value || '').trim();
  const note = (noteInput?.value || '').trim();
  const tags = (tagsInput?.value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);

  if (!modalSelection?.coords) {
    alert('Selecciona un punto en el mapa.');
    return;
  }
  if (!placeName) {
    alert('Ingresa el nombre del lugar.');
    return;
  }

  const currentUser = getStoredUser();
  if (!currentUser) {
    updateAddPlaceStatus('Inicia sesion para publicar tu reseña.');
    showLogin();
    return;
  }

  if (!firebaseAuth?.currentUser || !firebaseStorage) {
    updateAddPlaceStatus('Firebase no está configurado correctamente.');
    return;
  }

  const baseId = slugify(placeName);
  const placeId = placeById[baseId] ? uniquePlaceId(placeName) : baseId;
  const useManual = photoInput?.dataset.manual === 'true' && manualPhoto;
  const selectionPhoto = modalSelection.photo || modalSelection.autoPhoto || autoPhotoFor(placeName || placeAddress);
  let primaryPhotoUrl = useManual ? manualPhoto : selectionPhoto || '';
  const imageIds = [];

  if (modalSelection.uploadBlob) {
    updateAddPlaceStatus('Subiendo imagen a Firebase...');
    try {
      const uid = firebaseAuth.currentUser.uid;
      const extension = (modalSelection.uploadMeta?.contentType || 'image/webp').includes('png') ? 'png' : 'webp';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const storageRef = firebaseStorage
        .ref()
        .child(`${FIREBASE_STORAGE_ROOT}/${uid}/${fileName}`);
      await storageRef.put(modalSelection.uploadBlob, {
        contentType: modalSelection.uploadMeta?.contentType || 'image/webp',
        cacheControl: 'public,max-age=31536000'
      });
      primaryPhotoUrl = await storageRef.getDownloadURL();

      updateAddPlaceStatus('Guardando metadatos de la imagen...');
      const { response: imageResponse, payload: imagePayload } = await requestJSON(
        `${API_BASE}/images`,
        {
          method: 'POST',
          body: JSON.stringify({
            u: primaryPhotoUrl,
            w: modalSelection.uploadMeta?.width,
            h: modalSelection.uploadMeta?.height,
            s: modalSelection.uploadMeta?.size,
            pv: 'fb'
          })
        }
      );

      if (!imageResponse.ok) {
        updateAddPlaceStatus(imagePayload?.error || 'No se pudo guardar la imagen.');
        return;
      }

      if (imagePayload?.image?.id) {
        imageIds.push(imagePayload.image.id);
      }
    } catch (error) {
      console.error('No se pudo subir la imagen a Firebase:', error);
      updateAddPlaceStatus('No se pudo subir la imagen. Intenta nuevamente.');
      return;
    }
  }

  const placeData = {
    id: placeId,
    name: placeName,
    address: placeAddress,
    coords: modalSelection.coords,
    photo: primaryPhotoUrl || selectionPhoto || ''
  };

  updateAddPlaceStatus('Guardando reseña...');
  try {
    const { response, payload } = await requestJSON(`${API_BASE}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        place: placeData,
        rating,
        note,
        tags,
        city: placeAddress,
        imageIds,
        photo: primaryPhotoUrl
      })
    });

    if (!response.ok) {
      updateAddPlaceStatus(payload?.error || 'No se pudo guardar la reseña.');
      return;
    }

    if (payload?.place) {
      upsertPlace(payload.place);
    }

    if (!payload?.review) {
      updateAddPlaceStatus('Respuesta inesperada del servidor.');
      return;
    }

    const normalized = normalizeReviewEntry(payload.review, currentUser);
    reviews.push(normalized);
    refreshReviewOwnership();
    recomputeRep();
    renderAll();
    updateAddPlaceStatus('');
    modalSelection = null;
    closeCreateModal();
    if (mapInstance && normalized?.coords) {
      mapInstance.flyTo([normalized.coords.lat, normalized.coords.lng], 15, { duration: 0.8 });
    }
    document.querySelector('[data-tab="feed"]')?.click();
  } catch (error) {
    console.error('Error al crear la reseña', error);
    updateAddPlaceStatus('No se pudo guardar la reseña. Intenta nuevamente.');
  }
}
window.saveReview = saveReview;

// --- Tabs ---
tabs.forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.tab;
  tabs.forEach(btn => btn.classList.toggle('active', btn === button));
  screens.forEach(screen => screen.classList.toggle('active', screen.dataset.screen === target));
  if (target === 'feed') renderFeed();
  if (target === 'profile') renderProfile();
  if (target === 'map') {
    initMap();
    setTimeout(invalidateMapView, 250);
  }
}));

// --- Búsqueda global ---
searchInput?.addEventListener('input', () => {
  renderFeed();
  renderProfile();
});

// --- FAB draggable ---
const fab = document.querySelector('.fab');
const fabButton = fab?.querySelector('button');
const FAB_STORAGE_KEY = 'luggo-fab-position';
const FAB_MARGIN = 12;
let isDraggingFab = false;
let dragPointerId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
let suppressFabClick = false;

function clampFabPosition(x, y) {
  const margin = FAB_MARGIN;
  const maxX = Math.max(margin, window.innerWidth - fab.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - fab.offsetHeight - margin);
  return {
    left: Math.min(Math.max(margin, x), maxX),
    top: Math.min(Math.max(margin, y), maxY)
  };
}

function applyFabPosition(left, top) {
  const { left: clampedLeft, top: clampedTop } = clampFabPosition(left, top);
  fab.style.left = `${clampedLeft}px`;
  fab.style.top = `${clampedTop}px`;
  fab.style.right = 'auto';
  fab.style.bottom = 'auto';
  return { left: clampedLeft, top: clampedTop };
}

function loadFabPosition() {
  const stored = localStorage.getItem(FAB_STORAGE_KEY);
  if (!stored) return;
  try {
    const pos = JSON.parse(stored);
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      applyFabPosition(pos.left, pos.top);
    }
  } catch (error) {
    console.warn('No se pudo restaurar la posición del botón flotante', error);
  }
}

function saveFabPosition() {
  const rect = fab.getBoundingClientRect();
  const pos = clampFabPosition(rect.left, rect.top);
  localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(pos));
}

function setupFabDrag() {
  if (!fab || !fabButton) return;
  loadFabPosition();

  fabButton.addEventListener('pointerdown', event => {
    dragPointerId = event.pointerId;
    isDraggingFab = true;
    dragMoved = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    const rect = fab.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    fab.classList.add('dragging');
    fabButton.setPointerCapture(dragPointerId);
  });

  fabButton.addEventListener('pointermove', event => {
    if (!isDraggingFab || event.pointerId !== dragPointerId) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!dragMoved && Math.hypot(dx, dy) > 5) {
      dragMoved = true;
    }
    const targetLeft = event.clientX - dragOffsetX;
    const targetTop = event.clientY - dragOffsetY;
    applyFabPosition(targetLeft, targetTop);
  });

  const endDrag = event => {
    if (!isDraggingFab || event.pointerId !== dragPointerId) return;
    isDraggingFab = false;
    fab.classList.remove('dragging');
    fabButton.releasePointerCapture(dragPointerId);
    dragPointerId = null;
    if (dragMoved) {
      suppressFabClick = true;
      saveFabPosition();
    }
  };

  fabButton.addEventListener('pointerup', endDrag);
  fabButton.addEventListener('pointercancel', endDrag);

  fabButton.addEventListener('click', event => {
    if (suppressFabClick) {
      suppressFabClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('resize', () => {
    if (!fab.style.left || !fab.style.top) return;
    const rect = fab.getBoundingClientRect();
    applyFabPosition(rect.left, rect.top);
    saveFabPosition();
  });
}

// --- Inicialización ---
async function bootstrap() {
  setupAuthUI();
  setupFabDrag();
  setupMapSearch();
  setupSuggestionInputs();
  initUserLocation();
  await loadInitialData();
}

bootstrap().catch(error => {
  console.error('Error al iniciar la aplicacion', error);
});
















