'use strict';

const categoryMeta = {
  Pantai: { icon: 'waves', color: '#18a9b0', tint: '#e6f7f7' },
  Bukit: { icon: 'mountain', color: '#edb11f', tint: '#fff6df' },
  Goa: { icon: 'landmark', color: '#9651d0', tint: '#f3e9fe' },
  'Air Terjun': { icon: 'droplets', color: '#2e83de', tint: '#e9f3ff' },
  Hutan: { icon: 'trees', color: '#67a942', tint: '#eef7e8' },
  Lainnya: { icon: 'compass', color: '#eb7a33', tint: '#fff0e6' },
  all: { icon: 'grid-2x2', color: '#0b4c41', tint: '#edf3ef' },
};

const categoryOrder = ['Pantai', 'Bukit', 'Goa', 'Air Terjun', 'Hutan', 'Lainnya'];

const fallbackImages = {
  Pantai: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=82',
  Bukit: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=82',
  Goa: 'https://images.unsplash.com/photo-1512036666432-2181c1f26420?auto=format&fit=crop&w=900&q=82',
  'Air Terjun': 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=900&q=82',
  Hutan: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=900&q=82',
  Lainnya: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=82',
};

const state = {
  query: '',
  category: 'all',
  regency: 'all',
  sort: 'rating_desc',
  selectedId: null,
};

let map;
let baseLayers = {};
let activeLayer;
let markerLayer;
let allMarkers = new Map();
let currentFiltered = [];
let iconCache = {};

const els = {};

function getDestinations() {
  const source = Array.isArray(window.JOSM_DESTINATIONS)
    ? window.JOSM_DESTINATIONS
    : (Array.isArray(window.destinations) ? window.destinations : (typeof destinations !== 'undefined' ? destinations : []));

  return source
    .filter(dest => Number.isFinite(Number(dest.latitude)) && Number.isFinite(Number(dest.longitude)))
    .map(dest => ({
      ...dest,
      latitude: Number(dest.latitude),
      longitude: Number(dest.longitude),
      rating: Number(dest.rating),
      htm_min: Number.isFinite(Number(dest.htm_min)) ? Number(dest.htm_min) : null,
      htm_max: Number.isFinite(Number(dest.htm_max)) ? Number(dest.htm_max) : null,
      kategori: dest.kategori || 'Lainnya',
      kabupaten: dest.kabupaten || 'Yogyakarta',
      htm_label: dest.htm_label || 'HTM belum tersedia',
      deskripsi_singkat: dest.deskripsi_singkat || 'Informasi destinasi akan ditampilkan di sini.',
    }));
}

function escapeHtml(text = '') {
  return String(text).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function formatRating(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(1).replace('.', ',');
}

function imageSrc(dest) {
  return dest.image || fallbackImages[dest.kategori] || fallbackImages.Lainnya;
}

function imageFallback(category) {
  return fallbackImages[category] || fallbackImages.Lainnya;
}

function googleMapsSearchUrl(dest) {
  if (dest.google_maps_url) return dest.google_maps_url;
  const query = [dest.nama_wisata, dest.kabupaten, 'Yogyakarta'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getMeta(category) {
  return categoryMeta[category] || categoryMeta.Lainnya;
}

function normalizeText(text = '') {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function createPinIcon(category, isActive = false) {
  const zoom = map ? map.getZoom() : 13;
  let sizeType = 'normal';

  if (isActive) {
    sizeType = 'normal';
  } else if (zoom <= 10) {
    sizeType = 'micro';
  } else if (zoom <= 12) {
    sizeType = 'mini';
  } else {
    sizeType = 'normal';
  }

  const meta = getMeta(category);
  const key = `${category}-${isActive ? 'active' : 'normal'}-${sizeType}`;
  if (iconCache[key]) return iconCache[key];

  let html = '';
  let iconSize = [34, 34];
  let iconAnchor = [17, 34];
  let popupAnchor = [0, -32];

  if (sizeType === 'micro') {
    iconSize = [18, 18];
    iconAnchor = [9, 9];
    popupAnchor = [0, -9];
    html = `<div class="custom-pin micro" style="--pin-color:${meta.color}"></div>`;
  } else if (sizeType === 'mini') {
    iconSize = [26, 26];
    iconAnchor = [13, 26];
    popupAnchor = [0, -24];
    html = `<div class="custom-pin mini" style="--pin-color:${meta.color}"><i data-lucide="${meta.icon}"></i></div>`;
  } else {
    iconSize = [34, 34];
    iconAnchor = [17, 34];
    popupAnchor = [0, -32];
    html = `<div class="custom-pin ${isActive ? 'active' : ''}" style="--pin-color:${meta.color}"><i data-lucide="${meta.icon}"></i></div>`;
  }

  iconCache[key] = L.divIcon({
    className: 'josm-pin-wrapper',
    html,
    iconSize,
    iconAnchor,
    popupAnchor,
  });

  return iconCache[key];
}

function cleanText(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\.\.\.+/g, '.')
    .trim();
}

function ensurePeriod(text = '') {
  const clean = cleanText(text).replace(/[,\-–;:]+$/g, '').trim();
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function trimAtWord(text = '', maxLength = 125) {
  const clean = cleanText(text);

  if (!clean) return '';

  if (clean.length <= maxLength) {
    return ensurePeriod(clean);
  }

  const sliced = clean.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  const safe = lastSpace > 45 ? sliced.slice(0, lastSpace) : sliced;

  return ensurePeriod(safe);
}

function firstSentenceOrTrim(text = '', maxLength = 125) {
  const clean = cleanText(text);

  if (!clean) return '';

  const sentenceMatch = clean.match(/[^.!?]+[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length <= maxLength) {
    return ensurePeriod(sentenceMatch[0]);
  }

  return trimAtWord(clean, maxLength);
}

function getPopupDescription(dest) {
  if (dest.popup_summary) {
    return firstSentenceOrTrim(dest.popup_summary, 125);
  }

  const raw = cleanText(dest.deskripsi_singkat || dest.deskripsi || '');

  if (raw) {
    return firstSentenceOrTrim(raw, 125);
  }

  const name = dest.nama_wisata || 'Destinasi ini';
  const category = dest.kategori || 'wisata alam';
  const regency = dest.kabupaten || 'Yogyakarta';

  return `${name} merupakan destinasi ${category} di ${regency}.`;
}

function buildPopup(dest) {
  const meta = getMeta(dest.kategori);
  return `
    <article class="popup-card">
      <img class="popup-image" src="${escapeHtml(imageSrc(dest))}" alt="${escapeHtml(dest.nama_wisata)}" onerror="this.onerror=null;this.src='${escapeHtml(imageFallback(dest.kategori))}'" />
      <div class="popup-body">
        <div class="popup-title-row">
          <span class="popup-cat-icon" style="--cat-color:${meta.color}"><i data-lucide="${meta.icon}"></i></span>
          <h3>${escapeHtml(dest.nama_wisata)}</h3>
        </div>
        <div class="popup-sub">${escapeHtml(dest.kabupaten)} &nbsp;•&nbsp; ${escapeHtml(dest.kategori)}</div>
        <div class="popup-meta">
          <span class="star">★ ${formatRating(dest.rating)}</span>
          <span><i data-lucide="ticket"></i> ${escapeHtml(dest.htm_label)}</span>
        </div>
        <p class="popup-desc">${escapeHtml(getPopupDescription(dest))}</p>
        <a class="popup-route" href="${googleMapsSearchUrl(dest)}" target="_blank" rel="noopener">
          Rute Google Maps <i data-lucide="external-link"></i>
        </a>
      </div>
    </article>`;
}

let kabupatenLayer = null;

function initMap() {
  baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    subdomains: ['a', 'b', 'c'],
    attribution: '&copy; OpenStreetMap contributors',
    updateWhenIdle: true,
    keepBuffer: 4,
  });

  baseLayers.satellite = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    attribution: '&copy; Google',
    updateWhenIdle: true,
    keepBuffer: 4,
  });

  // Tile error handling
  baseLayers.osm.on('tileerror', function(e) { console.warn('OSM tile gagal dimuat:', e.coords); });
  baseLayers.satellite.on('tileerror', function(e) { console.warn('Google Satelit tile gagal dimuat:', e.coords); });

  map = L.map('map', {
    zoomControl: true,
    layers: [baseLayers.osm],
    preferCanvas: true,
  }).setView([-7.85, 110.38], 10);

  activeLayer = baseLayers.osm;
  markerLayer = L.layerGroup().addTo(map);

  map.whenReady(() => {
    refreshMapLayout();
    setTimeout(refreshMapLayout, 50);
    setTimeout(refreshMapLayout, 150);
    setTimeout(refreshMapLayout, 300);
    setTimeout(refreshMapLayout, 600);
    setTimeout(refreshMapLayout, 1000);
  });

  map.on('popupclose', () => {
    if (state.selectedId) {
      const marker = allMarkers.get(state.selectedId);
      const dest = marker?.options?.destination;
      if (marker && dest) marker.setIcon(createPinIcon(dest.kategori, false));
    }
    state.selectedId = null;
    renderList(currentFiltered);
  });

  // Adaptive marker resize listener on zoom end
  map.on('zoomend', () => {
    allMarkers.forEach((marker, id) => {
      const dest = marker.options.destination;
      marker.setIcon(createPinIcon(dest.kategori, state.selectedId === dest.id));
    });
    if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } });
  });

  // Load kabupaten boundary layer
  loadKabupatenLayer();
}

const kabupatenColors = {
  'Sleman': '#2f86d8',
  'Kabupaten Sleman': '#2f86d8',

  'Bantul': '#18a9b0',
  'Kabupaten Bantul': '#18a9b0',

  'Kulon Progo': '#eb7a33',
  'Kabupaten Kulon Progo': '#eb7a33',

  'Gunungkidul': '#9651d0',
  'Kabupaten Gunungkidul': '#9651d0',
  'Gunung Kidul': '#9651d0',
  'Kabupaten Gunung Kidul': '#9651d0',

  'Kota Yogyakarta': '#df5f49',
  'Yogyakarta': '#df5f49',
  'KOTA YOGYAKARTA': '#df5f49',
  'Kota Jogja': '#df5f49'
};

window.kabupatenGeoJSON = null;
const TOLERANCE_METERS = 1500; // 1.5 km tolerance to allow near-boundary & coastal points due to simplified boundaries

// Ray-casting point-in-polygon algorithm
function isPointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygonFeature(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates;
    if (!isPointInPolygon(lon, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) {
      if (isPointInPolygon(lon, lat, rings[k])) return false; // in hole
    }
    return true;
  } else if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates;
    for (let p = 0; p < polygons.length; p++) {
      const rings = polygons[p];
      if (isPointInPolygon(lon, lat, rings[0])) {
        let inHole = false;
        for (let k = 1; k < rings.length; k++) {
          if (isPointInPolygon(lon, lat, rings[k])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }
  return false;
}

function distanceToSegmentMeters(px, py, ax, ay, bx, by) {
  const scaleX = 110000;
  const scaleY = 111000;
  
  const p_x = (px - ax) * scaleX;
  const p_y = (py - ay) * scaleY;
  const b_x = (bx - ax) * scaleX;
  const b_y = (by - ay) * scaleY;
  
  const ab2 = b_x * b_x + b_y * b_y;
  if (ab2 === 0) {
    return Math.sqrt(p_x * p_x + p_y * p_y);
  }
  
  let t = (p_x * b_x + p_y * b_y) / ab2;
  t = Math.max(0, Math.min(1, t)); // clamp to segment bounds
  
  const dx = p_x - t * b_x;
  const dy = p_y - t * b_y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distanceToPolygonMeters(lon, lat, geometry) {
  if (!geometry) return Infinity;
  let minDistance = Infinity;
  
  function checkRing(ring) {
    for (let i = 0; i < ring.length - 1; i++) {
      const dist = distanceToSegmentMeters(lon, lat, ring[i][0], ring[i][1], ring[i+1][0], ring[i+1][1]);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
  }
  
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(ring => checkRing(ring));
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      polygon.forEach(ring => checkRing(ring));
    });
  }
  
  return minDistance;
}

function isSameKabupaten(destRegency, featureName) {
  if (!destRegency || !featureName) return false;
  // Normalize regency strings: lowercase, remove "kabupaten"/"kota", and strip all spaces
  const d = destRegency.toLowerCase().replace(/kabupaten\s+/g, '').replace(/kota\s+/g, '').replace(/\s+/g, '').trim();
  const f = featureName.toLowerCase().replace(/kabupaten\s+/g, '').replace(/kota\s+/g, '').replace(/\s+/g, '').trim();
  return d === f || f.includes(d) || d.includes(f);
}

function getKabupatenName(feature) {
  if (!feature || !feature.properties) return '';
  const props = feature.properties;
  
  const name =
    props.WADMKK || props.wadmkk || props.Wadmkk ||
    props.NAMOBJ || props.namobj || props.Namobj ||
    props.name || props.NAME || props.Name ||
    props.NAME_2 || props.name_2 ||
    props.KABKOT || props.kabkot || props.Kabkot ||
    props.KABUPATEN || props.kabupaten ||
    props.KAB_NAME || props.kab_name ||
    '';
  return name.trim();
}

function loadKabupatenLayer() {
  fetch('batas%20kabupaten/kabupaten_diy.geojson')
    .then(res => {
      if (!res.ok) throw new Error('GeoJSON fetch failed: ' + res.status);
      return res.json();
    })
    .then(geojson => {
      window.kabupatenGeoJSON = geojson; // Save globally for rendering markers validation
      
      kabupatenLayer = L.geoJSON(geojson, {
        style: function(feature) {
          const name = getKabupatenName(feature);
          
          // Case-insensitive lookup for county colors
          let color = kabupatenColors[name];
          if (!color && name) {
            const nameLower = name.toLowerCase();
            const foundKey = Object.keys(kabupatenColors).find(k => k.toLowerCase() === nameLower);
            if (foundKey) color = kabupatenColors[foundKey];
          }
          if (!color) color = '#1a5c3a';

          return {
            color: color,
            weight: 2.4,
            opacity: 0.9,
            fillColor: color,
            fillOpacity: 0.01, // Light 1% outline fill as requested
            dashArray: '7 5',
            lineCap: 'round',
            lineJoin: 'round',
            interactive: true
          };
        },
        onEachFeature: function(feature, layer) {
          const name = getKabupatenName(feature);

          if (name) {
            layer.bindTooltip(name, {
              permanent: false,
              sticky: true,
              direction: 'center',
              className: 'kabupaten-tooltip',
            });
          }

          layer.on({
            mouseover: function(e) {
              e.target.setStyle({
                weight: 3.2,
                opacity: 1,
                fillOpacity: 0.05 // Subtle fill highlight on hover
              });
              e.target.bringToFront();
            },
            mouseout: function(e) {
              kabupatenLayer.resetStyle(e.target);
            }
          });
        }
      }).addTo(map);
      console.log('Batas kabupaten loaded successfully');
      
      // Re-apply filters to perform precise point-in-polygon validation on markers now that GeoJSON is loaded!
      applyFilters();
    })
    .catch(err => {
      console.warn('Gagal memuat batas kabupaten:', err);
    });
}

function refreshMapLayout() {
  if (!map) return;
  map.invalidateSize(true);
  if (activeLayer?.redraw) activeLayer.redraw();
}

function initElements() {
  els.search = document.querySelector('#mapSearch');
  els.floatingSearch = document.querySelector('#floatingSearch');
  els.clearSearch = document.querySelector('#clearSearch');
  els.categoryChips = document.querySelector('#categoryChips');
  els.regencySelect = document.querySelector('#regencySelect');
  els.sortSelect = document.querySelector('#sortSelect');
  els.resultSummary = document.querySelector('#resultSummary span');
  els.destinationList = document.querySelector('#destinationList');
  els.emptyState = document.querySelector('#emptyState');
  els.emptyReset = document.querySelector('#emptyReset');
  els.resetView = document.querySelector('#resetViewBtn');
  els.fitMarkers = document.querySelector('#fitMarkersBtn');
  els.layerOptions = document.querySelector('#layerOptions');
  els.toggleLayerPanel = document.querySelector('#toggleLayerPanel');
  els.sidebar = document.querySelector('#mapSidebar');
  els.mobileFilterToggle = document.querySelector('#mobileFilterToggle');
  els.sidebarClose = document.querySelector('#sidebarClose');
  els.sidebarToggle = document.querySelector('#sidebarToggleBtn');
}

function populateControls(data) {
  const categories = ['all', ...categoryOrder.filter(cat => data.some(item => item.kategori === cat))];
  els.categoryChips.innerHTML = categories.map(cat => {
    const meta = getMeta(cat);
    const label = cat === 'all' ? 'Semua' : cat;
    return `
      <button class="chip ${cat === 'all' ? 'active' : ''}" type="button" data-category="${escapeHtml(cat)}" style="--chip-color:${meta.color}; --chip-tint:${meta.tint};">
        <span class="chip-icon-wrap"><i data-lucide="${meta.icon}"></i></span>
        ${escapeHtml(label)}
      </button>`;
  }).join('');

  const regencies = [...new Set(data.map(item => item.kabupaten).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  els.regencySelect.innerHTML = `<option value="all">Semua kabupaten</option>` + regencies.map(reg => `<option value="${escapeHtml(reg)}">${escapeHtml(reg)}</option>`).join('');

  document.querySelector('#legendList').innerHTML = categoryOrder
    .filter(cat => data.some(item => item.kategori === cat))
    .map(cat => {
      const meta = getMeta(cat);
      return `
        <div class="legend-item" style="--cat-color:${meta.color}; --cat-tint:${meta.tint};">
          <span class="legend-badge"><i data-lucide="${meta.icon}"></i></span>
          <span>${escapeHtml(cat)}</span>
        </div>`;
    })
    .join('');
}

function filterData(data) {
  const q = normalizeText(state.query.trim());

  const filtered = data.filter(dest => {
    const matchesQuery = !q || normalizeText(`${dest.nama_wisata} ${dest.kabupaten} ${dest.kategori} ${dest.deskripsi_singkat}`).includes(q);
    const matchesCategory = state.category === 'all' || dest.kategori === state.category;
    const matchesRegency = state.regency === 'all' || dest.kabupaten === state.regency;
    return matchesQuery && matchesCategory && matchesRegency;
  });

  const sorted = filtered.sort((a, b) => {
    if (state.selectedId === a.id) return -1;
    if (state.selectedId === b.id) return 1;

    switch (state.sort) {
      case 'rating_asc':
        return (Number(a.rating) || 0) - (Number(b.rating) || 0) || a.nama_wisata.localeCompare(b.nama_wisata, 'id');
      case 'htm_asc': {
        const av = Number.isFinite(a.htm_min) ? a.htm_min : Number.POSITIVE_INFINITY;
        const bv = Number.isFinite(b.htm_min) ? b.htm_min : Number.POSITIVE_INFINITY;
        return av - bv || (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      case 'htm_desc': {
        const av = Number.isFinite(a.htm_max) ? a.htm_max : Number.NEGATIVE_INFINITY;
        const bv = Number.isFinite(b.htm_max) ? b.htm_max : Number.NEGATIVE_INFINITY;
        return bv - av || (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      case 'name_asc':
        return a.nama_wisata.localeCompare(b.nama_wisata, 'id');
      case 'rating_desc':
      default:
        return (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.nama_wisata.localeCompare(b.nama_wisata, 'id');
    }
  });

  return sorted;
}

window.invalidDestinations = [];

function renderMarkers(data) {
  markerLayer.clearLayers();
  allMarkers.clear();

  data.forEach(dest => {
    if (dest.latitude === null || dest.longitude === null || !isFinite(dest.latitude) || !isFinite(dest.longitude)) {
      return;
    }
    
    const lat = Number(dest.latitude);
    const lon = Number(dest.longitude);
    
    // Fallback broad bounds check (Yogyakarta DIY limits)
    const inDIY = lat >= -8.3 && lat <= -7.4 && lon >= 109.9 && lon <= 110.9;
    if (!inDIY) {
      console.warn(`Invalid coordinate skipped: ${dest.nama_wisata} (${dest.latitude}, ${dest.longitude}) - outside DIY bounds`);
      if (!window.invalidDestinations.some(d => d.id === dest.id)) {
        window.invalidDestinations.push(dest);
      }
      return;
    }
    
    // Precise Point-in-Polygon Check if GeoJSON is loaded
    if (window.kabupatenGeoJSON) {
      let matchedFeature = null;
      window.kabupatenGeoJSON.features.forEach(feat => {
        const fName = getKabupatenName(feat);
        if (isSameKabupaten(dest.kabupaten, fName)) {
          matchedFeature = feat;
        }
      });
      
      if (matchedFeature) {
        const inside = isPointInPolygonFeature(lon, lat, matchedFeature.geometry);
        if (!inside) {
          const dist = distanceToPolygonMeters(lon, lat, matchedFeature.geometry);
          if (dist <= TOLERANCE_METERS) {
            console.info(`Near-boundary coordinate checked: ${dest.nama_wisata} (${dest.latitude}, ${dest.longitude}) - inside tolerance`);
          } else {
            console.warn(`Invalid coordinate skipped: ${dest.nama_wisata} (${dest.latitude}, ${dest.longitude}) - outside DIY bounds`);
            if (!window.invalidDestinations.some(d => d.id === dest.id)) {
              window.invalidDestinations.push(dest);
            }
            return;
          }
        }
      }
    }

    const marker = L.marker([dest.latitude, dest.longitude], {
      icon: createPinIcon(dest.kategori, state.selectedId === dest.id),
      destination: dest,
      title: dest.nama_wisata,
    }).bindPopup(buildPopup(dest), { closeButton: true, maxWidth: 320 });

    marker.on('click', () => selectDestination(dest.id, { zoom: false, openPopup: true, scrollList: true }));
    marker.addTo(markerLayer);
    allMarkers.set(dest.id, marker);
  });

  setTimeout(() => {
    if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } });
  }, 0);
}

function renderList(data) {
  els.destinationList.innerHTML = data.slice(0, 80).map(dest => {
    const meta = getMeta(dest.kategori);
    const active = state.selectedId === dest.id ? ' active' : '';
    return `
      <button class="dest-item${active}" type="button" data-id="${escapeHtml(dest.id)}" role="listitem">
        <span class="dest-marker-icon" style="--cat-color:${meta.color}; background:${meta.color}"><i data-lucide="${meta.icon}"></i></span>
        <span>
          <h3>${escapeHtml(dest.nama_wisata)}</h3>
          <p>${escapeHtml(dest.kabupaten)} &nbsp;•&nbsp; ${escapeHtml(dest.kategori)}</p>
          <p class="mini-meta"><b>★ ${formatRating(dest.rating)}</b><span>•</span><span>${escapeHtml(dest.htm_label)}</span></p>
        </span>
        <span class="item-pin-btn"><i data-lucide="map-pin"></i></span>
      </button>`;
  }).join('');

  els.destinationList.querySelectorAll('.dest-item').forEach(btn => {
    btn.addEventListener('click', () => selectDestination(btn.dataset.id, { zoom: true, openPopup: true, scrollList: false }));
  });

  if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } });
}

function updateSummary(filtered, total) {
  els.resultSummary.textContent = `Menampilkan ${filtered.length} dari ${total} destinasi`;
  els.emptyState.hidden = filtered.length !== 0;
}

function applyFilters({ fit = false } = {}) {
  const all = getDestinations();
  currentFiltered = filterData(all);
  renderMarkers(currentFiltered);
  renderList(currentFiltered);
  updateSummary(currentFiltered, all.length);
  if (fit) fitToMarkers(currentFiltered);
  if (!currentFiltered.length) markerLayer.clearLayers();
}

function fitToMarkers(data = currentFiltered) {
  const validMarkers = [];
  data.forEach(dest => {
    const marker = allMarkers.get(dest.id);
    if (marker) validMarkers.push(marker.getLatLng());
  });
  
  if (!validMarkers.length) {
    map.setView([-7.85, 110.38], 10);
    return;
  }
  const leftPadding = window.innerWidth > 860 ? 460 : 40;
  const bounds = L.latLngBounds(validMarkers);
  map.fitBounds(bounds, { paddingTopLeft: [leftPadding, 70], paddingBottomRight: [80, 80], maxZoom: 12 });
}

function selectDestination(id, options = {}) {
  const marker = allMarkers.get(id);
  if (!marker) {
    const all = getDestinations();
    const dest = all.find(item => item.id === id);
    if (dest && (dest.latitude === null || dest.longitude === null)) {
      console.warn(`Koordinat belum tersedia untuk "${dest.nama_wisata}"`);
      alert(`Koordinat lokasi untuk "${dest.nama_wisata}" belum tersedia.`);
    }
    return;
  }
  const dest = marker.options.destination;

  if (state.selectedId && allMarkers.has(state.selectedId)) {
    const previous = allMarkers.get(state.selectedId);
    const previousDest = previous.options.destination;
    previous.setIcon(createPinIcon(previousDest.kategori, false));
  }

  state.selectedId = id;
  marker.setIcon(createPinIcon(dest.kategori, true));

  if (options.zoom) map.flyTo([dest.latitude, dest.longitude], Math.max(map.getZoom(), 13), { duration: .7 });
  if (options.openPopup) marker.openPopup();
  renderList(currentFiltered);

  if (options.scrollList) {
    const item = els.destinationList.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  if (window.innerWidth <= 860) closeMobileSidebar();
  setTimeout(() => { if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } }); }, 0);
}

function resetAll() {
  state.query = '';
  state.category = 'all';
  state.regency = 'all';
  state.sort = 'rating_desc';
  state.selectedId = null;
  els.search.value = '';
  if (els.floatingSearch) els.floatingSearch.value = '';
  els.regencySelect.value = 'all';
  els.sortSelect.value = 'rating_desc';
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.category === 'all'));
  map.closePopup();
  applyFilters({ fit: true });
}

function syncSearch(value) {
  state.query = value;
  els.search.value = value;
  if (els.floatingSearch) els.floatingSearch.value = value;
  state.selectedId = null;
  applyFilters({ fit: false });
}


function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  if (els.sidebarToggle) {
    els.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
    els.sidebarToggle.setAttribute('aria-label', collapsed ? 'Tampilkan panel destinasi' : 'Sembunyikan panel destinasi');
    els.sidebarToggle.innerHTML = collapsed
      ? '<i data-lucide="panel-left-open"></i><span>Tampilkan Panel</span>'
      : '<i data-lucide="panel-left-close"></i><span>Sembunyikan Panel</span>';
  }
  // Invalidate map layout dynamically during sidebar collapse/expand animation
  refreshMapLayout();
  setTimeout(refreshMapLayout, 100);
  setTimeout(refreshMapLayout, 200);
  setTimeout(() => {
    refreshMapLayout();
    fitToMarkers(currentFiltered);
    if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } });
  }, 300);
  setTimeout(refreshMapLayout, 500);
  setTimeout(refreshMapLayout, 800);
}

function toggleSidebarPanel() {
  const collapsed = document.body.classList.contains('sidebar-collapsed');
  setSidebarCollapsed(!collapsed);
}


function setupEvents() {
  els.search.addEventListener('input', e => syncSearch(e.target.value));
  if (els.floatingSearch) els.floatingSearch.addEventListener('input', e => syncSearch(e.target.value));
  els.clearSearch.addEventListener('click', () => syncSearch(''));
  els.emptyReset.addEventListener('click', resetAll);
  els.resetView.addEventListener('click', resetAll);
  els.fitMarkers.addEventListener('click', () => fitToMarkers(currentFiltered));
  if (els.sidebarToggle) els.sidebarToggle.addEventListener('click', toggleSidebarPanel);

  els.categoryChips.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.category = btn.dataset.category;
    state.selectedId = null;
    document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip === btn));
    map.closePopup();
    applyFilters({ fit: true });
  });

  els.regencySelect.addEventListener('change', e => {
    state.regency = e.target.value;
    state.selectedId = null;
    map.closePopup();
    applyFilters({ fit: true });
  });

  els.sortSelect.addEventListener('change', e => {
    state.sort = e.target.value;
    state.selectedId = null;
    map.closePopup();
    applyFilters({ fit: false });
  });

  els.toggleLayerPanel.addEventListener('click', () => {
    const hidden = els.layerOptions.hasAttribute('hidden');
    if (hidden) {
      els.layerOptions.removeAttribute('hidden');
      els.toggleLayerPanel.setAttribute('aria-expanded', 'true');
    } else {
      els.layerOptions.setAttribute('hidden', '');
      els.toggleLayerPanel.setAttribute('aria-expanded', 'false');
    }
  });

  els.layerOptions.addEventListener('change', e => {
    const selected = e.target.value;
    if (selected === 'kabupaten') {
      // Toggle kabupaten layer
      const cb = e.target;
      if (kabupatenLayer) {
        if (cb.checked) { kabupatenLayer.addTo(map); }
        else { map.removeLayer(kabupatenLayer); }
      }
      return;
    }
    if (!baseLayers[selected] || baseLayers[selected] === activeLayer) return;
    map.removeLayer(activeLayer);
    activeLayer = baseLayers[selected];
    activeLayer.addTo(map);
    map.invalidateSize(true);
    if (activeLayer.redraw) activeLayer.redraw();
    setTimeout(refreshMapLayout, 80);
    setTimeout(refreshMapLayout, 300);
  });

  els.mobileFilterToggle.addEventListener('click', () => openMobileSidebar());
  els.sidebarClose.addEventListener('click', () => closeMobileSidebar());
  window.addEventListener('resize', refreshMapLayout);
  window.addEventListener('load', () => {
    refreshMapLayout();
    setTimeout(refreshMapLayout, 100);
    setTimeout(refreshMapLayout, 300);
  });
}

function openMobileSidebar() {
  document.body.classList.remove('sidebar-collapsed');
  els.sidebar.classList.add('open');
  els.mobileFilterToggle.setAttribute('aria-expanded', 'true');
  setTimeout(refreshMapLayout, 240);
}
function closeMobileSidebar() {
  els.sidebar.classList.remove('open');
  els.mobileFilterToggle.setAttribute('aria-expanded', 'false');
  setTimeout(refreshMapLayout, 240);
}

function focusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('destinasi') || params.get('id');
  if (!id) return false;
  const all = getDestinations();
  const dest = all.find(item => item.id === id);
  if (!dest) return false;

  state.category = 'all';
  state.regency = 'all';
  state.sort = 'rating_desc';
  state.query = '';
  currentFiltered = filterData(all);
  renderMarkers(currentFiltered);
  renderList(currentFiltered);
  updateSummary(currentFiltered, all.length);

  setTimeout(() => selectDestination(dest.id, { zoom: true, openPopup: true, scrollList: true }), 350);
  return true;
}

function boot() {
  initElements();
  initMap();
  const data = getDestinations();
  populateControls(data);
  setupEvents();
  applyFilters({ fit: true });
  if (!focusFromUrl()) fitToMarkers(currentFiltered);
  setTimeout(() => { refreshMapLayout(); fitToMarkers(currentFiltered); }, 350);
  setTimeout(() => { refreshMapLayout(); fitToMarkers(currentFiltered); }, 1100);
  if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': 2.4 } });
}

document.addEventListener('DOMContentLoaded', boot);
