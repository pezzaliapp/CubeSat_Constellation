/* CubeSat Orbit — CesiumJS TLE viewer (PWA shell)
 * v7 — Bug fix: periodo orbitale reale, velocità da prop.velocity — MIT 2025
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
const telemetryEl = document.getElementById('telemetry');
const sunEl      = document.getElementById('suninfo');

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
