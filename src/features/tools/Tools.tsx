import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnnotationFlags, PDFAcroSignature, PDFDocument, PDFName, PDFWidgetAnnotation, StandardFonts, degrees, rgb } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import type { PDFDocumentProxy } from '../../pdf/pdfjs'
import { loadPdfDocument } from '../../pdf/pdfjs'
import { PdfViewer } from '../../pdf/viewer/PdfViewer'
import type { WorkspaceElement } from '../../pdf/workspace/types'
import { downloadBytes, downloadText } from '../../utils/download'

type ToolId =
  | 'merge'
  | 'split'
  | 'extract'
  | 'delete'
  | 'reorder'
  | 'rotate'
  | 'pageNumbers'
  | 'watermark'
  | 'generateHydronicForm'
  | 'generateHydronicMaintenanceForm'
  | 'compressRaster'
  | 'unlockRaster'
  | 'extractText'

type ToolDef = {
  id: ToolId
  title: string
  subtitle: string
}

const TOOL_DEFS: ToolDef[] = [
  { id: 'merge', title: 'Unisci PDF', subtitle: 'Combina più PDF in un unico file.' },
  { id: 'split', title: 'Dividi PDF', subtitle: 'Separa un PDF in più file.' },
  { id: 'extract', title: 'Estrai pagine PDF', subtitle: 'Crea un PDF con le sole pagine scelte.' },
  { id: 'delete', title: 'Elimina pagine PDF', subtitle: 'Rimuovi pagine e scarica il PDF risultante.' },
  { id: 'reorder', title: 'Ordina pagine PDF', subtitle: 'Riordina le pagine con una lista numerica.' },
  { id: 'rotate', title: 'Ruota pagine PDF', subtitle: 'Ruota pagine selezionate (90/180/270).' },
  { id: 'pageNumbers', title: 'Aggiungi numeri di pagina', subtitle: 'Inserisce la numerazione sul PDF.' },
  { id: 'watermark', title: 'Aggiungi filigrana', subtitle: 'Testo semi-trasparente su tutte le pagine.' },
  { id: 'generateHydronicForm', title: 'Crea modulo intervento idronico', subtitle: 'Genera un PDF nuovo, simile al modello in foto, personalizzato con il tuo logo.' },
  {
    id: 'generateHydronicMaintenanceForm',
    title: 'Crea modulo manutenzioni idronici',
    subtitle: 'Come il modulo idronico, ma include anche la pagina manutenzioni (checklist) e le note.',
  },
  { id: 'compressRaster', title: 'Comprimi PDF', subtitle: 'Rasterizza e ricrea il PDF (perde testo/qualità).' },
  { id: 'unlockRaster', title: 'Sblocca PDF', subtitle: 'Rimuove protezioni rasterizzando (perde testo/qualità).' },
  { id: 'extractText', title: 'PDF OCR (testo)', subtitle: 'Estrae testo (se presente). Per scanner serve OCR server.' },
]

type Props = {
  onOpenEditor: () => void
}

export function Tools({ onOpenEditor }: Props) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)

  const active = useMemo(() => TOOL_DEFS.find((t) => t.id === activeTool) ?? null, [activeTool])

  if (!active) {
    return (
      <div className="toolsPage">
        <div className="toolsHeader">
          <div className="toolsTitle">Strumenti</div>
          <div className="toolsHint">
            Tutto gira nel browser. Se vuoi modificare campi compilabili o rebranding,
            usa l’editor.
          </div>
          <div className="toolsTopActions">
            <button className="btn btnPrimary" onClick={onOpenEditor} type="button">
              Apri editor
            </button>
          </div>
        </div>

        <div className="toolGrid">
          {TOOL_DEFS.map((t) => (
            <button
              key={t.id}
              className="toolCard"
              type="button"
              onClick={() => setActiveTool(t.id)}
            >
              <div className="toolCard__title">{t.title}</div>
              <div className="toolCard__subtitle">{t.subtitle}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="toolsPage">
      <div className="toolsHeader">
        <div className="toolsTitle">{active.title}</div>
        <div className="toolsHint">{active.subtitle}</div>
        <div className="toolsTopActions">
          <button className="btn" onClick={() => setActiveTool(null)} type="button">
            ← Indietro
          </button>
        </div>
      </div>
      <div className="toolPanel">
        <ToolBody toolId={active.id} />
      </div>
    </div>
  )
}

function ToolBody({ toolId }: { toolId: ToolId }) {
  if (toolId === 'merge') return <MergeTool />
  if (toolId === 'split') return <SplitTool />
  if (toolId === 'extract') return <ExtractTool />
  if (toolId === 'delete') return <DeleteTool />
  if (toolId === 'reorder') return <ReorderTool />
  if (toolId === 'rotate') return <RotateTool />
  if (toolId === 'pageNumbers') return <PageNumbersTool />
  if (toolId === 'watermark') return <WatermarkTool />
  if (toolId === 'generateHydronicForm') return <GenerateHydronicFormTool />
  if (toolId === 'generateHydronicMaintenanceForm') return <GenerateHydronicFormTool template="maintenance" />
  if (toolId === 'compressRaster') return <RasterTool mode="compress" />
  if (toolId === 'unlockRaster') return <RasterTool mode="unlock" />
  return <ExtractTextTool />
}

function readBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((ab) => new Uint8Array(ab))
}

function hexToRgb01(input: string): ReturnType<typeof rgb> {
  const raw = input.trim().replace(/^#/, '')
  const hex =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => `${c}${c}`)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return rgb(1, 1, 1)
  const n = Number.parseInt(hex, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return rgb(r / 255, g / 255, b / 255)
}

function PdfPreview({ file, password }: { file: File | null; password?: string }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.9)

  const docRef = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    return () => {
      void docRef.current?.destroy()
      docRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    setError(null)
    setIsLoading(false)
    setPdfDoc(null)

    if (!file) return

    setIsLoading(true)
    void (async () => {
      try {
        const bytes = await readBytes(file)
        if (cancelled) return

        const doc = await loadPdfDocument(bytes, password ? { password } : undefined)
        if (cancelled) {
          await doc.destroy()
          return
        }

        void docRef.current?.destroy()
        docRef.current = doc
        setPdfDoc(doc)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, password])

  if (!file) return null

  const elements = [] as WorkspaceElement[]

  return (
    <div className="toolPreview">
      <div className="toolPreviewBar">
        <div className="sidebarHint">
          {isLoading ? 'Caricamento anteprima…' : pdfDoc ? `Pagine totali: ${pdfDoc.numPages}` : 'Anteprima non disponibile.'}
        </div>
        <div className="toolPreviewZoom">
          <button
            className="btn btnSmall"
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
          >
            -
          </button>
          <div className="sidebarHint">{Math.round(zoom * 100)}%</div>
          <button
            className="btn btnSmall"
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}
          >
            +
          </button>
        </div>
      </div>

      {error ? <div className="errorBanner">{error}</div> : null}

      {pdfDoc ? (
        <div className="toolPreviewViewport">
          <PdfViewer
            pdfDoc={pdfDoc}
            zoom={zoom}
            elements={elements}
            selectedId={null}
            onSelect={() => {}}
            onElementChange={() => {}}
            onElementDelete={() => {}}
            onElementDuplicate={() => {}}
            drawKind={null}
            onCreateElement={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}

function parsePageList(
  input: string,
  totalPages: number,
): { ok: true; pages: number[] } | { ok: false; error: string } {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'Inserisci almeno una pagina o intervallo.' }
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  const out: number[] = []

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1 || n > totalPages) return { ok: false, error: `Pagina fuori range: ${part}` }
      out.push(n - 1)
      continue
    }
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (a < 1 || b < 1 || a > totalPages || b > totalPages) {
        return { ok: false, error: `Intervallo fuori range: ${part}` }
      }
      const start = Math.min(a, b)
      const end = Math.max(a, b)
      for (let n = start; n <= end; n += 1) out.push(n - 1)
      continue
    }
    return { ok: false, error: `Formato non valido: ${part}` }
  }

  const unique = Array.from(new Set(out)).sort((a, b) => a - b)
  return unique.length ? { ok: true, pages: unique } : { ok: false, error: 'Nessuna pagina valida.' }
}

function fileBaseName(name: string): string {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.pdf')) return name
  return name.slice(0, -4)
}

function MergeTool() {
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (files.length < 2) {
      setError('Carica almeno 2 PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outDoc = await PDFDocument.create()
      for (const f of files) {
        const bytes = await readBytes(f)
        const src = await PDFDocument.load(bytes)
        const copied = await outDoc.copyPages(src, src.getPageIndices())
        for (const p of copied) outDoc.addPage(p)
      }
      const outBytes = await outDoc.save()
      downloadBytes(outBytes, `unito_${Date.now()}.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [files])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF da unire</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => {
              const next = Array.from(e.target.files ?? [])
              setFiles(next)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <div className="sidebarHint">
        {files.length ? `Selezionati: ${files.map((f) => f.name).join(', ')}` : 'Nessun file selezionato.'}
      </div>
      {files.length ? <PdfPreview file={files[0]} /> : null}
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Unisci e scarica'}
      </button>
    </div>
  )
}

function SplitTool() {
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'each' | 'two'>('two')
  const [splitAt, setSplitAt] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const src = await PDFDocument.load(bytes)
      const total = src.getPageCount()
      const base = fileBaseName(file.name)

      if (mode === 'each') {
        for (let idx = 0; idx < total; idx += 1) {
          const out = await PDFDocument.create()
          const [p] = await out.copyPages(src, [idx])
          out.addPage(p)
          const outBytes = await out.save()
          downloadBytes(outBytes, `${base}_pag_${idx + 1}.pdf`)
        }
        return
      }

      const n = Number.parseInt(splitAt, 10)
      if (!Number.isFinite(n) || n < 1 || n >= total) {
        setError(`Inserisci un numero tra 1 e ${Math.max(1, total - 1)}.`)
        return
      }
      const leftPages = Array.from({ length: n }, (_, i) => i)
      const rightPages = Array.from({ length: total - n }, (_, i) => i + n)

      const out1 = await PDFDocument.create()
      const c1 = await out1.copyPages(src, leftPages)
      c1.forEach((p) => out1.addPage(p))
      downloadBytes(await out1.save(), `${base}_parte_1.pdf`)

      const out2 = await PDFDocument.create()
      const c2 = await out2.copyPages(src, rightPages)
      c2.forEach((p) => out2.addPage(p))
      downloadBytes(await out2.save(), `${base}_parte_2.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, mode, splitAt])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <div className="sidebarRow sidebarRowWrap">
        <button className={['btn btnSmall', mode === 'two' ? 'btnPrimary' : ''].filter(Boolean).join(' ')} type="button" onClick={() => setMode('two')}>
          In 2 parti
        </button>
        <button className={['btn btnSmall', mode === 'each' ? 'btnPrimary' : ''].filter(Boolean).join(' ')} type="button" onClick={() => setMode('each')}>
          Ogni pagina
        </button>
      </div>
      {mode === 'two' ? (
        <label className="field">
          <div className="fieldLabel">Dividi dopo la pagina</div>
          <input className="input" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} />
        </label>
      ) : null}
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Dividi e scarica'}
      </button>
    </div>
  )
}

function ExtractTool() {
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const src = await PDFDocument.load(bytes)
      const total = src.getPageCount()
      const parsed = parsePageList(pages, total)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, parsed.pages)
      copied.forEach((p) => out.addPage(p))
      const outBytes = await out.save()
      downloadBytes(outBytes, `${fileBaseName(file.name)}_estratto.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, pages])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Pagine (es: 1-3,5,7)</div>
        <input className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Estrai e scarica'}
      </button>
    </div>
  )
}

function DeleteTool() {
  const [file, setFile] = useState<File | null>(null)
  const [pagesToDelete, setPagesToDelete] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const src = await PDFDocument.load(bytes)
      const total = src.getPageCount()
      const parsed = parsePageList(pagesToDelete, total)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const toDelete = new Set(parsed.pages)
      const keep = Array.from({ length: total }, (_, i) => i).filter((i) => !toDelete.has(i))
      if (keep.length === 0) {
        setError('Stai eliminando tutte le pagine.')
        return
      }
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, keep)
      copied.forEach((p) => out.addPage(p))
      downloadBytes(await out.save(), `${fileBaseName(file.name)}_senza_pagine.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, pagesToDelete])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Pagine da eliminare (es: 1-3,5,7)</div>
        <input className="input" value={pagesToDelete} onChange={(e) => setPagesToDelete(e.target.value)} />
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Elimina e scarica'}
      </button>
    </div>
  )
}

function ReorderTool() {
  const [file, setFile] = useState<File | null>(null)
  const [order, setOrder] = useState('1,2,3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const src = await PDFDocument.load(bytes)
      const total = src.getPageCount()
      const raw = order.split(',').map((x) => x.trim()).filter(Boolean)
      if (raw.length !== total) {
        setError(`Inserisci esattamente ${total} numeri (tutte le pagine).`)
        return
      }
      const idxs = raw.map((x) => Number.parseInt(x, 10) - 1)
      if (idxs.some((n) => !Number.isFinite(n) || n < 0 || n >= total)) {
        setError('Ordine non valido: controlla i numeri.')
        return
      }
      const uniq = new Set(idxs)
      if (uniq.size !== total) {
        setError('Ordine non valido: ci sono duplicati o pagine mancanti.')
        return
      }
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, idxs)
      copied.forEach((p) => out.addPage(p))
      downloadBytes(await out.save(), `${fileBaseName(file.name)}_ordinato.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, order])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Nuovo ordine (es: 3,1,2)</div>
        <input className="input" value={order} onChange={(e) => setOrder(e.target.value)} />
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Ordina e scarica'}
      </button>
    </div>
  )
}

function RotateTool() {
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState('1')
  const [deg, setDeg] = useState<'90' | '180' | '270'>('90')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const src = await PDFDocument.load(bytes)
      const total = src.getPageCount()
      const parsed = parsePageList(pages, total)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, src.getPageIndices())
      copied.forEach((p) => out.addPage(p))
      const rotatePages = new Set(parsed.pages)
      const d = Number(deg)
      for (let i = 0; i < total; i += 1) {
        if (!rotatePages.has(i)) continue
        out.getPage(i).setRotation(degrees(d))
      }
      downloadBytes(await out.save(), `${fileBaseName(file.name)}_ruotato.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [deg, file, pages])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Pagine da ruotare (es: 1-3,5)</div>
        <input className="input" value={pages} onChange={(e) => setPages(e.target.value)} />
      </label>
      <label className="field">
        <div className="fieldLabel">Gradi</div>
        <select className="input" value={deg} onChange={(e) => setDeg(e.target.value as '90' | '180' | '270')}>
          <option value="90">90°</option>
          <option value="180">180°</option>
          <option value="270">270°</option>
        </select>
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Ruota e scarica'}
      </button>
    </div>
  )
}

function PageNumbersTool() {
  const [file, setFile] = useState<File | null>(null)
  const [startAt, setStartAt] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const start = Number.parseInt(startAt, 10)
      if (!Number.isFinite(start) || start < 1) {
        setError('Numero iniziale non valido.')
        return
      }
      const bytes = await readBytes(file)
      const doc = await PDFDocument.load(bytes)
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const pages = doc.getPages()
      for (let i = 0; i < pages.length; i += 1) {
        const p = pages[i]
        const text = String(start + i)
        const { width } = p.getSize()
        const size = 12
        const tw = font.widthOfTextAtSize(text, size)
        p.drawText(text, {
          x: Math.max(12, width / 2 - tw / 2),
          y: 16,
          size,
          font,
          color: rgb(0.1, 0.1, 0.1),
        })
      }
      downloadBytes(await doc.save(), `${fileBaseName(file.name)}_numerato.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, startAt])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Inizia da</div>
        <input className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Aggiungi numeri e scarica'}
      </button>
    </div>
  )
}

function WatermarkTool() {
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('CONFIDENZIALE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const doc = await PDFDocument.load(bytes)
      const font = await doc.embedFont(StandardFonts.HelveticaBold)
      const pages = doc.getPages()
      for (const p of pages) {
        const { width, height } = p.getSize()
        const size = Math.max(32, Math.min(72, Math.floor(Math.min(width, height) / 9)))
        const tw = font.widthOfTextAtSize(text, size)
        p.drawText(text, {
          x: Math.max(20, width / 2 - tw / 2),
          y: height / 2,
          size,
          font,
          color: rgb(0.75, 0.75, 0.75),
          opacity: 0.25,
          rotate: degrees(-35),
        })
      }
      downloadBytes(await doc.save(), `${fileBaseName(file.name)}_filigrana.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, text])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      <label className="field">
        <div className="fieldLabel">Testo filigrana</div>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Aggiungi filigrana e scarica'}
      </button>
    </div>
  )
}

type HydronicTemplate = 'standard' | 'maintenance'

function GenerateHydronicFormTool({ template = 'standard' }: { template?: HydronicTemplate } = {}) {
  const [companyName, setCompanyName] = useState('CLIMAX SRL')
  const [companySubline, setCompanySubline] = useState('Via…, Città… - P.IVA…')
  const [logo, setLogo] = useState<File | null>(null)
  const [logoBoxW, setLogoBoxW] = useState(220)
  const [logoBoxH, setLogoBoxH] = useState(46)
  const [fontFamily, setFontFamily] = useState<'helvetica' | 'times' | 'courier'>('helvetica')
  const [companyNameSize, setCompanyNameSize] = useState(16)
  const [companySublineSize, setCompanySublineSize] = useState(10)
  const [titleSize, setTitleSize] = useState(18)
  const [layoutMode, setLayoutMode] = useState<'standard' | 'riprogramma'>('standard')
  const [fieldBg, setFieldBg] = useState('#d5e0ff')
  const [headerBg, setHeaderBg] = useState('#e1eaff')
  const [showProgressivo, setShowProgressivo] = useState(true)
  const [showDataIntervento, setShowDataIntervento] = useState(true)
  const [showTracingNumber, setShowTracingNumber] = useState(true)
  const [showGaranzia, setShowGaranzia] = useState(true)
  const [showManutenzioneOrd, setShowManutenzioneOrd] = useState(true)
  const [showManutenzioneExtra, setShowManutenzioneExtra] = useState(true)
  const [showModelliMatricole, setShowModelliMatricole] = useState(true)
  const [includePage2, setIncludePage2] = useState(true)
  const [includePage3, setIncludePage3] = useState(true)
  const [includePage4, setIncludePage4] = useState(template === 'maintenance')
  const [rowsRicambi, setRowsRicambi] = useState(8)
  const [rowsIntervento, setRowsIntervento] = useState(8)
  const [busy, setBusy] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null)
  const [previewPdfDoc, setPreviewPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [previewZoom, setPreviewZoom] = useState(0.85)
  const previewDocRef = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    return () => {
      void previewDocRef.current?.destroy()
      previewDocRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setPreviewPdfDoc(null)
    if (!previewBytes) return
    void (async () => {
      try {
        const doc = await loadPdfDocument(previewBytes)
        if (cancelled) {
          await doc.destroy()
          return
        }
        void previewDocRef.current?.destroy()
        previewDocRef.current = doc
        setPreviewPdfDoc(doc)
      } catch {
        void 0
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewBytes])

  const buildPdfBytes = useCallback(async () => {
    const pdf = await PDFDocument.create()
    const form = pdf.getForm()

    const fontMap = {
      helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
      times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
      courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
    } as const

    const font = await pdf.embedFont(fontMap[fontFamily].regular)
    const fontBold = await pdf.embedFont(fontMap[fontFamily].bold)

    const fillBg = hexToRgb01(fieldBg)
    const headerBlue = hexToRgb01(headerBg)
    const border = rgb(0, 0, 0)

    const a4 = { w: 595.28, h: 841.89 }
    const margin = 40

    const logoBytes = logo ? await readBytes(logo) : null
    const embeddedLogo =
      logoBytes && logo
        ? (logo.type === 'image/png' || logo.name.toLowerCase().endsWith('.png')
            ? await pdf.embedPng(logoBytes)
            : await pdf.embedJpg(logoBytes))
        : null

    const drawBox = (
      page: PDFPage,
      x: number,
      y: number,
      width: number,
      height: number,
      fill?: ReturnType<typeof rgb>,
    ) => {
      page.drawRectangle({
        x,
        y,
        width,
        height,
        color: fill ?? rgb(1, 1, 1),
        borderColor: border,
        borderWidth: 1,
      })
    }

    const addTextField = (
      name: string,
      page: PDFPage,
      x: number,
      y: number,
      width: number,
      height: number,
      fontSize: number,
      fill?: ReturnType<typeof rgb>,
    ) => {
      drawBox(page, x, y, width, height, fill)
      const field = form.createTextField(name)
      field.addToPage(page, { x, y, width, height, font, borderWidth: 0 })
      try {
        field.setFontSize(fontSize)
      } catch {
        void 0
      }
    }

    const addMultilineTextField = (
      name: string,
      page: PDFPage,
      x: number,
      y: number,
      width: number,
      height: number,
      fontSize: number,
      fill?: ReturnType<typeof rgb>,
    ) => {
      drawBox(page, x, y, width, height, fill)
      const field = form.createTextField(name)
      try {
        field.enableMultiline()
      } catch {
        void 0
      }
      field.addToPage(page, { x, y, width, height, font, borderWidth: 0 })
      try {
        field.setFontSize(fontSize)
      } catch {
        void 0
      }
    }

    const addCheckBoxOnPage = (name: string, page: PDFPage, x: number, y: number, size: number) => {
      drawBox(page, x, y, size, size, rgb(1, 1, 1))
      const field = form.createCheckBox(name)
      field.addToPage(page, { x, y, width: size, height: size, borderWidth: 0 })
    }

    const addSignatureField = (
      name: string,
      page: PDFPage,
      x: number,
      y: number,
      width: number,
      height: number,
      fill?: ReturnType<typeof rgb>,
    ) => {
      drawBox(page, x, y, width, height, fill)

      const sigDict = pdf.context.obj({ FT: PDFName.of('Sig'), Kids: [] })
      const sigRef = pdf.context.register(sigDict)
      const sig = PDFAcroSignature.fromDict(sigDict, sigRef)
      sig.setPartialName(name)
      form.acroForm.addField(sigRef)

      const widget = PDFWidgetAnnotation.create(pdf.context, sigRef)
      widget.setRectangle({ x, y, width, height })
      widget.setP(page.ref)
      widget.setFlagTo(AnnotationFlags.Print, true)
      widget.setFlagTo(AnnotationFlags.Hidden, false)
      widget.setFlagTo(AnnotationFlags.Invisible, false)

      const widgetRef = pdf.context.register(widget.dict)
      sig.addWidget(widgetRef)
      page.node.addAnnot(widgetRef)
    }

      const drawLogo = (page: PDFPage, x: number, y: number, width: number, height: number) => {
        if (embeddedLogo) {
          const iw = embeddedLogo.width
          const ih = embeddedLogo.height
          const scale = Math.min(width / iw, height / ih)
          const dw = iw * scale
          const dh = ih * scale
          page.drawImage(embeddedLogo, {
            x: x + (width - dw) / 2,
            y: y + (height - dh) / 2,
            width: dw,
            height: dh,
          })
          return
        }
        drawBox(page, x, y, width, height, rgb(1, 1, 1))
        page.drawText('LOGO', {
          x: x + width / 2 - fontBold.widthOfTextAtSize('LOGO', 12) / 2,
          y: y + height / 2 - 5,
          size: 12,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        })
      }

      const wrapTextToWidth = (f: typeof font, text: string, size: number, maxWidth: number) => {
        const words = text.trim().split(/\s+/g).filter(Boolean)
        if (words.length === 0) return [] as string[]

        const splitLongWord = (w: string) => {
          if (f.widthOfTextAtSize(w, size) <= maxWidth) return [w]
          const parts = [] as string[]
          let rest = w
          while (rest.length > 0) {
            let lo = 1
            let hi = rest.length
            let best = 1
            while (lo <= hi) {
              const mid = Math.floor((lo + hi) / 2)
              const slice = rest.slice(0, mid)
              if (f.widthOfTextAtSize(slice, size) <= maxWidth) {
                best = mid
                lo = mid + 1
              } else {
                hi = mid - 1
              }
            }
            parts.push(rest.slice(0, best))
            rest = rest.slice(best)
          }
          return parts
        }

        const normalizedWords = words.flatMap(splitLongWord)
        const lines = [] as string[]
        let current = normalizedWords[0]
        for (let i = 1; i < normalizedWords.length; i += 1) {
          const candidate = `${current} ${normalizedWords[i]}`
          if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
            current = candidate
          } else {
            lines.push(current)
            current = normalizedWords[i]
          }
        }
        lines.push(current)
        return lines
      }

      const drawHeaderProgressivo = (page: PDFPage, topY: number, prefix: string) => {
        if (!showProgressivo) return
        const right = a4.w - margin
        const boxW = layoutMode === 'riprogramma' ? 170 : 215
        const labelSize = 9
        const boxX = right - boxW
        page.drawText('N. progressivo rapporto', { x: boxX, y: topY - 12, size: labelSize, font: fontBold })
        addTextField(`${prefix}_n_progressivo_rapporto`, page, boxX, topY - 32, boxW, 18, 11)
      }

      const drawHeaderLogo = (page: PDFPage, topY: number) => {
        const logoW = Math.max(80, Math.min(360, Math.round(logoBoxW)))
        const logoH = Math.max(20, Math.min(120, Math.round(logoBoxH)))
        const x = margin
        const y = topY - logoH
        drawLogo(page, x, y, logoW, logoH)
      }

      const drawCompanyRight = (page: PDFPage, topY: number, rightLimitX?: number, bottomLimitY?: number) => {
        const right = rightLimitX ?? a4.w - margin
        const leftMin = margin + Math.max(80, Math.min(360, Math.round(logoBoxW))) + 10
        const maxWidth = Math.max(60, right - leftMin)
        const name = (companyName || 'La mia azienda').trim()
        const sub = (companySubline || '').replace(/\r\n/g, '\n').trim()

        const logoH = Math.max(20, Math.min(120, Math.round(logoBoxH)))
        const maxHeightByLogo = Math.max(8, Math.min(120, logoH - 4))
        const maxHeightByBottom = bottomLimitY ? Math.max(8, Math.min(120, topY - bottomLimitY - 4)) : maxHeightByLogo
        const maxHeight = Math.max(8, Math.min(maxHeightByLogo, maxHeightByBottom))
        const minNameSize = 10
        const minSubSize = 7

        let fittedNameSize = Math.max(minNameSize, Math.min(24, Math.round(companyNameSize)))
        let fittedSubSize = Math.max(minSubSize, Math.min(16, Math.round(companySublineSize)))

        let nameLines: string[] = []
        let subLines: string[] = []
        let maxNameLines = 2
        let maxSubLines = 6
        for (let attempt = 0; attempt < 8; attempt += 1) {
          nameLines = name ? wrapTextToWidth(fontBold, name, fittedNameSize, maxWidth).slice(0, maxNameLines) : []
          const subLinesRaw = sub
            ? sub.split('\n').flatMap((line) => wrapTextToWidth(font, line, fittedSubSize, maxWidth))
            : []
          subLines = subLinesRaw.slice(0, maxSubLines)

          const nameH = nameLines.length > 0 ? nameLines.length * Math.max(12, fittedNameSize + 2) : 0
          const subH = subLines.length > 0 ? subLines.length * Math.max(10, fittedSubSize + 2) : 0
          const gapY = nameLines.length > 0 && subLines.length > 0 ? 2 : 0
          const totalH = nameH + gapY + subH

          if (totalH <= maxHeight) break
          if (maxSubLines > 0) {
            maxSubLines -= 1
            continue
          }
          if (maxNameLines > 1) {
            maxNameLines -= 1
            continue
          }
          fittedNameSize = Math.max(minNameSize, Math.floor(fittedNameSize * 0.9))
          fittedSubSize = Math.max(minSubSize, Math.floor(fittedSubSize * 0.9))
          if (fittedNameSize === minNameSize && fittedSubSize === minSubSize) break
        }

        const nameLineH = Math.max(12, fittedNameSize + 2)
        const subLineH = Math.max(10, fittedSubSize + 2)
        const totalH =
          (nameLines.length > 0 ? nameLines.length * nameLineH : 0) +
          (nameLines.length > 0 && subLines.length > 0 ? 2 : 0) +
          (subLines.length > 0 ? subLines.length * subLineH : 0)

        let y = topY - 12
        if (totalH > 0) y = y - Math.max(0, totalH - maxHeight)

        for (let i = 0; i < nameLines.length; i += 1) {
          const line = nameLines[i]
          const w = fontBold.widthOfTextAtSize(line, fittedNameSize)
          page.drawText(line, {
            x: Math.max(leftMin, right - w),
            y,
            size: fittedNameSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          })
          y -= nameLineH
        }

        if (subLines.length > 0) {
          if (nameLines.length > 0) y -= 2
          if (nameLines.length === 0) y = topY - 24
          for (let i = 0; i < subLines.length; i += 1) {
            const line = subLines[i]
            const w = font.widthOfTextAtSize(line, fittedSubSize)
            page.drawText(line, {
              x: Math.max(leftMin, right - w),
              y,
              size: fittedSubSize,
              font,
              color: rgb(0.2, 0.2, 0.2),
            })
            y -= subLineH
          }
        }
      }

      const drawSectionHeader = (page: PDFPage, x: number, y: number, width: number, title: string) => {
        page.drawRectangle({ x, y, width, height: 18, color: headerBlue, borderColor: border, borderWidth: 1 })
        page.drawText(title, { x: x + 8, y: y + 5, size: 10, font: fontBold })
      }

    const p1 = pdf.addPage([a4.w, a4.h])
      const p1Top = a4.h - margin

      drawHeaderLogo(p1, p1Top)
      const right = a4.w - margin

      const headerRightBoxW = layoutMode === 'riprogramma' ? 250 : 215
      const headerRightBoxX = right - headerRightBoxW
      const headerTopY = p1Top - Math.max(20, Math.min(120, Math.round(logoBoxH))) - 8
      const headerFieldLabelY = headerTopY - 12
      drawCompanyRight(p1, p1Top, right)
      let headerCursorY = headerFieldLabelY
      if (layoutMode === 'riprogramma' && showProgressivo && showDataIntervento) {
        const gap = 10
        const w = Math.floor((headerRightBoxW - gap) / 2)
        const leftX = right - headerRightBoxW
        const y = headerFieldLabelY
        p1.drawText('N. progressivo', { x: leftX, y, size: 9, font: fontBold })
        addTextField('p1_n_progressivo_rapporto', p1, leftX, y - 20, w, 18, 11)
        const x2 = leftX + w + gap
        p1.drawText('Data intervento', { x: x2, y, size: 9, font: fontBold })
        addTextField('p1_data_intervento', p1, x2, y - 20, w, 18, 11)
        headerCursorY = y - 38
      } else {
        if (showProgressivo) {
          p1.drawText('N. progressivo rapporto', { x: headerRightBoxX, y: headerCursorY, size: 9, font: fontBold })
          addTextField('p1_n_progressivo_rapporto', p1, headerRightBoxX, headerCursorY - 20, headerRightBoxW, 18, 11)
          headerCursorY -= 38
        }
        if (showDataIntervento) {
          p1.drawText('Data intervento', { x: headerRightBoxX, y: headerCursorY, size: 9, font: fontBold })
          addTextField('p1_data_intervento', p1, headerRightBoxX, headerCursorY - 20, headerRightBoxW, 18, 11)
          headerCursorY -= 38
        }
      }

      const title = 'MODULO INTERVENTO IDRONICI'
      const finalTitleSize = Math.max(12, Math.min(28, Math.round(titleSize)))
      const titleW = fontBold.widthOfTextAtSize(title, finalTitleSize)
      const titleY = Math.min(p1Top - 120, headerCursorY - 34)
      p1.drawText(title, {
        x: Math.max(margin, a4.w / 2 - titleW / 2),
        y: titleY,
        size: finalTitleSize,
        font: fontBold,
      })

      let cursorAfterTopRowY = titleY
      const topRowItems = [] as Array<{ kind: 'text' | 'checkbox'; label: string; name: string }>
      if (showTracingNumber) topRowItems.push({ kind: 'text', label: 'Tracing Number', name: 'p1_tracing_number' })
      if (showGaranzia) topRowItems.push({ kind: 'text', label: 'Garanzia', name: 'p1_garanzia' })
      if (showManutenzioneOrd) topRowItems.push({ kind: 'checkbox', label: 'Manutenzione Ord.', name: 'p1_manutenzione_ord' })
      if (showManutenzioneExtra) topRowItems.push({ kind: 'checkbox', label: 'Manutenzione Extra', name: 'p1_manutenzione_extra' })

      if (topRowItems.length > 0) {
        const rowY = titleY - 52
        cursorAfterTopRowY = rowY
        const rowX = margin
        const rowW = a4.w - margin * 2
        const rowH = 42
        drawBox(p1, rowX, rowY, rowW, rowH, rgb(1, 1, 1))
        const weights = topRowItems.map((i) => (i.kind === 'text' ? 2 : 1))
        const total = weights.reduce((a, b) => a + b, 0)
        let cx = rowX
        for (let i = 0; i < topRowItems.length; i += 1) {
          const item = topRowItems[i]
          const segW = Math.round((rowW * weights[i]) / total)
          if (i > 0) {
            p1.drawLine({ start: { x: cx, y: rowY }, end: { x: cx, y: rowY + rowH }, color: border, thickness: 1 })
          }
          p1.drawText(item.label, { x: cx + 10, y: rowY + 26, size: 9, font: fontBold })
          if (item.kind === 'text') {
            addTextField(item.name, p1, cx + 10, rowY + 6, Math.max(80, segW - 20), 16, 10, fillBg)
          } else {
            addCheckBoxOnPage(item.name, p1, cx + segW - 22, rowY + 10, 12)
          }
          cx += segW
        }
      }

      const sectionX = margin
      const sectionW = a4.w - margin * 2
      const sectionH = 132
      const gap = 18

      const addrGap = 10
      const addrViaW = 240
      const addrCittaW = 150
      const addrProvW = 35
      const addrCapW = 40
      const addrViaX = sectionX + 10
      const addrCittaX = addrViaX + addrViaW + addrGap
      const addrProvX = addrCittaX + addrCittaW + addrGap
      const addrCapX = addrProvX + addrProvW + addrGap

      let utenteTop = cursorAfterTopRowY - 40
      if (showModelliMatricole) {
        const machineH = 56
        const machineTop = cursorAfterTopRowY - 16
        drawBox(p1, sectionX, machineTop - machineH, sectionW, machineH, rgb(1, 1, 1))
        p1.drawText('Modello/i macchina', { x: sectionX + 10, y: machineTop - 18, size: 9, font: fontBold })
        p1.drawText('Matricola/e', { x: sectionX + 340, y: machineTop - 18, size: 9, font: fontBold })
        addMultilineTextField(
          'p1_modelli_macchina',
          p1,
          sectionX + 10,
          machineTop - 48,
          320,
          30,
          10,
          fillBg,
        )
        addMultilineTextField(
          'p1_matricole',
          p1,
          sectionX + 340,
          machineTop - 48,
          sectionW - 350,
          30,
          10,
          fillBg,
        )
        utenteTop = machineTop - machineH - 26
      }
      drawBox(p1, sectionX, utenteTop - sectionH, sectionW, sectionH, rgb(1, 1, 1))
      drawSectionHeader(p1, sectionX, utenteTop - 22, sectionW, 'Utente  Nome/Ragione sociale')
      addTextField('p1_utente_nome', p1, sectionX + 10, utenteTop - 46, sectionW - 20, 18, 10, fillBg)
      p1.drawText('Via', { x: sectionX + 10, y: utenteTop - 70, size: 9, font: fontBold })
      addTextField('p1_utente_via', p1, addrViaX, utenteTop - 90, addrViaW, 18, 10, fillBg)
      p1.drawText('Città', { x: addrCittaX, y: utenteTop - 70, size: 9, font: fontBold })
      addTextField('p1_utente_citta', p1, addrCittaX, utenteTop - 90, addrCittaW, 18, 10, fillBg)
      p1.drawText('Prov.', { x: addrProvX, y: utenteTop - 70, size: 9, font: fontBold })
      addTextField('p1_utente_prov', p1, addrProvX, utenteTop - 90, addrProvW, 18, 10, fillBg)
      p1.drawText('CAP', { x: addrCapX, y: utenteTop - 70, size: 9, font: fontBold })
      addTextField('p1_utente_cap', p1, addrCapX, utenteTop - 90, addrCapW, 18, 10, fillBg)
      p1.drawText('Tel', { x: sectionX + 10, y: utenteTop - 110, size: 9, font: fontBold })
      addTextField('p1_utente_tel', p1, sectionX + 10, utenteTop - 128, 140, 18, 10, fillBg)
      p1.drawText('Fax', { x: sectionX + 160, y: utenteTop - 110, size: 9, font: fontBold })
      addTextField('p1_utente_fax', p1, sectionX + 160, utenteTop - 128, 140, 18, 10, fillBg)
      p1.drawText('E-mail', { x: sectionX + 310, y: utenteTop - 110, size: 9, font: fontBold })
      addTextField('p1_utente_email', p1, sectionX + 310, utenteTop - 128, sectionW - 320, 18, 10, fillBg)

      const instTop = utenteTop - sectionH - gap
      drawBox(p1, sectionX, instTop - sectionH, sectionW, sectionH, rgb(1, 1, 1))
      drawSectionHeader(p1, sectionX, instTop - 22, sectionW, 'Centri servizi autorizzati  Nome/Ragione sociale')
      addTextField('p1_installatore_nome', p1, sectionX + 10, instTop - 46, sectionW - 20, 18, 10, fillBg)
      p1.drawText('Via', { x: sectionX + 10, y: instTop - 70, size: 9, font: fontBold })
      addTextField('p1_installatore_via', p1, addrViaX, instTop - 90, addrViaW, 18, 10, fillBg)
      p1.drawText('Città', { x: addrCittaX, y: instTop - 70, size: 9, font: fontBold })
      addTextField('p1_installatore_citta', p1, addrCittaX, instTop - 90, addrCittaW, 18, 10, fillBg)
      p1.drawText('Prov.', { x: addrProvX, y: instTop - 70, size: 9, font: fontBold })
      addTextField('p1_installatore_prov', p1, addrProvX, instTop - 90, addrProvW, 18, 10, fillBg)
      p1.drawText('CAP', { x: addrCapX, y: instTop - 70, size: 9, font: fontBold })
      addTextField('p1_installatore_cap', p1, addrCapX, instTop - 90, addrCapW, 18, 10, fillBg)
      p1.drawText('Tel', { x: sectionX + 10, y: instTop - 110, size: 9, font: fontBold })
      addTextField('p1_installatore_tel', p1, sectionX + 10, instTop - 128, 140, 18, 10, fillBg)
      p1.drawText('Fax', { x: sectionX + 160, y: instTop - 110, size: 9, font: fontBold })
      addTextField('p1_installatore_fax', p1, sectionX + 160, instTop - 128, 140, 18, 10, fillBg)
      p1.drawText('E-mail', { x: sectionX + 310, y: instTop - 110, size: 9, font: fontBold })
      addTextField('p1_installatore_email', p1, sectionX + 310, instTop - 128, sectionW - 320, 18, 10, fillBg)

      const respH = 44
      const respTop = instTop - sectionH - 12
      drawBox(p1, sectionX, respTop - respH, sectionW, respH, rgb(1, 1, 1))
      p1.drawText('Responsabile presente', { x: sectionX + 10, y: respTop - 16, size: 9, font: fontBold })
      addTextField('p1_responsabile_presente', p1, sectionX + 10, respTop - 36, sectionW - 20, 18, 10, fillBg)

      if (includePage2) {
        const p2 = pdf.addPage([a4.w, a4.h])
        const p2Top = a4.h - margin
        drawHeaderLogo(p2, p2Top)
        const right = a4.w - margin
        const headerTopY = p2Top - Math.max(20, Math.min(120, Math.round(logoBoxH))) - 8
        drawCompanyRight(p2, p2Top, right)
        drawHeaderProgressivo(p2, headerTopY, 'p2')

      const section2X = margin
      const section2W = a4.w - margin * 2
      let cursorY = Math.min(p2Top - 74, headerTopY - (showProgressivo ? 60 : 20))

      const drawBigField = (label: string, fieldName: string, height: number) => {
        p2.drawText(label, { x: section2X, y: cursorY - 12, size: 9, font: fontBold })
        addMultilineTextField(fieldName, p2, section2X, cursorY - 12 - height - 6, section2W, height, 10, fillBg)
        cursorY = cursorY - 12 - height - 18
      }

        drawBigField('Difetto lamentato', 'p2_difetto_lamentato', 64)
        drawBigField('Descrizione delle anomalie riscontrate', 'p2_descrizione_anomalie', 64)
        drawBigField(
          'Lavori eseguiti (nel caso di interventi/regolazioni di bruciatori di caldaie allegare obbligatoriamente l’analisi dei fumi)',
          'p2_lavori_eseguiti',
          82,
        )

      const sigTop = cursorY - 10
      drawBox(p2, section2X, sigTop - 80, section2W, 80, rgb(1, 1, 1))
      p2.drawLine({ start: { x: section2X + section2W / 2, y: sigTop - 80 }, end: { x: section2X + section2W / 2, y: sigTop }, color: border, thickness: 1 })
      p2.drawLine({ start: { x: section2X, y: sigTop - 40 }, end: { x: section2X + section2W, y: sigTop - 40 }, color: border, thickness: 1 })

      p2.drawText('Nome e cognome del tecnico in stampatello', { x: section2X + 6, y: sigTop - 14, size: 8, font: fontBold })
      p2.drawText('Nome e cognome cliente in stampatello', { x: section2X + section2W / 2 + 6, y: sigTop - 14, size: 8, font: fontBold })
      addTextField('p2_tecnico_nome', p2, section2X + 6, sigTop - 34, section2W / 2 - 12, 16, 10, fillBg)
      addTextField('p2_cliente_nome', p2, section2X + section2W / 2 + 6, sigTop - 34, section2W / 2 - 12, 16, 10, fillBg)

      p2.drawText('Firma del Tecnico', { x: section2X + 6, y: sigTop - 54, size: 8, font: fontBold })
      p2.drawText('Firma per accettazione', { x: section2X + section2W / 2 + 6, y: sigTop - 54, size: 8, font: fontBold })
      addSignatureField('p2_firma_tecnico', p2, section2X + 6, sigTop - 76, section2W / 2 - 12, 20, fillBg)
      addSignatureField('p2_firma_accettazione', p2, section2X + section2W / 2 + 6, sigTop - 76, section2W / 2 - 12, 20, fillBg)

      cursorY = sigTop - 96

      const tableGap = 22
      const tableH = 120
      const tableW = (section2W - tableGap) / 2
      const tableY = cursorY - tableH

      const drawTable = (
        page: PDFPage,
        x: number,
        y: number,
        width: number,
        height: number,
        title: string,
        headers: string[],
        colWidths: number[],
        rows: number,
        fieldPrefix: string,
      ) => {
        drawBox(page, x, y, width, height, rgb(1, 1, 1))
        page.drawText(title, { x: x - 24, y: y + height / 2 - 10, size: 8, font: fontBold, rotate: degrees(90) })
        const headerH = 16
        page.drawRectangle({ x, y: y + height - headerH, width, height: headerH, color: rgb(1, 1, 1), borderColor: border, borderWidth: 1 })

        let cx = x
        for (let i = 0; i < headers.length; i += 1) {
          page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y + height }, color: border, thickness: 1 })
          page.drawText(headers[i], { x: cx + 4, y: y + height - 12, size: 8, font: fontBold })
          cx += colWidths[i]
        }
        page.drawLine({ start: { x: x + width, y }, end: { x: x + width, y: y + height }, color: border, thickness: 1 })
        page.drawLine({ start: { x, y: y + height - headerH }, end: { x: x + width, y: y + height - headerH }, color: border, thickness: 1 })

        const rowH = (height - headerH) / rows
        for (let r = 0; r < rows; r += 1) {
          const ry = y + height - headerH - rowH * (r + 1)
          page.drawLine({ start: { x, y: ry }, end: { x: x + width, y: ry }, color: border, thickness: 1 })
          let fx = x
          for (let c = 0; c < headers.length; c += 1) {
            const fw = colWidths[c]
            addTextField(`${fieldPrefix}_${r}_${c}`, page, fx + 1, ry + 2, fw - 2, rowH - 4, 9, fillBg)
            fx += fw
          }
        }
      }

        drawTable(
          p2,
          section2X,
          tableY,
          tableW,
          tableH,
          'Ricambi',
          ['Qta', 'Descrizione', 'Codice'],
          [36, tableW - 36 - 74, 74],
          Math.max(1, Math.min(12, rowsRicambi)),
          'p2_ricambi',
        )

        drawTable(
          p2,
          section2X + tableW + tableGap,
          tableY,
          tableW,
          tableH,
          'Intervento',
          ['Descrizione', 'Codice', 'UM', 'Qta'],
          [tableW - 70 - 36 - 36, 70, 36, 36],
          Math.max(1, Math.min(12, rowsIntervento)),
          'p2_intervento',
        )
      }

      if (template === 'maintenance') {
        if (includePage3) {
          const p3 = pdf.addPage([a4.w, a4.h])
          const p3Top = a4.h - margin
          drawHeaderLogo(p3, p3Top)
          const right = a4.w - margin
          const headerTopY = p3Top - Math.max(20, Math.min(120, Math.round(logoBoxH))) - 8
          drawCompanyRight(p3, p3Top, right)
          drawHeaderProgressivo(p3, headerTopY, 'p3')

          const pageW = a4.w - margin * 2
          let cursorY = headerTopY - (showProgressivo ? 60 : 20)

          const manRowH = 22
          const manGap = 8
          const manBoxW = (pageW - manGap * 3) / 4
          const manY = cursorY - manRowH
          const manDefs = [
            { label: 'Man Basic', name: 'p3_man_basic' },
            { label: 'Man Special', name: 'p3_man_special' },
            { label: 'Man Hi Tech', name: 'p3_man_hi_tech' },
            { label: 'Man No Prob.', name: 'p3_man_no_prob' },
          ]
          for (let i = 0; i < manDefs.length; i += 1) {
            const x = margin + i * (manBoxW + manGap)
            drawBox(p3, x, manY, manBoxW, manRowH, rgb(1, 1, 1))
            p3.drawText(manDefs[i].label, { x: x + 6, y: manY + 7, size: 8, font: fontBold })
            addCheckBoxOnPage(manDefs[i].name, p3, x + manBoxW - 18, manY + 5, 12)
          }
          cursorY = manY - 16

          p3.drawText('Da compilare nel caso di interventi di manutenzione su sistemi idronici', {
            x: margin,
            y: cursorY,
            size: 9,
            font: fontBold,
          })
          cursorY -= 18

          const groupBoxH = 54
          drawBox(p3, margin, cursorY - groupBoxH, pageW, groupBoxH, rgb(1, 1, 1))
          p3.drawText('Modelli e Matricole dei gruppi', { x: margin + 6, y: cursorY - 14, size: 8, font: fontBold })
          addMultilineTextField(
            'p3_modelli_matricole_gruppi',
            p3,
            margin + 6,
            cursorY - groupBoxH + 6,
            pageW - 12,
            groupBoxH - 24,
            9,
            fillBg,
          )
          cursorY = cursorY - groupBoxH - 14

          const leftRows = [
            'Controllo perdite refrigerante',
            'Controllo verniciatura',
            'Controllo isolamento degli scambiatori',
            'Compilazione libretto impianto',
            'Valutazione capacità (compressore)',
            'Controllo motore',
            'Controllo sistema di lubrificazione',
            'Controllo funzionamento vano',
            'Controllo iniezione di liquido',
            'Controllo by-pass caldo',
            'Lavaggio condensatori numero volte l’anno',
            'Pulizia filtri UTA numero volte l’anno',
            'Verifica impianto con service checker',
          ]
          const rightRows = [
            'Controllo di funzionamento dei vari apparati',
            'Controllo dei sistemi di protezione',
            'Valutazione della capacità (condensatore)',
            'Pulizia filtri aria fan coil numero volte l’anno',
            'Analisi termometrica olio numero volte l’anno',
            'Verifica dei contattori',
            'Verifica impostazione del relè termico',
            'Controllo connessioni elettriche',
            'Valutazione della capacità (evaporatore)',
            'Valutazione della capacità (valvola espansione)',
          ]

          const maxRows = Math.max(leftRows.length, rightRows.length)
          const tableHeaderH = 22
          const rowH = 18
          const tableH = tableHeaderH + maxRows * rowH
          const tableY = cursorY - tableH
          const tableX = margin
          drawBox(p3, tableX, tableY, pageW, tableH, rgb(1, 1, 1))

          const halfW = pageW / 2
          const descW = Math.round(halfW * 0.68)
          const checkW = halfW - descW
          const colW = checkW / 3
          const midX = tableX + halfW

          const headerY = tableY + tableH - tableHeaderH
          p3.drawLine({ start: { x: tableX, y: headerY }, end: { x: tableX + pageW, y: headerY }, color: border, thickness: 1 })
          p3.drawLine({ start: { x: midX, y: tableY }, end: { x: midX, y: tableY + tableH }, color: border, thickness: 1 })

          const leftCheckX = tableX + descW
          const rightCheckX = midX + descW
          p3.drawLine({ start: { x: leftCheckX, y: tableY }, end: { x: leftCheckX, y: tableY + tableH }, color: border, thickness: 1 })
          p3.drawLine({ start: { x: rightCheckX, y: tableY }, end: { x: rightCheckX, y: tableY + tableH }, color: border, thickness: 1 })

          for (let i = 1; i < 3; i += 1) {
            p3.drawLine({
              start: { x: leftCheckX + colW * i, y: tableY },
              end: { x: leftCheckX + colW * i, y: tableY + tableH },
              color: border,
              thickness: 1,
            })
            p3.drawLine({
              start: { x: rightCheckX + colW * i, y: tableY },
              end: { x: rightCheckX + colW * i, y: tableY + tableH },
              color: border,
              thickness: 1,
            })
          }

          p3.drawText('CONTROLLO GRUPPO', { x: tableX + 4, y: headerY + 8, size: 7, font: fontBold })
          p3.drawText('CHECK', { x: leftCheckX + 4, y: headerY + 8, size: 7, font: fontBold })
          p3.drawText('CONTROLLI GENERALI', { x: midX + 4, y: headerY + 8, size: 7, font: fontBold })
          p3.drawText('CHECK', { x: rightCheckX + 4, y: headerY + 8, size: 7, font: fontBold })

          const checkLabels = ['SI', 'NO', 'PARZ.']
          for (let i = 0; i < checkLabels.length; i += 1) {
            p3.drawText(checkLabels[i], { x: leftCheckX + colW * i + 6, y: headerY + 2, size: 7, font: fontBold })
            p3.drawText(checkLabels[i], { x: rightCheckX + colW * i + 6, y: headerY + 2, size: 7, font: fontBold })
          }

          for (let r = 0; r < maxRows; r += 1) {
            const ry = headerY - rowH * (r + 1)
            p3.drawLine({ start: { x: tableX, y: ry }, end: { x: tableX + pageW, y: ry }, color: border, thickness: 1 })

            const leftLabel = leftRows[r]
            if (leftLabel) {
              p3.drawText(leftLabel, { x: tableX + 4, y: ry + 5, size: 7, font })
              for (let c = 0; c < 3; c += 1) {
                addCheckBoxOnPage(`p3_cg_${r}_${c}`, p3, leftCheckX + colW * c + 7, ry + 4, 10)
              }
            }

            const rightLabel = rightRows[r]
            if (rightLabel) {
              p3.drawText(rightLabel, { x: midX + 4, y: ry + 5, size: 7, font })
              for (let c = 0; c < 3; c += 1) {
                addCheckBoxOnPage(`p3_cgen_${r}_${c}`, p3, rightCheckX + colW * c + 7, ry + 4, 10)
              }
            }
          }

          cursorY = tableY - 14
          p3.drawText('NOTE/EVENTUALI ANOMALIE RISCONTRATE', { x: margin, y: cursorY, size: 8, font: fontBold })
          const notesTop = cursorY - 12
          const notesY = margin
          const notesH = Math.max(20, notesTop - notesY)
          drawBox(p3, margin, notesY, pageW, notesH, rgb(1, 1, 1))
          addMultilineTextField('p3_note_anomalie', p3, margin + 6, notesY + 6, pageW - 12, notesH - 12, 9, fillBg)
        }

        if (includePage4) {
          const p4 = pdf.addPage([a4.w, a4.h])
          const p4Top = a4.h - margin
          drawHeaderLogo(p4, p4Top)
          const right = a4.w - margin
          const headerTopY = p4Top - Math.max(20, Math.min(120, Math.round(logoBoxH))) - 8
          drawCompanyRight(p4, p4Top, right)
          drawHeaderProgressivo(p4, headerTopY, 'p4')

          const notesTop = Math.min(p4Top - 80, headerTopY - (showProgressivo ? 60 : 20))
          p4.drawText('Note Aggiuntive', { x: margin, y: notesTop - 12, size: 9, font: fontBold })
          addMultilineTextField(
            'p4_note_aggiuntive',
            p4,
            margin,
            margin,
            a4.w - margin * 2,
            Math.max(60, notesTop - margin - 24),
            10,
            fillBg,
          )
        }
      } else if (includePage3) {
        const p3 = pdf.addPage([a4.w, a4.h])
        const p3Top = a4.h - margin
        drawHeaderLogo(p3, p3Top)
        const right = a4.w - margin
        const headerTopY = p3Top - Math.max(20, Math.min(120, Math.round(logoBoxH))) - 8
        drawCompanyRight(p3, p3Top, right)
        drawHeaderProgressivo(p3, headerTopY, 'p3')

        const notesTop = Math.min(p3Top - 80, headerTopY - (showProgressivo ? 60 : 20))
        const signatureH = 60
        const signatureGap = 18
        const signatureY = margin
        const signatureW = (a4.w - margin * 2 - signatureGap) / 2
        const notesBottom = signatureY + signatureH + 18

        p3.drawText('Note Aggiuntive', { x: margin, y: notesTop - 12, size: 9, font: fontBold })
        addMultilineTextField(
          'p3_note_aggiuntive',
          p3,
          margin,
          notesBottom,
          a4.w - margin * 2,
          Math.max(60, notesTop - notesBottom - 24),
          10,
          fillBg,
        )

        drawBox(p3, margin, signatureY, signatureW, signatureH, rgb(1, 1, 1))
        drawBox(p3, margin + signatureW + signatureGap, signatureY, signatureW, signatureH, rgb(1, 1, 1))
        p3.drawText('Firma tecnico', { x: margin + 8, y: signatureY + signatureH - 14, size: 9, font: fontBold })
        p3.drawText('Firma cliente', { x: margin + signatureW + signatureGap + 8, y: signatureY + signatureH - 14, size: 9, font: fontBold })
        addSignatureField('p3_firma_tecnico', p3, margin + 8, signatureY + 8, signatureW - 16, signatureH - 26, fillBg)
        addSignatureField(
          'p3_firma_cliente',
          p3,
          margin + signatureW + signatureGap + 8,
          signatureY + 8,
          signatureW - 16,
          signatureH - 26,
          fillBg,
        )
      }

      try {
        form.updateFieldAppearances(font)
      } catch {
        void 0
      }

    return await pdf.save({ updateFieldAppearances: false })
  }, [
    companyName,
    companySubline,
    companyNameSize,
    companySublineSize,
    fieldBg,
    fontFamily,
    headerBg,
    includePage2,
    includePage3,
    includePage4,
    layoutMode,
    logo,
    logoBoxH,
    logoBoxW,
    rowsIntervento,
    rowsRicambi,
    showDataIntervento,
    showGaranzia,
    showManutenzioneExtra,
    showManutenzioneOrd,
    showModelliMatricole,
    showProgressivo,
    showTracingNumber,
    template,
    titleSize,
  ])

  const onUpdatePreview = useCallback(async () => {
    setError(null)
    setPreviewBusy(true)
    try {
      const bytes = await buildPdfBytes()
      setPreviewBytes(bytes)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setPreviewBusy(false)
    }
  }, [buildPdfBytes])

  const prevLayoutModeRef = useRef(layoutMode)
  useEffect(() => {
    const layoutChanged = prevLayoutModeRef.current !== layoutMode
    prevLayoutModeRef.current = layoutMode
    if (!layoutChanged) return
    if (!previewBytes) return
    void onUpdatePreview()
  }, [layoutMode, onUpdatePreview, previewBytes])

  const onDownload = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const bytes = await buildPdfBytes()
      const safeName =
        (companyName || 'azienda')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 24) || 'azienda'
      const prefix = template === 'maintenance' ? 'modulo_manutenzioni_idronici' : 'modulo_intervento_idronico'
      downloadBytes(bytes, `${prefix}_${safeName}.pdf`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [buildPdfBytes, companyName, template])

  return (
    <div className="toolForm">
      <div className="noticeBanner">
        {template === 'maintenance'
          ? 'Questo modulo include anche la pagina manutenzioni (checklist). “Riprogramma” applica un layout alternativo (sempre fac-simile del modulo).'
          : 'Questa versione rimane lo standard. “Riprogramma” applica un layout alternativo (sempre fac-simile del modulo).'}
      </div>
      <div className="sidebarRow">
        <button
          className={layoutMode === 'standard' ? 'btn btnPrimary' : 'btn'}
          type="button"
          disabled={busy || previewBusy}
          onClick={() => {
            setLayoutMode('standard')
            setLogoBoxW(220)
            setLogoBoxH(46)
            setFontFamily('helvetica')
            setCompanyNameSize(16)
            setCompanySublineSize(10)
            setTitleSize(18)
          }}
        >
          Standard
        </button>
        <button
          className={layoutMode === 'riprogramma' ? 'btn btnPrimary' : 'btn'}
          type="button"
          disabled={busy || previewBusy}
          onClick={() => {
            setLayoutMode('riprogramma')
            setLogoBoxW(250)
            setLogoBoxH(54)
            setCompanyNameSize(15)
            setCompanySublineSize(9)
            setTitleSize(18)
          }}
        >
          Riprogramma
        </button>
      </div>
      <label className="field">
        <div className="fieldLabel">Ragione sociale</div>
        <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      </label>
      <label className="field">
        <div className="fieldLabel">Riga secondaria (indirizzo / P.IVA)</div>
        <textarea className="input" value={companySubline} onChange={(e) => setCompanySubline(e.target.value)} rows={3} />
      </label>
      <div className="field">
        <div className="fieldLabel">Logo (PNG o JPG)</div>
        <label className="btn">
          Seleziona logo…
          <input
            className="fileInput"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              setLogo(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {logo ? <div className="sidebarHint">Selezionato: {logo.name}</div> : null}

      <label className="field">
        <div className="fieldLabel">Dimensione logo (larghezza)</div>
        <input
          className="input"
          type="number"
          min={80}
          max={360}
          value={logoBoxW}
          onChange={(e) => setLogoBoxW(Math.max(80, Math.min(360, Number(e.target.value || '220'))))}
        />
      </label>
      <label className="field">
        <div className="fieldLabel">Dimensione logo (altezza)</div>
        <input
          className="input"
          type="number"
          min={20}
          max={120}
          value={logoBoxH}
          onChange={(e) => setLogoBoxH(Math.max(20, Math.min(120, Number(e.target.value || '46'))))}
        />
      </label>

      <label className="field">
        <div className="fieldLabel">Font</div>
        <select className="input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}>
          <option value="helvetica">Helvetica</option>
          <option value="times">Times</option>
          <option value="courier">Courier</option>
        </select>
      </label>
      <label className="field">
        <div className="fieldLabel">Dimensione ragione sociale</div>
        <input
          className="input"
          type="number"
          min={10}
          max={24}
          value={companyNameSize}
          onChange={(e) => setCompanyNameSize(Math.max(10, Math.min(24, Number(e.target.value || '16'))))}
        />
      </label>
      <label className="field">
        <div className="fieldLabel">Dimensione riga secondaria</div>
        <input
          className="input"
          type="number"
          min={7}
          max={16}
          value={companySublineSize}
          onChange={(e) => setCompanySublineSize(Math.max(7, Math.min(16, Number(e.target.value || '10'))))}
        />
      </label>
      <label className="field">
        <div className="fieldLabel">Dimensione titolo</div>
        <input
          className="input"
          type="number"
          min={12}
          max={28}
          value={titleSize}
          onChange={(e) => setTitleSize(Math.max(12, Math.min(28, Number(e.target.value || '18'))))}
        />
      </label>

      <div className="noticeBanner">
        Modifica le opzioni e poi premi “Aggiorna anteprima”. Quando sei soddisfatto, premi “Scarica PDF”.
      </div>

      <label className="field">
        <div className="fieldLabel">Colore campi (background)</div>
        <input className="input" type="color" value={fieldBg} onChange={(e) => setFieldBg(e.target.value)} />
      </label>
      <label className="field">
        <div className="fieldLabel">Colore intestazioni (background)</div>
        <input className="input" type="color" value={headerBg} onChange={(e) => setHeaderBg(e.target.value)} />
      </label>

      <div className="noticeBanner">
        Caselle / sezioni (attiva o disattiva ciò che vuoi nel modulo)
      </div>
      <label className="field fieldInline">
        <input type="checkbox" checked={showProgressivo} onChange={(e) => setShowProgressivo(e.target.checked)} />
        <div className="fieldLabel">N. progressivo rapporto</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showDataIntervento} onChange={(e) => setShowDataIntervento(e.target.checked)} />
        <div className="fieldLabel">Data intervento</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showTracingNumber} onChange={(e) => setShowTracingNumber(e.target.checked)} />
        <div className="fieldLabel">Tracing Number</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showGaranzia} onChange={(e) => setShowGaranzia(e.target.checked)} />
        <div className="fieldLabel">Garanzia</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showManutenzioneOrd} onChange={(e) => setShowManutenzioneOrd(e.target.checked)} />
        <div className="fieldLabel">Manutenzione Ord.</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showManutenzioneExtra} onChange={(e) => setShowManutenzioneExtra(e.target.checked)} />
        <div className="fieldLabel">Manutenzione Extra</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={showModelliMatricole} onChange={(e) => setShowModelliMatricole(e.target.checked)} />
        <div className="fieldLabel">Modello/i + Matricola/e</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={includePage2} onChange={(e) => setIncludePage2(e.target.checked)} />
        <div className="fieldLabel">Includi pagina 2 (difetti / firme / tabelle)</div>
      </label>
      <label className="field fieldInline">
        <input type="checkbox" checked={includePage3} onChange={(e) => setIncludePage3(e.target.checked)} />
        <div className="fieldLabel">
          {template === 'maintenance' ? 'Includi pagina 3 (manutenzioni / checklist)' : 'Includi pagina 3 (note aggiuntive)'}
        </div>
      </label>
      {template === 'maintenance' ? (
        <label className="field fieldInline">
          <input type="checkbox" checked={includePage4} onChange={(e) => setIncludePage4(e.target.checked)} />
          <div className="fieldLabel">Includi pagina 4 (note aggiuntive)</div>
        </label>
      ) : null}

      {includePage2 ? (
        <>
          <label className="field">
            <div className="fieldLabel">Righe tabella Ricambi (1–12)</div>
            <input
              className="input"
              type="number"
              min={1}
              max={12}
              value={rowsRicambi}
              onChange={(e) => setRowsRicambi(Math.max(1, Math.min(12, Number(e.target.value || '8'))))}
            />
          </label>
          <label className="field">
            <div className="fieldLabel">Righe tabella Intervento (1–12)</div>
            <input
              className="input"
              type="number"
              min={1}
              max={12}
              value={rowsIntervento}
              onChange={(e) => setRowsIntervento(Math.max(1, Math.min(12, Number(e.target.value || '8'))))}
            />
          </label>
        </>
      ) : null}

      {error ? <div className="errorBanner">{error}</div> : null}

      <div className="sidebarRow">
        <button className="btn" disabled={previewBusy || busy} onClick={() => void onUpdatePreview()} type="button">
          {previewBusy ? 'Genero anteprima…' : 'Aggiorna anteprima'}
        </button>
        <button className="btn btnPrimary" disabled={busy || previewBusy} onClick={() => void onDownload()} type="button">
          {busy ? 'Genero…' : 'Scarica PDF'}
        </button>
      </div>

      {previewPdfDoc ? (
        <div className="toolPreview">
          <div className="toolPreviewBar">
            <div className="sidebarHint">Pagine generate: {previewPdfDoc.numPages}</div>
            <div className="toolPreviewZoom">
              <button
                className="btn btnSmall"
                type="button"
                onClick={() => setPreviewZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
              >
                -
              </button>
              <div className="sidebarHint">{Math.round(previewZoom * 100)}%</div>
              <button
                className="btn btnSmall"
                type="button"
                onClick={() => setPreviewZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))}
              >
                +
              </button>
            </div>
          </div>
          <div className="toolPreviewViewport">
            <PdfViewer
              pdfDoc={previewPdfDoc}
              zoom={previewZoom}
              elements={[]}
              selectedId={null}
              onSelect={() => {}}
              onElementChange={() => {}}
              onElementDelete={() => {}}
              onElementDuplicate={() => {}}
              drawKind={null}
              onCreateElement={() => {}}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RasterTool({ mode }: { mode: 'compress' | 'unlock' }) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [scale, setScale] = useState<'1' | '1.5' | '2'>('1.5')
  const [quality, setQuality] = useState<'0.6' | '0.75' | '0.9'>('0.75')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const doc = await loadPdfDocument(bytes, { password: password || undefined })

      const out = await PDFDocument.create()
      for (let i = 0; i < doc.numPages; i += 1) {
        const page = await doc.getPage(i + 1)
        const vp = page.getViewport({ scale: Number(scale) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(vp.width))
        canvas.height = Math.max(1, Math.floor(vp.height))
        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas 2D non disponibile.')
        const task = page.render({ canvasContext: ctx, canvas, viewport: vp, intent: 'display' })
        await task.promise
        const dataUrl = canvas.toDataURL('image/jpeg', Number(quality))
        const imgBytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer())
        const img = await out.embedJpg(imgBytes)
        const p = out.addPage([vp.width, vp.height])
        p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height })
      }

      const suffix = mode === 'unlock' ? 'sbloccato' : 'compresso'
      downloadBytes(await out.save(), `${fileBaseName(file.name)}_${suffix}.pdf`)
      await doc.destroy()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file, mode, password, quality, scale])

  return (
    <div className="toolForm">
      <div className="noticeBanner">
        Questo strumento ricrea il PDF come immagini: perde testo selezionabile e qualità.
      </div>
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <label className="field">
        <div className="fieldLabel">Password (se protetto)</div>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <PdfPreview file={file} password={password || undefined} />
      <div className="sidebarRow sidebarRowWrap">
        <label className="field" style={{ minWidth: 180 }}>
          <div className="fieldLabel">Risoluzione</div>
          <select className="input" value={scale} onChange={(e) => setScale(e.target.value as '1' | '1.5' | '2')}>
            <option value="1">Bassa</option>
            <option value="1.5">Media</option>
            <option value="2">Alta</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 180 }}>
          <div className="fieldLabel">Qualità JPEG</div>
          <select className="input" value={quality} onChange={(e) => setQuality(e.target.value as '0.6' | '0.75' | '0.9')}>
            <option value="0.6">0.60</option>
            <option value="0.75">0.75</option>
            <option value="0.9">0.90</option>
          </select>
        </label>
      </div>
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : mode === 'unlock' ? 'Sblocca e scarica' : 'Comprimi e scarica'}
      </button>
    </div>
  )
}

function ExtractTextTool() {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onRun = useCallback(async () => {
    if (!file) {
      setError('Carica un PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = await readBytes(file)
      const doc = await loadPdfDocument(bytes)
      const all: string[] = []
      for (let i = 0; i < doc.numPages; i += 1) {
        const page = await doc.getPage(i + 1)
        const content = await page.getTextContent()
        const items = content.items as Array<{ str?: unknown }>
        const pageText = items.map((it) => String(it.str ?? '')).join(' ').replace(/\s+/g, ' ').trim()
        all.push(`--- Pagina ${i + 1} ---\n${pageText}\n`)
      }
      await doc.destroy()
      const text = all.join('\n')
      if (!text.replace(/\s+/g, '').length) {
        setError('Nessun testo estratto. Se è un PDF scannerizzato, serve OCR (non incluso in versione browser-only).')
        return
      }
      downloadText(text, `${fileBaseName(file.name)}.txt`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [file])

  return (
    <div className="toolForm">
      <div className="field">
        <div className="fieldLabel">PDF</div>
        <label className="btn">
          Seleziona PDF…
          <input
            className="fileInput"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {file ? <div className="sidebarHint">Selezionato: {file.name}</div> : null}
      <PdfPreview file={file} />
      {error ? <div className="errorBanner">{error}</div> : null}
      <button className="btn btnPrimary" disabled={busy} onClick={() => void onRun()} type="button">
        {busy ? 'Elaboro…' : 'Estrai testo e scarica .txt'}
      </button>
    </div>
  )
}
