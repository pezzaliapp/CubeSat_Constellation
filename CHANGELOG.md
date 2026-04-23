# CHANGELOG — CubeSat Orbit PWA

---

## v8 — Libreria satelliti / Catalog (2025-04-23)

### Funzionalità
- **Pannello Libreria collassabile** (`<details>`): appare tra il globo e i controlli, nessun JS necessario per il toggle.
- **Fetch live da Celestrak** (`fetchTLE`): ogni pulsante del catalogo scarica il TLE aggiornato da `celestrak.org/satcat/tle.php?CATNR={norad}` e lo appende al campo TLE esistente. Errori CORS/rete restituiscono un messaggio con l'URL manuale di fallback.
- **Catalogo curato** (10 satelliti in 4 categorie): Stazioni spaziali (ISS, Tiangong), Telescopi (Hubble, TESS, Fermi), Meteo/EO (NOAA-19, MetOp-C, Suomi NPP), CubeSat (ArduSat-1, CUTE).
- **Pulsante "🗑 Cancella TLE"**: resetta il campo TLE per permettere di costruire una nuova costellazione dal catalogo.
- **Comportamento additive**: clic sul catalogo aggiunge TLE all'esistente — si possono caricare ISS + Hubble + NOAA in sequenza per una costellazione multi-satellite.
- **Cache SW `v9`**: invalida la cache precedente.

---

## v7 — Bug Fix (2025-04-23)

### Fix
- **Periodo orbitale reale**: calcolato da `satrec.no` (rad/min) con la formula `T = 2π / no`. Precedentemente mostrava "~ (da TLE)" senza calcolare nulla. Ora l'ISS mostra ~92.7 min, Hubble ~95.5 min.
- **Velocità da `prop.velocity`**: sostituisce la differenza finita `distance(p1, p2) / 1s` con la velocità vettoriale ECI restituita direttamente da `satellite.propagate()` (km/s → m/s). Risultato più stabile e fisicamente corretto.
- **Accesso a proprietà privata Cesium rimosso**: `buildPositionsFromTLE` ora restituisce `{ positions, start, stop, hasPoints, satrec }` senza toccare `positions._property._times`, che era un accesso a un'API interna non documentata.
- **`satEntities` arricchito**: ogni elemento è ora `{ entity, satrec, name, color, periodMin }` invece del solo oggetto Cesium, rendendo disponibili `satrec` e `periodMin` in tutti i listener.
- **`imageryProvider` ripristinato**: il tentativo di migrare a `baseLayer` (deprecazione Cesium 1.104) ha causato un globo invisibile. Ripristinato `imageryProvider` + `terrainProvider: EllipsoidTerrainProvider()` come nella v6 funzionante. La deprecazione Cesium viene gestita nella v8.
- **Service Worker cache `v8`**: necessario per invalidare la cache `v7` che aveva cachato la versione rotta con `baseLayer`.

---

## v6 — Constellation Mode (2025-04-23)

### Funzionalità
- **Multi-satellite / Constellation mode** (Idea 1): il campo TLE accetta ora N satelliti in formato Celestrak standard (2 o 3 righe per satellite). Ogni satellite riceve un colore univoco dalla palette, un'etichetta con il proprio nome e un'orbita con `PolylineGlowMaterialProperty` nel colore corrispondente.
- **Parser TLE multiplo** (`parseTLEs`): gestisce blocchi con o senza riga del nome, riconosce automaticamente il formato.
- **Palette 10 colori**: ciano, giallo, verde menta, arancione, magenta, azzurro, rosso, bianco, lime, rosa.
- **Telemetria satellite primario**: in modalità multi, il pannello telemetria traccia `satEntities[0]` con il nome in evidenza.
- **Clock range unione**: la finestra temporale copre il range unione di tutti i TLE caricati.
- **TLE di default aggiornato**: textarea iniziale mostra ISS + HST (Hubble) per dimostrare subito la modalità costellazione.
- **Label multi-riga**: in modalità multi, l'etichetta mostra `{nome}\n{alt} km • {vel} m/s`.

### Fix
- **`_property._times` rimosso**: `buildPositionsFromTLE` non accede più alla proprietà privata interna di `SampledPositionProperty`. Restituisce `start`/`stop` calcolati esplicitamente.
- **`styles.css` aggiunto alla cache SW**: mancava dall'array `ASSETS`, causando layout non formattato in modalità offline.
- **Cache SW `v6`**: invalida la cache `v4d` precedente.

---

## v5b / v5c — Baseline (pre-refactor)

Versione originale funzionante. Caratteristiche principali:
- Visualizzazione 3D globo con tile OpenStreetMap via CesiumJS
- Propagazione orbitale SGP4/SDP4 con satellite.js
- Telemetria: altitudine, velocità (differenza finita), lat/lon, link Google Maps / OSM
- Posizione del Sole: punto subsolare, azimut/elevazione
- Ombreggiatura giorno/notte (`enableLighting`)
- Fix iOS: `--vh` dinamico, `translateZ(0)`, no `overflow:hidden` sul viewer
- PWA installabile: manifest + service worker + pulsante install
