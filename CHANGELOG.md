# CHANGELOG — CubeSat Orbit PWA

---

## v10.1 — Cesium Ion imagery fotorealistica (23 Aprile 2026)

### ✨ Nuove feature
- **Cesium Ion integration**: token autenticato con domain restriction su `alessandropezzali.it` e `localhost:8080`
- **Bing Maps Aerial with Labels** (Ion asset ID 3): sostituisce OpenStreetMap con immagini satellite fotorealistiche
- **Cesium World Terrain** (Ion asset ID 1): rilievi 3D del terreno caricati in async; fallback silenzioso alla sfera piatta se non disponibile
- Cache SW aggiornata a v12

---

## v10 — Eclipse Tracker (23 Aprile 2026)

### ✨ Nuove feature
- **Eclipse Tracker** (Idea 3): calcolo in tempo reale dello stato luce/ombra dei satelliti usando il modello cilindrico dell'ombra terrestre
- **Badge telemetria** con countdown in tempo simulato alla prossima transizione luce↔ombra
- Supporto multi-satellite: ogni satellite ha il proprio stato eclipse calcolato indipendentemente
- Cache `eclipseTransitionCache` per disaccoppiare scan costoso (ogni 2s) da aggiornamento UI (tick)

### 🐛 Bug fix
- Ripristinati link Google Maps/OSM nel pannello telemetria (URL malformato preesistente dalla v5b)

### 📝 Note tecniche
- Modello matematico cilindrico con errore ~1% (equivalente a ~2-4 min sulle transizioni) — accettabile per visualizzazione
- Usa `sunECEF(jd)` già presente per la posizione del Sole

---

## v9 — Ground Station + Cono Visibilità + AOS/LOS ✅ Completa e testata (23 Aprile 2026)

### Funzionalità
- **📍 Piazza Stazione (pick mode)**: pulsante che attiva la selezione dal globo. La camera viene bloccata durante la selezione (rotate/zoom disabilitati), il pulsante lampeggia arancione con animazione CSS. Il click sul globo Cesium converte le coordinate schermo in geodetiche e piazza la stazione.
- **📡 Usa mia posizione**: chiama `navigator.geolocation.getCurrentPosition()` con `enableHighAccuracy: true`. Mostra l'accuratezza GPS in metri nello status bar. Gestisce errori (permesso negato, timeout, browser non supportato). Disattiva automaticamente l'eventuale pick mode attiva.
- **Cerchio di visibilità**: ellisse Cesium semitrasparente sul suolo (`CLAMP_TO_GROUND`) con raggio calcolato dalla formula geometrica sferica: `η = arcsin(Re·cos(ε)/(Re+H))`, `ρ = π/2 − ε − η`, `r = Re·ρ`. Raggio basato sull'altitudine attuale del satellite primario; default 500 km LEO se nessun satellite è caricato.
- **Panel AOS/TCA/LOS**: scansione a passi da 30 s sull'intera finestra temporale simulata per ogni satellite della costellazione. Mostra: orario AOS, TCA, LOS, elevazione massima in gradi, durata del passaggio in minuti.
- **Elevazione minima 5°**: soglia standard per radioamatori e osservazioni ottiche.
- **Ricalcolo automatico**: `updateAosLos()` viene chiamato automaticamente al termine di ogni pressione di "Simula", aggiornando i passaggi quando si cambiano TLE o finestra temporale.
- **✖ Rimuovi Stazione**: cancella l'entità Cesium, azzera `gsGd` e nasconde tutti i panel GS.
- **Cache SW v10**: invalida la cache precedente.

### Note di test (23 Aprile 2026)
- ✅ Piazza Stazione via click sul globo: stazione posizionata correttamente, cerchio di visibilità disegnato.
- ✅ Geolocalizzazione HTML5 su HTTPS: posizione acquisita con feedback accuratezza GPS in metri.
- ✅ AOS/TCA/LOS per ISS e Hubble: passaggi calcolati correttamente nella finestra simulata.
- ✅ Cono di visibilità: raggio visivamente coerente con l'altitudine del satellite primario.
- ✅ Deploy v9 su sito pubblico (GitHub Pages).

---

## v8 — Libreria satelliti / Catalog ✅ Completa e testata (23 Aprile 2026)

### Funzionalità
- **Pannello Libreria collassabile** (`<details>`): appare tra il globo e i controlli, nessun JS necessario per il toggle.
- **Fetch live da Celestrak** (`fetchTLE`): ogni pulsante del catalogo scarica il TLE aggiornato tramite l'endpoint ufficiale `celestrak.org/NORAD/elements/gp.php?CATNR={norad}&FORMAT=TLE` e lo appende al campo TLE esistente. Errori CORS/rete restituiscono un messaggio con l'URL manuale di fallback.
- **Catalogo curato** (10 satelliti in 4 categorie): Stazioni spaziali (ISS, Tiangong), Telescopi (Hubble, TESS, Fermi), Meteo/EO (NOAA-19, MetOp-C, Suomi NPP), CubeSat (ArduSat-1, CUTE).
- **Pulsante "🗑 Cancella TLE"**: resetta il campo TLE per permettere di costruire una nuova costellazione dal catalogo.
- **Comportamento additive**: clic sul catalogo aggiunge TLE all'esistente — si possono caricare ISS + Hubble + NOAA in sequenza per una costellazione multi-satellite.
- **Cache SW `v9b`**: invalida la cache precedente.

### Note di test (23 Aprile 2026)
- ✅ Tutti e 10 i satelliti del catalogo caricano correttamente TLE live con epoch 2026.
- ✅ La UI appare correttamente tra il globo e il pannello controlli.
- ✅ Il comportamento additive funziona: si possono costruire costellazioni multi-satellite dal catalogo.
- ⚠️ Fix necessario post-deploy: l'URL iniziale (`satcat/tle.php`) era rimosso da Celestrak dal 2022-02-13. Corretto in hotfix con il nuovo endpoint `NORAD/elements/gp.php` (commit `fbe2ee7`).

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
