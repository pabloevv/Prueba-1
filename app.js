// --- Datos base de lugares ---
const PLACES = [
  {
    id: 'cafe-aurora',
    name: 'Café Aurora',
    address: 'San José, CR',
    coords: { lat: 9.9339, lng: -84.0833 },
    photo: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'parque-sabana',
    name: 'Parque La Sabana',
    address: 'San José, CR',
    coords: { lat: 9.938, lng: -84.1008 },
    photo: 'https://images.unsplash.com/photo-1558981359-219d6364c9b8?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'mercado-central',
    name: 'Mercado Central',
    address: 'San José, CR',
    coords: { lat: 9.9343, lng: -84.0818 },
    photo: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=1200&auto=format&fit=crop'
  }
];
const placeById = {};
PLACES.forEach(place => {
  placeById[place.id] = place;
});

// --- Reseñas demo ---
let reviews = [
  {
    id: 1,
    placeId: 'cafe-aurora',
    city: 'San José, CR',
    rating: 5,
    photo: '',
    note: 'Capuchino cremoso y terraza con sombra. Ideal para estudiar.',
    tags: ['café', 'wifi', 'brunch'],
    userId: 'u1',
    userName: 'Usuario Demo',
    me: true,
    up: 3,
    down: 0,
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    coords: { lat: 9.9339, lng: -84.0833 }
  },
  {
    id: 2,
    placeId: 'parque-sabana',
    city: 'San José, CR',
    rating: 4,
    photo: '',
    note: 'Buen lugar para correr al atardecer. Llevar repelente (mosquitos).',
    tags: ['aire libre', 'running'],
    userId: 'u2',
    userName: 'María',
    me: false,
    up: 2,
    down: 1,
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    coords: { lat: 9.938, lng: -84.1008 }
  },
  {
    id: 3,
    placeId: 'mercado-central',
    city: 'San José, CR',
    rating: 5,
    photo: '',
    note: 'Sodas típicas ricas y baratas. Prueba el casado.',
    tags: ['comida típica', 'barato'],
    userId: 'u3',
    userName: 'Luis',
    me: false,
    up: 5,
    down: 0,
    createdAt: Date.now() - 1000 * 60 * 60 * 30,
    coords: { lat: 9.9343, lng: -84.0818 }
  }
];

// --- Reputación ---
const userRep = new Map();
function recomputeRep() {
  userRep.clear();
  reviews.forEach(review => {
    const karma = (userRep.get(review.userId) || 0) + (review.up - review.down);
    userRep.set(review.userId, karma);
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

// --- Votaciones ---
const voted = new Set();
function vote(reviewId, delta) {
  if (voted.has(reviewId)) return;
  const review = reviews.find(item => item.id === reviewId);
  if (!review) return;
  if (delta > 0) review.up += 1;
  else review.down += 1;
  voted.add(reviewId);
  recomputeRep();
  renderAll();
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
  const karma = userRep.get(review.userId) || 0;
  const rank = rankFromKarma(karma);
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
            <button onclick="vote(${review.id}, 1)">Me gusta ${review.up}</button>
            <button onclick="vote(${review.id}, -1)">No me gusta ${review.down}</button>
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
  const myId = mine[0]?.userId || 'u1';
  const karma = userRep.get(myId) || 0;
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
  const autoPhoto = photo ?? previous.autoPhoto ?? previous.photo ?? null;
  const manualEntry = photoInput?.dataset.manual === 'true';

  modalSelection = {
    ...previous,
    name: name ?? previous.name ?? '',
    address: address ?? previous.address ?? '',
    coords: coords ?? previous.coords ?? null,
    autoPhoto,
    photo: manualEntry ? (previous.photo ?? autoPhoto) : autoPhoto
  };

  if (placeNameInput && modalSelection.name) placeNameInput.value = modalSelection.name;
  if (placeAddressInput && modalSelection.address) placeAddressInput.value = modalSelection.address;

  if (photoInput && !manualEntry) {
    if (modalSelection.photo) {
      photoInput.value = modalSelection.photo;
      photoInput.dataset.auto = 'true';
    } else {
      photoInput.value = '';
      photoInput.dataset.auto = 'false';
    }
  }

  if (!manualEntry || !modalSelection.photo) {
    updatePhotoPreview(modalSelection.photo, modalSelection.name || 'Vista previa');
  }

  if (modalSelection.coords) {
    updateAddPlaceStatus(`Lugar seleccionado: ${modalSelection.coords.lat.toFixed(5)}, ${modalSelection.coords.lng.toFixed(5)}`);
  }
}if (photoInput) {
  photoInput.dataset.manual = 'false';
  photoInput.dataset.auto = 'false';
  photoInput.addEventListener('input', () => {
    const value = photoInput.value.trim();
    if (!modalSelection) modalSelection = {};
    if (value) {
      if (!modalSelection.autoPhoto && modalSelection.photo && photoInput.dataset.manual !== 'true') {
        modalSelection.autoPhoto = modalSelection.photo;
      }
      photoInput.dataset.manual = 'true';
      photoInput.dataset.auto = 'false';
      modalSelection.photo = value;
      if (photoFileInput) photoFileInput.value = '';
      updatePhotoPreview(value, placeNameInput?.value || 'Imagen personalizada');
    } else {
      photoInput.dataset.manual = 'false';
      modalSelection.photo = modalSelection.autoPhoto || null;
      if (modalSelection.photo) {
        photoInput.dataset.auto = 'true';
      } else {
        photoInput.dataset.auto = 'false';
      }
      updatePhotoPreview(modalSelection.photo, modalSelection.name || 'Vista previa');
    }
  });
}

if (photoFileInput) {
  photoFileInput.addEventListener('change', () => {
    const file = photoFileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!modalSelection) modalSelection = {};
      if (!modalSelection.autoPhoto && modalSelection.photo && photoInput.dataset.manual !== 'true') {
        modalSelection.autoPhoto = modalSelection.photo;
      }
      modalSelection.photo = dataUrl;
      photoInput.value = '';
      photoInput.dataset.manual = 'true';
      photoInput.dataset.auto = 'false';
      updatePhotoPreview(dataUrl, file.name || placeNameInput?.value || 'Imagen local');
    };
    reader.readAsDataURL(file);
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

function saveReview() {
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

  const baseId = slugify(placeName);
  const placeId = placeById[baseId] ? uniquePlaceId(placeName) : baseId;
  const useManual = photoInput?.dataset.manual === 'true' && manualPhoto;
  const selectionPhoto = modalSelection.photo || autoPhotoFor(placeName || placeAddress);
  const finalPhoto = useManual ? manualPhoto : selectionPhoto;

  const placeData = {
    id: placeId,
    name: placeName,
    address: placeAddress,
    coords: modalSelection.coords,
    photo: finalPhoto
  };
  PLACES.push(placeData);
  placeById[placeId] = placeData;

  const review = {
    id: Date.now(),
    placeId,
    city: placeAddress,
    rating,
    photo: finalPhoto,
    note,
    tags,
    userId: 'u1',
    userName: 'Usuario Demo',
    me: true,
    up: 0,
    down: 0,
    createdAt: Date.now(),
    coords: modalSelection.coords
  };
  reviews.push(review);

  closeCreateModal();
  recomputeRep();
  renderAll();
  if (mapInstance && review.coords) {
    mapInstance.flyTo([review.coords.lat, review.coords.lng], 15, { duration: 0.8 });
  }
  document.querySelector('[data-tab="feed"]')?.click();
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
setupFabDrag();
recomputeRep();
renderAll();
setupMapSearch();
setupSuggestionInputs();
initUserLocation();
















