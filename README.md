# SmartPDF Editor

Web application (privacy-first) per caricare e modificare PDF direttamente nel browser, senza inviarli a server esterni.

## Funzionalità principali

### 1) Rendi compilabile (PDF non interattivi → PDF con campi)
- Anteprima del PDF nel browser (rendering con PDF.js).
- Rilevamento automatico “best effort” di aree compilabili (underline e checkbox glyph).
- Editor visuale: sposta/ridimensiona campi con drag & resize, elimina, aggiungi manualmente.
- Export “PDF compilabile” con campi modulo (AcroForm) tramite pdf-lib.

### 2) Template rebranding
- Anteprima del PDF nel browser (PDF.js).
- Overlay di elementi:
  - Testo: sovrascrive visivamente dati esistenti (opzione “sfondo bianco” per coprire il testo sottostante).
  - Logo: inserimento PNG/JPG, drag & resize, controllo opacità.
- Export:
  - PDF flat (testo/logo incorporati, campi appiattiti).
  - Template riutilizzabile (testi impostati come campi modulo variabili).

### Salvataggio progetto (locale)
- Salva/riprendi ultimo progetto in IndexedDB (fallback naturale del browser; nessun server).

## Requisiti privacy
- Tutta l’elaborazione avviene lato client (browser).
- I PDF non vengono caricati su server esterni.

## Setup sviluppo

Prerequisiti:
- Node.js (consigliato LTS)

Installazione:
```bash
npm install
```

Avvio dev server:
```bash
npm run dev
```

Build produzione:
```bash
npm run build
```

Lint:
```bash
npm run lint
```

## Demo rapida
- Apri l’app e usa:
  - “Demo Rendi compilabile” per generare un PDF di esempio con righe/checkbox da convertire.
  - “Demo Rebranding” per generare un PDF fittizio tipo contratto (header con ragione sociale).

## Architettura (high level)

Frontend (React + TypeScript):
- Rendering PDF: `pdfjs-dist` (PDF.js) con worker locale bundlato da Vite.
- Editing grafico: layer overlay sopra canvas + drag/resize con `react-rnd`.
- Export PDF: `pdf-lib`
  - Creazione campi modulo (text/checkbox).
  - Inserimento immagini (logo).
  - Flatten opzionale.
- Storage locale: `idb` (IndexedDB).

Flusso:
1) Upload PDF → bytes in memoria → PDF.js per anteprima.
2) L’utente aggiunge/modifica elementi overlay (coordinate in “punti PDF”).
3) Export → pdf-lib carica i bytes originali e scrive campi/testi/immagini sulle pagine.
4) Download via blob URL.

## Gestione casi limite
- PDF non valido/corrotto: errore gestito in UI (try/catch in fase di apertura).
- File troppo grandi: limite consigliato 50MB (blocco lato UI).
- PDF protetti: pdf-lib carica con `ignoreEncryption: true`, ma alcuni PDF protetti potrebbero fallire comunque.

## Limitazioni note (MVP)
- “Rileva campi” usa euristiche (underline e simboli checkbox): funziona bene su moduli semplici, ma non replica la qualità di Acrobat.
- Campo “firma”: esportato come campo testo (placeholder) per compatibilità con pdf-lib versione attuale.
- Upload multiplo: l’UI accetta selezione multipla, ma l’app apre il primo file.
- OCR non incluso (extra opzionale).
