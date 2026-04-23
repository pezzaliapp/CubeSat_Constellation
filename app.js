/* CubeSat Orbit — CesiumJS TLE viewer (PWA shell)
 * v9 — Ground Station: cono visibilità + AOS/LOS — MIT 2025
 */
'use strict';

(function () {
  const setVH = () =>
    document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', setVH);
  setVH();
})();

if (typeof window.satellite === 'undefined') {
  document.getElementById('status').textContent = 'Errore: satellite.js non caricato';
  console.error('satellite.js global not found');
}

// --- UI refs ---
const elTLE      = document.getElementById('tle');
const elMinutes  = document.getElementById('minutes');
const elStep     = document.getElementById('step');
const elSim      = document.getElementById('simulate');
const elPlay     = document.getElementById('play');
const elReset    = document.getElementById('reset');
const elStatus   = document.getElementById('status');
const elInstall  = document.getElementById('btnInstall');
const elLog      = document.getElementById('log');
const telemetryEl       = document.getElementById('telemetry');
const sunEl             = document.getElementById('suninfo');
const elBtnStation      = document.getElementById('btnStation');
const elBtnGeo          = document.getElementById('btnGeo');
const elBtnClearStation = document.getElementById('btnClearStation');
const elStationInfo     = document.getElementById('stationInfo');
const elStationCoords   = document.getElementById('stationCoords');
const elAoslosPanel     = document.getElementById('aoslosPanel');
const elAoslos          = document.getElementById('aoslos');

// ------- PWA Install Prompt -------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  elInstall.hidden = false;
});
elInstall?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  elInstall.hidden = true;
});

// ------- Service Worker -------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

// ------- Cesium Viewer -------
Cesium.Ion.defaultAccessToken = undefined;
const viewer = new Cesium.Viewer('viewer', {
  imageryProvider: new Cesium.UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: '© OpenStreetMap contributors',
  }),
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  animation: true,
  timeline: true,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: true,
  sceneModePicker: true,
  navigationHelpButton: false,
  fullscreenButton: false,
});

viewer.scene.globe.enableLighting = true;
viewer.scene.globe.show = true;
viewer.scene.skyAtmosphere.show = true;

viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
viewer.clock.multiplier = 60;
viewer.clock.shouldAnimate = false;

viewer.scene.screenSpaceCameraController.minimumZoomDistance = 900_000;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 60_000_000;
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Infinity;
viewer.clock.onTick.addEventListener(() => viewer.scene.requestRender());

// Palette colori per la modalità multi-satellite
const PALETTE = [
  Cesium.Color.fromCssColorString('#00ffff'),
  Cesium.Color.fromCssColorString('#ffff00'),
  Cesium.Color.fromCssColorString('#00ff88'),
  Cesium.Color.fromCssColorString('#ff8800'),
  Cesium.Color.fromCssColorString('#ff44ff'),
  Cesium.Color.fromCssColorString('#44aaff'),
  Cesium.Color.fromCssColorString('#ff4444'),
  Cesium.Color.fromCssColorString('#ffffff'),
  Cesium.Color.fromCssColorString('#88ff44'),
  Cesium.Color.fromCssColorString('#ffaaaa'),
];

// Array entità: { entity, satrec, name, color, periodMin }
let satEntities = [];

// Stato ground station
let gsEntity = null;
let gsGd     = null;   // { longitude, latitude, height } — radianti e km
let pickMode = false;

// ------- Helpers -------
function log(msg) {
  const lines = elLog.textContent.split('\n');
  if (lines.length > 100) lines.splice(0, lines.length - 100);
  elLog.textContent = lines.join('\n') + '\n' + msg;
}

function parseTLEs(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const tles = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
      tles.push({ name: `SAT-${tles.length + 1}`, l1: lines[i], l2: lines[i + 1] });
      i += 2;
    } else if (
      !lines[i].startsWith('1 ') && !lines[i].startsWith('2 ') &&
      i + 2 < lines.length && lines[i + 1].startsWith('1 ') && lines[i + 2].startsWith('2 ')
    ) {
      tles.push({ name: lines[i], l1: lines[i + 1], l2: lines[i + 2] });
      i += 3;
    } else {
      i++;
    }
  }
  return tles;
}

// Restituisce { positions, start, stop, hasPoints, satrec }
// Fix: non accede più a _property._times (proprietà privata di Cesium)
function buildPositionsFromTLE(tleLine1, tleLine2, minutes = 120, stepSec = 30) {
  const satrec = satellite.twoline2satrec(tleLine1.trim(), tleLine2.trim());
  const start = Cesium.JulianDate.now();
  const stop  = Cesium.JulianDate.addSeconds(start, minutes * 60, new Cesium.JulianDate());
  const positions = new Cesium.SampledPositionProperty();
  let hasPoints = false;

  for (let t = 0; t <= minutes * 60; t += stepSec) {
    const time   = Cesium.JulianDate.addSeconds(start, t, new Cesium.JulianDate());
    const jsDate = Cesium.JulianDate.toDate(time);
    const gmst   = satellite.gstime(jsDate);
    const prop   = satellite.propagate(satrec, jsDate);
    if (!prop.position) continue;
    const gd   = satellite.eciToGeodetic(prop.position, gmst);
    const cart = Cesium.Cartesian3.fromRadians(gd.longitude, gd.latitude, gd.height * 1000);
    positions.addSample(time, cart);
    hasPoints = true;
  }
  return { positions, start, stop, hasPoints, satrec };
}

// --- util: posizione del Sole (ECI->ECEF approssimata) ---
function sunECEF(jd) {
  try {
    const JD = Cesium.JulianDate.toDate(jd).getTime() / 86400000 + 2440587.5;
    const T  = (JD - 2451545.0) / 36525.0;
    const L0 = (280.46646 + 36000.76983 * T) % 360;
    const M  = (357.52911 + 35999.05029 * T) % 360;
    const Mr = Cesium.Math.toRadians(M);
    const C  =
      (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
      (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
      0.000289 * Math.sin(3 * Mr);
    const lambda = Cesium.Math.toRadians((L0 + C) % 360);
    const eps    = Cesium.Math.toRadians(23.439 - 0.00000036 * T);
    const x = Math.cos(lambda),
          y = Math.cos(eps) * Math.sin(lambda),
          z = Math.sin(eps) * Math.sin(lambda);
    const m = Cesium.Transforms.computeIcrfToFixedMatrix(jd);
    return m
      ? Cesium.Matrix3.multiplyByVector(m, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3())
      : new Cesium.Cartesian3(x, y, z);
  } catch (_) { return null; }
}

// ------- Ground Station -------

// Raggio del cerchio di visibilità a terra (m) con elevazione minima ε
function visibilityRadiusMeters(altKm, minElevDeg = 5) {
  const Re  = 6371;
  const eps = Cesium.Math.toRadians(minElevDeg);
  const eta = Math.asin(Re * Math.cos(eps) / (Re + altKm));
  const rho = Math.PI / 2 - eps - eta;
  return Re * 1000 * rho;
}

// Elevazione angolare (°) del satellite visto dalla ground station
function getElevationDeg(satrec, gd, date) {
  const prop = satellite.propagate(satrec, date);
  if (!prop.position) return null;
  const gmst = satellite.gstime(date);
  const ecf  = satellite.eciToEcf(prop.position, gmst);
  const ang  = satellite.ecfToLookAngles(gd, ecf);
  return ang.elevation * (180 / Math.PI);
}

// Scansione AOS/TCA/LOS nella finestra temporale simulata (step 30 s)
function findNextPass(satrec, gd, startJD, stopJD, minElevDeg = 5) {
  const stepSec  = 30;
  const totalSec = Cesium.JulianDate.secondsDifference(stopJD, startJD);
  let inPass = false, aos = null, tca = null, maxElev = -Infinity;

  for (let t = 0; t <= totalSec; t += stepSec) {
    const jd   = Cesium.JulianDate.addSeconds(startJD, t, new Cesium.JulianDate());
    const elev = getElevationDeg(satrec, gd, Cesium.JulianDate.toDate(jd));
    if (elev === null) continue;

    if (!inPass && elev >= minElevDeg) {
      inPass = true; aos = jd.clone(); maxElev = elev;
    } else if (inPass && elev > maxElev) {
      maxElev = elev; tca = jd.clone();
    } else if (inPass && elev < minElevDeg) {
      return { aos, tca: tca || aos, los: jd.clone(), maxElev };
    }
  }
  return inPass ? { aos, tca: tca || aos, los: stopJD.clone(), maxElev } : null;
}

function fmtTime(jd) {
  return Cesium.JulianDate.toDate(jd).toLocaleTimeString('it-IT', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function updateAosLos() {
  if (!elAoslos || !gsGd) return;
  if (satEntities.length === 0) {
    elAoslos.textContent = 'Nessun satellite caricato — premi Simula prima.';
    return;
  }
  const startJD = viewer.clock.startTime;
  const stopJD  = viewer.clock.stopTime;
  const lines = satEntities.map(({ satrec, name }) => {
    const pass = findNextPass(satrec, gsGd, startJD, stopJD);
    if (!pass) return `${name}: nessun passaggio nella finestra simulata`;
    const dur = Math.round(
      Cesium.JulianDate.secondsDifference(pass.los, pass.aos) / 60
    );
    return (
      `${name}\n` +
      `  AOS ${fmtTime(pass.aos)} · TCA ${fmtTime(pass.tca)} · LOS ${fmtTime(pass.los)}\n` +
      `  Elev. max: ${pass.maxElev.toFixed(1)}° · Durata: ~${dur} min`
    );
  });
  elAoslos.textContent = lines.join('\n\n');
}

function clearGroundStation() {
  if (gsEntity) { viewer.entities.remove(gsEntity); gsEntity = null; }
  gsGd = null;
  if (elStationInfo)  elStationInfo.hidden  = true;
  if (elBtnClearStation) elBtnClearStation.hidden = true;
  if (elAoslosPanel)  elAoslosPanel.hidden  = true;
}

function placeGroundStation(cartesian) {
  clearGroundStation();

  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  const lat   = Cesium.Math.toDegrees(carto.latitude);
  const lon   = Cesium.Math.toDegrees(carto.longitude);
  gsGd = { longitude: carto.longitude, latitude: carto.latitude, height: 0 };

  // Raggio del cerchio basato sull'altitudine del satellite primario (default 500 km LEO)
  let altKm = 500;
  if (satEntities.length > 0) {
    const p = satEntities[0].entity.position.getValue(viewer.clock.currentTime);
    if (p) altKm = Cesium.Cartographic.fromCartesian(p).height / 1000;
  }

  gsEntity = viewer.entities.add({
    name: 'Ground Station',
    position: cartesian,
    point: {
      pixelSize: 10,
      color: Cesium.Color.RED,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text: '📍 GS',
      fillColor: Cesium.Color.RED,
      font: '12px sans-serif',
      pixelOffset: new Cesium.Cartesian2(0, -22),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.55),
    },
    ellipse: {
      semiMajorAxis: visibilityRadiusMeters(altKm),
      semiMinorAxis: visibilityRadiusMeters(altKm),
      material: Cesium.Color.RED.withAlpha(0.07),
      outline: true,
      outlineColor: Cesium.Color.RED.withAlpha(0.45),
      outlineWidth: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  elStationCoords.textContent = `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
  elStationInfo.hidden  = false;
  elBtnClearStation.hidden = false;
  elAoslosPanel.hidden  = false;
  updateAosLos();
}

// Handler click sul globo (attivo solo in pick mode)
const gsPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
gsPickHandler.setInputAction((e) => {
  if (!pickMode) return;
  const ray = viewer.camera.getPickRay(e.position);
  const pos = viewer.scene.globe.pick(ray, viewer.scene);
  if (!pos) return;

  pickMode = false;
  elBtnStation.classList.remove('btn-picking');
  elBtnStation.textContent = '📍 Piazza Stazione';
  viewer.scene.screenSpaceCameraController.enableRotate = true;
  viewer.scene.screenSpaceCameraController.enableZoom   = true;

  placeGroundStation(pos);
  elStatus.textContent = 'Stazione piazzata ✅';
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// Bottone pick mode
elBtnStation?.addEventListener('click', () => {
  pickMode = !pickMode;
  if (pickMode) {
    elBtnStation.classList.add('btn-picking');
    elBtnStation.textContent = '🎯 Clicca sul globo…';
    viewer.scene.screenSpaceCameraController.enableRotate = false;
    viewer.scene.screenSpaceCameraController.enableZoom   = false;
    elStatus.textContent = 'Clicca sul globo per piazzare la stazione a terra';
  } else {
    elBtnStation.classList.remove('btn-picking');
    elBtnStation.textContent = '📍 Piazza Stazione';
    viewer.scene.screenSpaceCameraController.enableRotate = true;
    viewer.scene.screenSpaceCameraController.enableZoom   = true;
    elStatus.textContent = 'Stato: pronto';
  }
});

// Bottone geolocalizzazione browser
elBtnGeo?.addEventListener('click', () => {
  // Cancella eventuale pick mode attiva
  if (pickMode) {
    pickMode = false;
    elBtnStation.classList.remove('btn-picking');
    elBtnStation.textContent = '📍 Piazza Stazione';
    viewer.scene.screenSpaceCameraController.enableRotate = true;
    viewer.scene.screenSpaceCameraController.enableZoom   = true;
  }
  if (!navigator.geolocation) {
    elStatus.textContent = 'Geolocalizzazione non supportata da questo browser';
    return;
  }
  const origText = elBtnGeo.textContent;
  elBtnGeo.disabled = true;
  elBtnGeo.textContent = '⏳';
  elStatus.textContent = 'Richiesta posizione GPS in corso…';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const cart = Cesium.Cartesian3.fromDegrees(
        pos.coords.longitude, pos.coords.latitude, 0
      );
      placeGroundStation(cart);
      elStatus.textContent =
        `Posizione GPS acquisita ✅ (±${Math.round(pos.coords.accuracy)} m)`;
      elBtnGeo.disabled = false;
      elBtnGeo.textContent = origText;
    },
    (err) => {
      elStatus.textContent = `GPS non disponibile: ${err.message}`;
      elBtnGeo.disabled = false;
      elBtnGeo.textContent = origText;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Bottone rimuovi stazione
elBtnClearStation?.addEventListener('click', () => {
  clearGroundStation();
  elStatus.textContent = 'Stazione rimossa';
});

// ------- Catalog -------
const CATALOG = [
  {
    group: '🛰 Stazioni spaziali',
    items: [
      { name: 'ISS (ZARYA)', norad: 25544 },
      { name: 'Tiangong (CSS)', norad: 48274 },
    ],
  },
  {
    group: '🔭 Telescopi',
    items: [
      { name: 'Hubble (HST)', norad: 20580 },
      { name: 'TESS', norad: 43435 },
      { name: 'Fermi GBM', norad: 33053 },
    ],
  },
  {
    group: '🌦 Meteo / Earth Obs',
    items: [
      { name: 'NOAA-19', norad: 33591 },
      { name: 'MetOp-C', norad: 43689 },
      { name: 'Suomi NPP', norad: 37849 },
    ],
  },
  {
    group: '📦 CubeSat',
    items: [
      { name: 'ArduSat-1', norad: 39090 },
      { name: 'CUTE', norad: 49263 },
    ],
  },
];

async function fetchTLE(norad) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=TLE`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (_) {
    throw new Error(`rete/CORS — scarica manualmente da celestrak.org/satcat/tle.php?CATNR=${norad}`);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text.trim() || !text.includes('1 ') || !text.includes('2 ')) {
    throw new Error('risposta non contiene TLE validi');
  }
  return text.trim();
}

function renderCatalog() {
  const container = document.getElementById('catalogGrid');
  if (!container) return;
  CATALOG.forEach(({ group, items }) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'catalog-group';

    const label = document.createElement('span');
    label.className = 'catalog-label';
    label.textContent = group;
    groupEl.appendChild(label);

    const btns = document.createElement('div');
    btns.className = 'catalog-btns';
    items.forEach(({ name, norad }) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.className = 'cat-btn';
      btn.title = `NORAD ${norad} — aggiunge al campo TLE`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '⏳';
        try {
          const tle = await fetchTLE(norad);
          const cur = elTLE.value.trim();
          elTLE.value = cur ? cur + '\n' + tle : tle;
          elStatus.textContent = `${name} aggiunto ✅ — premi Simula`;
          log(`Catalog: ${name} (NORAD ${norad}) caricato.`);
        } catch (e) {
          elStatus.textContent = `Fetch ${name} fallito: ${e.message}`;
          log(`Catalog errore (NORAD ${norad}): ${e.message}`);
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
      btns.appendChild(btn);
    });

    groupEl.appendChild(btns);
    container.appendChild(groupEl);
  });
}

document.getElementById('btnClearTle')?.addEventListener('click', () => {
  elTLE.value = '';
  elStatus.textContent = 'TLE cancellato — seleziona dalla libreria o incolla manualmente';
});

// ------- Simulate -------
elSim.addEventListener('click', () => {
  try {
    const tles = parseTLEs(elTLE.value);
    if (tles.length === 0) throw new Error('Inserisci almeno un TLE valido (2 o 3 righe).');

    const minutes = Math.max(1, parseInt(elMinutes.value || '120', 10));
    const stepSec = Math.max(1, parseInt(elStep.value || '30', 10));

    satEntities.forEach(({ entity }) => viewer.entities.remove(entity));
    satEntities = [];

    const multiMode = tles.length > 1;
    let globalStart = null, globalStop = null;

    tles.forEach(({ name, l1, l2 }, idx) => {
      const color = PALETTE[idx % PALETTE.length];
      const { positions, start, stop, hasPoints, satrec } =
        buildPositionsFromTLE(l1, l2, minutes, stepSec);
      if (!hasPoints) return;

      if (!globalStart || Cesium.JulianDate.lessThan(start, globalStart)) globalStart = start.clone();
      if (!globalStop  || Cesium.JulianDate.greaterThan(stop, globalStop))  globalStop  = stop.clone();

      // Fix: periodo orbitale calcolato da satrec.no (rad/min) → T = 2π / no minuti
      const periodMin = (2 * Math.PI / satrec.no).toFixed(1);

      const handle = { entity: null };
      const labelText = new Cesium.CallbackProperty(() => {
        try {
          const t  = viewer.clock.currentTime;
          const p1 = handle.entity?.position?.getValue(t);
          if (!p1) return '';
          const c   = Cesium.Cartographic.fromCartesian(p1);
          const alt = (c.height / 1000).toFixed(0);
          // Fix: velocità da prop.velocity (km/s → m/s), non più differenza finita
          const prop = satellite.propagate(satrec, Cesium.JulianDate.toDate(t));
          const vel  = prop.velocity
            ? (Math.sqrt(prop.velocity.x ** 2 + prop.velocity.y ** 2 + prop.velocity.z ** 2) * 1000).toFixed(0)
            : '-';
          return multiMode ? `${name}\n${alt} km • ${vel} m/s` : `${alt} km • ${vel} m/s`;
        } catch (_) { return ''; }
      }, false);

      const ent = viewer.entities.add({
        name,
        position: positions,
        point: { pixelSize: 7, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: labelText,
          showBackground: true,
          backgroundColor: Cesium.Color.fromAlpha(Cesium.Color.BLACK, 0.5),
          fillColor: color,
          font: '11px sans-serif',
          pixelOffset: new Cesium.Cartesian2(0, -18),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        path: {
          show: true,
          leadTime: 0,
          trailTime: minutes * 60,
          resolution: stepSec,
          material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color }),
          width: 2,
        },
      });

      handle.entity = ent;
      satEntities.push({ entity: ent, satrec, name, color, periodMin });
    });

    if (satEntities.length === 0) throw new Error('Nessun TLE valido propagato.');

    viewer.clock.startTime   = globalStart;
    viewer.clock.currentTime = globalStart.clone();
    viewer.clock.stopTime    = globalStop;
    viewer.clock.shouldAnimate = true;

    const safeOffset = new Cesium.HeadingPitchRange(0.0, Cesium.Math.toRadians(-35), 12_000_000);
    viewer.trackedEntity = undefined;
    satEntities[0].entity.viewFrom = new Cesium.Cartesian3(-9_000_000, 9_000_000, 5_000_000);
    viewer.flyTo(satEntities[0].entity, { offset: safeOffset, duration: 0.0 });

    if (gsGd) updateAosLos();

    const count = satEntities.length;
    elStatus.textContent = count === 1 ? 'Simulazione pronta ✅' : `${count} satelliti caricati ✅`;
    log(`Simulazione: ${count} satellite/i.`);
  } catch (e) {
    elStatus.textContent = 'Errore: ' + e.message;
    log(e.stack || e.message);
  }
});

elPlay.addEventListener('click', () => { viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate; });
elReset.addEventListener('click', () => { viewer.clock.currentTime = viewer.clock.startTime.clone(); });

// ------- Telemetria + Sole + micro-logger -------
(function () {
  const setText = (el, txt) => { if (el) el.textContent = txt; };
  if (telemetryEl) setText(telemetryEl, 'Altitudine: -\nVelocità: -\nPeriodo: -\nLat/Lon: -');
  if (sunEl) setText(sunEl, 'Subsolare: -\nAzimut/Elev: -');

  let frameCount = 0;
  viewer.scene.postRender.addEventListener(() => { frameCount++; });
  setInterval(() => {
    try {
      if (!viewer.clock) return;
      const fps = frameCount / 2; frameCount = 0;
      const t = Cesium.JulianDate.toDate(viewer.clock.currentTime)
        .toISOString().replace('T', ' ').replace('Z', ' UTC');
      log(`Tick: sim×${viewer.clock.multiplier}, ~${fps.toFixed(0)} FPS, t=${t}`);
    } catch (_) {}
  }, 2000);

  viewer.clock.onTick.addEventListener(() => {
    try {
      const primary = satEntities[0];
      if (!primary) return;

      const t  = viewer.clock.currentTime;
      const p1 = primary.entity.position.getValue(t);
      if (!p1) return;

      const c     = Cesium.Cartographic.fromCartesian(p1);
      const lat   = Cesium.Math.toDegrees(c.latitude);
      const lon   = Cesium.Math.toDegrees(c.longitude);
      const altKm = c.height / 1000;

      // Fix: velocità da prop.velocity (m/s esatti, non differenza finita)
      const prop   = satellite.propagate(primary.satrec, Cesium.JulianDate.toDate(t));
      const velStr = prop.velocity
        ? (Math.sqrt(prop.velocity.x ** 2 + prop.velocity.y ** 2 + prop.velocity.z ** 2) * 1000).toFixed(1) + ' m/s'
        : '-';

      const latFix = lat.toFixed(5), lonFix = lon.toFixed(5);
      const gmaps  = `https://www.google.com/maps/@?api=1&map_action=map&center=${latFix},${lonFix}&zoom=4&basemap=satellite`;
      const osm    = `https://www.openstreetmap.org/?mlat=${latFix}&mlon=${lonFix}#map=4/${latFix}/${lonFix}`;
      const prefix = satEntities.length > 1 ? `<strong>${primary.name}</strong><br>` : '';

      if (telemetryEl) {
        telemetryEl.innerHTML =
          `${prefix}` +
          `Altitudine: ${altKm.toFixed(1)} km<br>` +
          `Velocità: ${velStr}<br>` +
          `Periodo: ${primary.periodMin} min<br>` +
          `Lat/Lon: ${lat.toFixed(2)}°, ${lon.toFixed(2)}°<br>` +
          `<a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a> · ` +
          `<a href="${osm}" target="_blank" rel="noopener">OSM</a>`;
      }

      const s = sunECEF(t);
      if (s && sunEl) {
        const dir = Cesium.Cartesian3.normalize(s, new Cesium.Cartesian3());
        const ell = Cesium.Ellipsoid.WGS84;
        const sub = ell.scaleToGeodeticSurface(dir, new Cesium.Cartesian3());
        if (sub) {
          const sc      = ell.cartesianToCartographic(sub);
          const slat    = Cesium.Math.toDegrees(sc.latitude).toFixed(2);
          const slon    = Cesium.Math.toDegrees(sc.longitude).toFixed(2);
          const obsECEF  = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
          const enu      = Cesium.Transforms.eastNorthUpToFixedFrame(obsECEF);
          const inv      = Cesium.Matrix4.inverse(enu, new Cesium.Matrix4());
          const sunPoint = new Cesium.Cartesian3(dir.x * 1e7, dir.y * 1e7, dir.z * 1e7);
          const local    = Cesium.Matrix4.multiplyByPoint(inv, sunPoint, new Cesium.Cartesian3());
          const e = local.x, n = local.y, u = local.z;
          const az  = (Math.atan2(e, n) * 180) / Math.PI;
          const elv = (Math.asin(u / Math.sqrt(e * e + n * n + u * u)) * 180) / Math.PI;
          setText(sunEl,
            `Subsolare: ${slat}°, ${slon}°\nAzimut/Elev: ${((az + 360) % 360).toFixed(1)}°, ${elv.toFixed(1)}°`
          );
        }
      }
    } catch (_) {}
  });
})();

renderCatalog();
