# Analisi Iniziale — CubeSat Orbit PWA
*Documento generato il 2026-04-22 con Claude Code — da leggere prima di qualsiasi intervento sul codice.*

---

## 1. Cos'è e cosa fa

**CubeSat Orbit** è una Progressive Web App che visualizza in 3D le orbite di satelliti artificiali a partire da dati TLE (Two-Line Elements). L'utente incolla un TLE nel campo di testo, configura durata e passo temporale, premia "Simula" e vede il satellite muoversi sul globo in tempo simulato accelerato (×60 di default).

### Funzionalità attive
- Globo 3D interattivo con tiles OpenStreetMap via CesiumJS
- Propagazione orbitale accurata tramite satellite.js (modello SGP4/SDP4)
- Traccia dell'orbita con effetto glow ciano
- Etichetta dinamica sopra il satellite con altitudine e velocità istantanee
- Pannello telemetria: altitudine, velocità stimata, lat/lon, link Google Maps e OSM
- Calcolo posizione del Sole: punto subsolare, azimut ed elevazione rispetto al satellite
- Ombreggiatura giorno/notte sul globo (`enableLighting`)
- Controlli Play/Pause e Reset sulla timeline Cesium
- PWA installabile (manifest + service worker + pulsante install)
- Fix specifici per iOS: altezza viewport dinamica con `--vh`, `translateZ(0)`, no `overflow:hidden` sul viewer

---

## 2. Struttura del progetto

```
/
├── index.html          — Shell HTML, importa Cesium e satellite.js da CDN
├── app.js              — Tutta la logica (propagazione, rendering, telemetria, sole)
├── styles.css          — Layout mobile-safe, design dark space
├── manifest.json       — Configurazione PWA
├── service-worker.js   — Cache offline (strategia cache-first per asset locali)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

### Dipendenze esterne (CDN)
| Libreria | Versione | Uso |
|---|---|---|
| CesiumJS | 1.120.0 | Rendering 3D globo, gestione clock, entità, trasformazioni |
| satellite.js | 4.0.0 | Propagazione SGP4/SDP4 da TLE |

Nessun bundler, nessun framework — vanilla JS puro.

---

## 3. Tecnologie e pattern usati

- **CesiumJS**: Viewer con `SampledPositionProperty` per interpolare le posizioni orbitali, `CallbackProperty` per l'etichetta dinamica, `PolylineGlowMaterialProperty` per la traccia, `Transforms.computeIcrfToFixedMatrix` per convertire ECI → ECEF
- **satellite.js**: `twoline2satrec`, `propagate`, `gstime`, `eciToGeodetic`
- **Service Worker**: strategia cache-first per gli asset locali, network-fallback con caching dinamico
- **PWA**: manifest + `beforeinstallprompt` + `apple-mobile-web-app-capable`
- **CSS**: custom property `--vh` per fix iOS, grid a due colonne, glassmorphism sull'header

---

## 4. Problemi e cose migliorabili

### Bug e fragilità
1. **Accesso a proprietà privata di Cesium** (`positions._property._times`): le righe 205-206 leggono `_property._times` che è un'implementazione interna non documentata di `SampledPositionProperty`. Può rompersi silenziosamente con qualsiasi aggiornamento di CesiumJS. La soluzione corretta è tenere traccia di `start` e `stop` nel momento in cui si costruisce la lista campioni.

2. **Periodo orbitale mai calcolato**: la telemetria mostra letteralmente `Periodo: ~ (da TLE)` senza calcolare nulla. Il periodo è banale: `T = 1440 / n` minuti, dove `n` è il mean motion nella riga 2 del TLE (colonne 52-63).

3. **Velocità stimata con differenza finita invece dei vettori ECI**: si calcola `distance(p1, p2) / 1s`, che introduce errore di interpolazione. `satellite.propagate()` restituisce già `prop.velocity` (km/s in ECI) — basta usarlo direttamente.

4. **`styles.css` assente dalla cache del service worker**: l'array `ASSETS` in service-worker.js non include `./styles.css`. Offline, l'app carica senza stili (pagina bianca non formattata).

5. **`requestRenderMode` vanificato**: si imposta `viewer.scene.requestRenderMode = true` (risparmio energetico) ma poi si forza un render ad ogni tick del clock con `viewer.clock.onTick.addEventListener(() => viewer.scene.requestRender())`. Il risultato è render continuo esattamente come senza requestRenderMode — nessun risparmio.

6. **Versioni inconsistenti nei file**: `index.html` dice v5b, `app.js` dice v5c nel commento iniziale, `manifest.json` dice v4 Stable, `service-worker.js` dice v4d. Confonde debug e cache invalidation.

7. **Telemetria mista `innerHTML`/`textContent`**: `telemetryEl` usa `innerHTML` (per i link Maps/OSM), `sunEl` e `elLog` usano `textContent`. Il mix è inconsistente. In questo caso i link sono generati internamente quindi non c'è rischio XSS reale, ma è una pratica da evitare.

8. **Log che tronca a metà riga**: `elLog.textContent = (elLog.textContent + '\n' + msg).slice(-3000)` taglia gli ultimi 3000 caratteri senza cercare un newline — spezza il testo a metà di una riga.

9. **Validazione TLE minima**: si prende solo l'ultima coppia di righe non vuote, ma non si verifica il checksum né il formato (linea 1 deve iniziare con '1 ', linea 2 con '2 '). Un TLE malformato produce un errore di satellite.js poco descrittivo.

10. **Nessun feedback di errore per propagazione fallita**: se `prop.position` è falsy per tutti i campioni (TLE scaduto, satellite già rientrato), `positions` rimane vuota e Cesium crea un'entità senza posizione — senza alcun messaggio all'utente oltre al log interno.

### Codice duplicato
- Il calcolo `Cesium.JulianDate.addSeconds(t, 1, new Cesium.JulianDate())` e la distanza p1→p2 appaiono sia nella `CallbackProperty` dell'etichetta (righe 158-165) sia nel `clock.onTick` della telemetria (righe 278-281) — stessa logica, due posti.

### Obsolescenza
- `new Cesium.UrlTemplateImageryProvider(...)` come parametro diretto del Viewer è deprecato dalla 1.104 — va wrappato in `new Cesium.ImageryLayer(...)`.
- `new Cesium.EllipsoidTerrainProvider()` è deprecato — ora è `Cesium.TerrainProvider.NONE` o semplicemente omesso.

---

## 5. 10 idee creative per evolvere il progetto

### 1. Multi-satellite / Constellation mode
Accetti un blocco TLE multi-riga (formato Celestrak standard, N satelliti) e visualizzi tutte le orbite contemporaneamente, ognuna con colore diverso. Ottimo per mostrare costellazioni Starlink, flotte CubeSat universitarie o tutti i satelliti in LEO simultaneamente.

### 2. Ground station + cono di visibilità + AOS/LOS
L'utente clicca sul globo per piazzare una stazione a terra. Cesium disegna il cono d'orizzonte in real-time e il pannello mostra countdown preciso ad AOS (Acquisition of Signal), TCA (Time of Closest Approach) e LOS (Loss of Signal). Essenziale per radioamatori che seguono satellite come AO-91 o Fox-1.

### 3. Eclipse tracker — luce solare vs. ombra
Sfrutta il vettore sole già calcolato con `sunECEF` per determinare se il satellite è illuminato o in eclisse. L'orbita cambia colore (ciano = sole, blu scuro = ombra) e un badge mostra il prossimo ingresso/uscita dall'ombra con countdown. Cruciale per il power budget di qualsiasi CubeSat reale.

### 4. Doppler shift per radioamatori
Con la velocità radiale satellite→ground station calcola lo shift Doppler in tempo reale. L'utente inserisce la frequenza nominale (es. 145.825 MHz per ISS APRS) e il pannello mostra la frequenza corretta da sintonizzare sul ricetrasmettitore. Funzionalità rara nelle web app satellite pubbliche.

### 5. Pass predictor con export .ics
Calcola i prossimi N passaggi sopra la posizione GPS dell'utente (o manuale). Lista con orario, elevazione massima, durata. Pulsante "Esporta in calendario" che genera un file `.ics` scaricabile — notifica automatica sul telefono prima di ogni passaggio.

### 6. Modalità AR / Bussola stellare (mobile)
Una schermata alternativa con bussola circolare che mostra azimut ed elevazione del satellite rispetto alla posizione GPS. Su mobile, agganciandosi a `DeviceOrientationEvent`, la bussola ruota col telefono: punti il dispositivo e trovi il satellite nel cielo. Perfetto per osservazioni a occhio nudo al tramonto.

### 7. Decadimento orbitale e stima rientro
Il TLE contiene già il termine BSTAR (drag) in riga 1. Usandolo insieme all'altitudine attuale si può stimare la vita orbitale residua. Visualizza una timeline che mostra come l'orbita scende nel tempo (settimane/mesi) con una stima "rientro previsto: ~data". Molto educativo e scientificamente corretto.

### 8. Catalogo satelliti con fetch live da Celestrak
Un pannello "Libreria" con categorie clickabili: ISS, Hubble, Starlink, MetOp, CubeSat universitari, detriti famosi. Al click l'app fa fetch dell'URL Celestrak corrispondente (pubblici, formato TXT) e carica il TLE aggiornato automaticamente — zero configurazione manuale.

### 9. Footprint di copertura comunicazione
Disegna il cerchio geografico entro cui il satellite è visibile sopra l'orizzonte (footprint), usando `EllipseGraphics` di Cesium. Per LEO si muove col satellite, per GEO rimane fisso. Ottimo per visualizzare copertura di satelliti meteo, GPS o comunicazione.

### 10. Replay storico con annotazioni eventi
Consenti di inserire una data/ora passata (o futura) come punto di partenza. Aggiungi layer di "eventi annotati" sulla timeline: eclissi solari, finestre di lancio, manovre orbitali note per l'ISS (pubbliche NASA). Una "macchina del tempo orbitale" educativa e affascinante, completamente fattibile con i dati attuali.

---

## 6. Priorità suggerita di intervento

| Priorità | Intervento | Impatto | Sforzo |
|---|---|---|---|
| Alta | Fix accesso `_property._times` | Stabilità | Basso |
| Alta | Aggiungere `styles.css` al service worker | Funzionamento offline | Minimo |
| Alta | Calcolare e mostrare il periodo orbitale reale | Correttezza | Minimo |
| Alta | Usare `prop.velocity` per la velocità | Accuratezza | Basso |
| Media | Fix deprecazioni Cesium (imageryProvider, terrain) | Compatibilità futura | Basso |
| Media | Catalog fetch da Celestrak (idea 8) | UX | Medio |
| Media | Ground station + AOS/LOS (idea 2) | Utilità reale | Medio |
| Media | Eclipse tracker (idea 3) | Realismo scientifico | Medio |
| Bassa | AR bussola mobile (idea 6) | Wow factor | Alto |
| Bassa | Pass predictor .ics (idea 5) | Utilità pratica | Alto |
