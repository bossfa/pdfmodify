import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../pdfjs'
import { loadPdfDocument } from '../pdfjs'
import type {
  FillableFieldElement,
  PdfProjectMode,
  PdfWorkspaceProject,
  RebrandElement,
  WorkspaceElement,
} from './types'
import { PdfViewer } from '../viewer/PdfViewer'
import { detectFillableFields } from '../detect/detectFillableFields'
import { exportFillablePdf } from '../export/exportFillablePdf'
import { exportRebrandedPdf } from '../export/exportRebrandedPdf'
import { downloadBytes } from '../../utils/download'
import { readImageFile } from '../../utils/images'

function isFillableElement(el: WorkspaceElement): el is FillableFieldElement {
  return el.feature === 'fillable'
}

function isRebrandElement(el: WorkspaceElement): el is RebrandElement {
  return el.feature === 'rebrand'
}

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height

  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

type Props = {
  mode: PdfProjectMode
  project: PdfWorkspaceProject
  onProjectChange: (next: PdfWorkspaceProject) => void
  onUpload: (file: File) => void
  onError: (message: string | null) => void
}

export function PdfWorkspace({
  mode,
  project,
  onProjectChange,
  onUpload,
  onError,
}: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [isLoadingPdf, setIsLoadingPdf] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pageInput, setPageInput] = useState('1')
  const [drawKind, setDrawKind] = useState<FillableFieldElement['kind'] | null>(
    null,
  )
  const dropRef = useRef<HTMLDivElement | null>(null)
  const [, setHistoryTick] = useState(0)
  const historyPastRef = useRef<
    Array<{ elements: WorkspaceElement[]; selectedId: string | null }>
  >([])
  const historyFutureRef = useRef<
    Array<{ elements: WorkspaceElement[]; selectedId: string | null }>
  >([])
  const historyProjectIdRef = useRef<string | null>(null)
  const isRestoringHistoryRef = useRef(false)

  useEffect(() => {
    if (historyProjectIdRef.current !== project.id) {
      historyProjectIdRef.current = project.id
      historyPastRef.current = []
      historyFutureRef.current = []
      setHistoryTick((n) => n + 1)
    }
  }, [project.id])

  useEffect(() => {
    let cancelled = false
    setIsLoadingPdf(true)
    setPdfDoc(null)
    onError(null)

    void (async () => {
      try {
        const doc = await loadPdfDocument(project.originalBytes)
        if (cancelled) return
        setPdfDoc(doc)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        onError(`Impossibile aprire il PDF: ${message}`)
      } finally {
        if (!cancelled) setIsLoadingPdf(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [onError, project.originalBytes])

  useEffect(() => {
    if (mode !== 'fillable' && drawKind) setDrawKind(null)
  }, [drawKind, mode])

  useEffect(() => {
    let changed = false
    const next = project.elements.map((el) => {
      if (el.feature !== 'fillable') return el
      const anyEl = el as unknown as { background?: unknown; kind?: unknown }
      if (anyEl.background === 'white' || anyEl.background === 'none') return el
      changed = true
      const kind = (anyEl.kind === 'checkbox' ? 'checkbox' : anyEl.kind) as
        | 'text'
        | 'checkbox'
        | 'signature'
      return {
        ...el,
        background: kind === 'checkbox' ? 'none' : 'white',
      } as WorkspaceElement
    })
    if (changed) onProjectChange({ ...project, elements: next })
  }, [onProjectChange, project])

  const elements = useMemo(() => {
    if (mode === 'fillable') return project.elements.filter(isFillableElement)
    return project.elements.filter(isRebrandElement)
  }, [mode, project.elements])

  const selected = useMemo(
    () => elements.find((e) => e.id === selectedId) ?? null,
    [elements, selectedId],
  )

  const pushHistorySnapshot = useCallback(() => {
    if (isRestoringHistoryRef.current) return
    historyPastRef.current.push({
      elements: project.elements,
      selectedId,
    })
    if (historyPastRef.current.length > 60) historyPastRef.current.shift()
    historyFutureRef.current = []
    setHistoryTick((n) => n + 1)
  }, [project.elements, selectedId])

  const canUndo = historyPastRef.current.length > 0

  const undo = useCallback(() => {
    const past = historyPastRef.current
    if (past.length === 0) return
    const prev = past.pop()
    if (!prev) return
    historyFutureRef.current.unshift({
      elements: project.elements,
      selectedId,
    })
    isRestoringHistoryRef.current = true
    setSelectedId(prev.selectedId)
    onProjectChange({ ...project, elements: prev.elements })
    isRestoringHistoryRef.current = false
    setHistoryTick((n) => n + 1)
  }, [onProjectChange, project, selectedId])

  const setElements = useCallback(
    (nextElements: WorkspaceElement[]) => {
      pushHistorySnapshot()
      onProjectChange({ ...project, elements: nextElements })
    },
    [onProjectChange, project, pushHistorySnapshot],
  )

  const updateElement = useCallback(
    (id: string, patch: Partial<WorkspaceElement>) => {
      pushHistorySnapshot()
      const next = project.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as WorkspaceElement) : el,
      )
      onProjectChange({ ...project, elements: next })
    },
    [onProjectChange, project, pushHistorySnapshot],
  )

  const deleteElement = useCallback(
    (id: string) => {
      pushHistorySnapshot()
      const next = project.elements.filter((el) => el.id !== id)
      if (selectedId === id) setSelectedId(null)
      onProjectChange({ ...project, elements: next })
    },
    [onProjectChange, project, pushHistorySnapshot, selectedId],
  )

  const duplicateElement = useCallback(
    (id: string) => {
      const el = project.elements.find((e) => e.id === id)
      if (!el) return
      pushHistorySnapshot()
      const nextId = crypto.randomUUID()
      const offset = 10
      const nextEl: WorkspaceElement = {
        ...(el as WorkspaceElement),
        id: nextId,
        rect: {
          ...el.rect,
          x: el.rect.x + offset,
          y: el.rect.y + offset,
        },
      } as WorkspaceElement
      if (nextEl.feature === 'fillable') {
        ;(nextEl as FillableFieldElement).name = `${nextEl.kind}_${nextId.slice(0, 6)}`
      } else if (nextEl.feature === 'rebrand' && nextEl.kind === 'text') {
        nextEl.fieldName = `field_${nextId.slice(0, 6)}`
      }
      onProjectChange({ ...project, elements: [...project.elements, nextEl] })
      setSelectedId(nextId)
    },
    [onProjectChange, project, pushHistorySnapshot],
  )

  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      const tag = el.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      return el.isContentEditable === true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      const key = e.key.toLowerCase()
      if (key === 'escape') {
        setDrawKind(null)
        return
      }

      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        undo()
        return
      }

      if ((key === 'delete' || key === 'backspace') && selectedId) {
        e.preventDefault()
        deleteElement(selectedId)
        return
      }

      if (mode === 'fillable') {
        if (key === 't') {
          setDrawKind((k) => (k === 'text' ? null : 'text'))
          return
        }
        if (key === 'c') {
          setDrawKind((k) => (k === 'checkbox' ? null : 'checkbox'))
          return
        }
        if (key === 's') {
          setDrawKind((k) => (k === 'signature' ? null : 'signature'))
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteElement, mode, selectedId, undo])

  const onZoomChange = useCallback(
    (zoom: number) => {
      onProjectChange({ ...project, ui: { ...project.ui, zoom } })
    },
    [onProjectChange, project],
  )

  const scrollToPage = useCallback((pageIndex: number) => {
    const el = document.getElementById(`pdf-page-${pageIndex}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const clampPageNumber = useCallback((value: string) => {
    const total = pdfDoc?.numPages ?? 1
    const raw = Number.parseInt(value, 10)
    const n = Number.isFinite(raw) ? raw : 1
    return Math.max(1, Math.min(total, n))
  }, [pdfDoc])

  const addManualFillable = useCallback(
    (kind: FillableFieldElement['kind']) => {
      if (!pdfDoc) return
      const pageIndex = clampPageNumber(pageInput) - 1
      const defaultRect = { x: 80, y: 600, width: 240, height: 24 }
      const id = crypto.randomUUID()
      const next: FillableFieldElement = {
        id,
        pageIndex,
        rect: defaultRect,
        feature: 'fillable',
        kind,
        name: `${kind}_${id.slice(0, 6)}`,
        required: false,
        fontSize: 12,
        background: kind === 'checkbox' ? 'none' : 'white',
      }
      setSelectedId(id)
      setElements([...project.elements, next])
    },
    [clampPageNumber, pageInput, pdfDoc, project.elements, setElements],
  )

  const createFillableAt = useCallback(
    (
      pageIndex: number,
      kind: FillableFieldElement['kind'],
      rect: { x: number; y: number; width: number; height: number },
    ) => {
      const id = crypto.randomUUID()
      const next: FillableFieldElement = {
        id,
        pageIndex,
        rect,
        feature: 'fillable',
        kind,
        name: `${kind}_${id.slice(0, 6)}`,
        required: false,
        fontSize: 12,
        background: kind === 'checkbox' ? 'none' : 'white',
      }
      setSelectedId(id)
      setElements([...project.elements, next])
    },
    [project.elements, setElements],
  )

  const addRebrandText = useCallback(() => {
    const id = crypto.randomUUID()
    const next: RebrandElement = {
      id,
      pageIndex: 0,
      rect: { x: 60, y: 820, width: 220, height: 16 },
      feature: 'rebrand',
      kind: 'text',
      value: 'Nuova ragione sociale',
      fontSize: 12,
      background: 'white',
      asTemplateField: false,
      fieldName: `company_name_${id.slice(0, 6)}`,
    }
    setSelectedId(id)
    setElements([...project.elements, next])
  }, [project.elements, setElements])

  const addRebrandLogo = useCallback(
    async (file: File) => {
      onError(null)
      try {
        const { bytes, mime } = await readImageFile(file)
        const id = crypto.randomUUID()
        const next: RebrandElement = {
          id,
          pageIndex: 0,
          rect: { x: 50, y: 812, width: 80, height: 24 },
          feature: 'rebrand',
          kind: 'logo',
          imageBytes: bytes,
          imageMime: mime,
          opacity: 1,
          background: 'white',
        }
        setSelectedId(id)
        setElements([...project.elements, next])
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        onError(`Impossibile caricare l’immagine: ${message}`)
      }
    },
    [onError, project.elements, setElements],
  )

  const onAutoDetect = useCallback(
    async (mode: 'simple' | 'aggressive' = 'simple') => {
      if (!pdfDoc) return
      onError(null)
      try {
        const detected = await detectFillableFields(pdfDoc, { mode })
        if (detected.length === 0) {
          onError(
            mode === 'aggressive'
              ? 'Nessun campo rilevato (aggressivo). Prova “Disegna …” o aggiungi manualmente.'
              : 'Nessun campo rilevato. Prova “Rileva (aggressivo)” o “Disegna …”.',
          )
          return
        }

        const existingFillable = project.elements.filter(isFillableElement)
        const merged: FillableFieldElement[] = [...existingFillable]
        let firstAddedId: string | null = null

        for (const d of detected) {
          const dup = merged.some(
            (o) => o.pageIndex === d.pageIndex && iou(o.rect, d.rect) > 0.65,
          )
          if (dup) continue
          merged.push(d)
          if (!firstAddedId) firstAddedId = d.id
        }

        const next = [
          ...project.elements.filter((e) => e.feature !== 'fillable'),
          ...merged,
        ]
        setElements(next)
        setSelectedId(firstAddedId ?? selectedId ?? merged[0]?.id ?? null)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        onError(`Rilevamento automatico fallito: ${message}`)
      }
    },
    [onError, pdfDoc, project.elements, selectedId, setElements],
  )

  const onExport = useCallback(
    async (format: 'fillable' | 'flat' | 'template') => {
      if (!pdfDoc) return
      onError(null)
      setIsExporting(true)
      try {
        if (mode === 'fillable') {
          const fillable = project.elements.filter(isFillableElement)
          const bytes = await exportFillablePdf(project.originalBytes, fillable)
          downloadBytes(
            bytes,
            project.fileName.replace(/\.pdf$/i, '') + '-fillable.pdf',
          )
          return
        }

        const rebrand = project.elements.filter(isRebrandElement)
        const exportMode = format === 'flat' ? 'flat' : 'template'
        const bytes = await exportRebrandedPdf(project.originalBytes, rebrand, {
          mode: exportMode,
        })
        const suffix = exportMode
        downloadBytes(
          bytes,
          project.fileName.replace(/\.pdf$/i, '') + `-${suffix}.pdf`,
        )
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        onError(`Esportazione fallita: ${message}`)
      } finally {
        setIsExporting(false)
      }
    },
    [mode, onError, pdfDoc, project.elements, project.fileName, project.originalBytes],
  )

  useEffect(() => {
    const el = dropRef.current
    if (!el) return

    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      el.classList.add('isDragOver')
    }
    const onDragLeave = () => {
      el.classList.remove('isDragOver')
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      el.classList.remove('isDragOver')
      const file = e.dataTransfer?.files?.[0]
      if (file) void onUpload(file)
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)

    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [onUpload])

  const uploadBtn = (
    <label className="btn">
      Cambia PDF…
      <input
        className="fileInput"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onUpload(f)
          e.target.value = ''
        }}
      />
    </label>
  )

  return (
    <div ref={dropRef} className="workspace">
      <aside className="sidebar">
        <div className="sidebarSection">
          <div className="sidebarTitle">Documento</div>
          <div className="sidebarMeta">{project.fileName}</div>
          <div className="sidebarRow">{uploadBtn}</div>
        </div>

        <div className="sidebarSection">
          <div className="sidebarTitle">Zoom</div>
          <div className="sidebarRow">
            <button
              className="btn btnSmall"
              onClick={() => onZoomChange(Math.max(0.5, project.ui.zoom - 0.1))}
              type="button"
            >
              −
            </button>
            <div className="sidebarValue">{Math.round(project.ui.zoom * 100)}%</div>
            <button
              className="btn btnSmall"
              onClick={() => onZoomChange(Math.min(3, project.ui.zoom + 0.1))}
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <div className="sidebarSection">
          <div className="sidebarTitle">Navigazione</div>
          <div className="sidebarRow">
            <button
              className="btn btnSmall"
              disabled={!pdfDoc || pdfDoc.numPages <= 1}
              onClick={() => {
                const current = clampPageNumber(pageInput)
                const next = Math.max(1, current - 1)
                setPageInput(String(next))
                scrollToPage(next - 1)
              }}
              type="button"
            >
              ←
            </button>
            <input
              className="input inputInline"
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                if (!pdfDoc) return
                const current = clampPageNumber(pageInput)
                setPageInput(String(current))
                scrollToPage(current - 1)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                if (!pdfDoc) return
                const current = clampPageNumber(pageInput)
                setPageInput(String(current))
                scrollToPage(current - 1)
              }}
            />
            <button
              className="btn btnSmall"
              disabled={!pdfDoc || pdfDoc.numPages <= 1}
              onClick={() => {
                const current = clampPageNumber(pageInput)
                const next = Math.min(pdfDoc?.numPages ?? 1, current + 1)
                setPageInput(String(next))
                scrollToPage(next - 1)
              }}
              type="button"
            >
              →
            </button>
          </div>
          <div className="sidebarHint">
            {pdfDoc ? `Pagine: ${pdfDoc.numPages}` : 'Caricamento…'}
          </div>
        </div>

        {mode === 'fillable' ? (
          <div className="sidebarSection">
            <div className="sidebarTitle">Rendi compilabile</div>
            <div className="sidebarRow sidebarRowWrap">
              <button className="btn btnSmall" disabled={!canUndo} onClick={undo} type="button">
                ↶ Indietro
              </button>
              <div className="sidebarHint">
                Scorciatoie: Ctrl+Z, Canc, T/C/S, ESC
              </div>
            </div>
            <div className="sidebarRow sidebarRowWrap">
              <button
                className="btn btnPrimary"
                onClick={() => void onAutoDetect('simple')}
                type="button"
              >
                Rileva campi
              </button>
              <button
                className="btn"
                onClick={() => void onAutoDetect('aggressive')}
                type="button"
              >
                Rileva (aggressivo)
              </button>
            </div>
            <div className="sidebarRow sidebarRowWrap">
              <button
                className={[
                  'btn',
                  'btnSmall',
                  drawKind === 'text' ? 'btnPrimary' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDrawKind((k) => (k === 'text' ? null : 'text'))}
                type="button"
              >
                Disegna testo
              </button>
              <button
                className={[
                  'btn',
                  'btnSmall',
                  drawKind === 'checkbox' ? 'btnPrimary' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  setDrawKind((k) => (k === 'checkbox' ? null : 'checkbox'))
                }
                type="button"
              >
                Disegna checkbox
              </button>
              <button
                className={[
                  'btn',
                  'btnSmall',
                  drawKind === 'signature' ? 'btnPrimary' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() =>
                  setDrawKind((k) => (k === 'signature' ? null : 'signature'))
                }
                type="button"
              >
                Disegna firma
              </button>
            </div>
            {drawKind ? (
              <div className="sidebarHint">
                Trascina sul PDF per disegnare il campo. Premi ESC per uscire.
              </div>
            ) : null}
            <div className="sidebarRow sidebarRowWrap">
              <button
                className="btn btnSmall"
                onClick={() => addManualFillable('text')}
                type="button"
              >
                + Testo
              </button>
              <button
                className="btn btnSmall"
                onClick={() => addManualFillable('checkbox')}
                type="button"
              >
                + Checkbox
              </button>
              <button
                className="btn btnSmall"
                onClick={() => addManualFillable('signature')}
                type="button"
              >
                + Firma
              </button>
            </div>
            <div className="sidebarRow">
              <button
                className="btn btnPrimary"
                disabled={isExporting}
                onClick={() => void onExport('fillable')}
                type="button"
              >
                {isExporting ? 'Esporto…' : 'Esporta PDF compilabile'}
              </button>
            </div>
          </div>
        ) : (
          <div className="sidebarSection">
            <div className="sidebarTitle">Template rebranding</div>
            <div className="sidebarRow sidebarRowWrap">
              <button className="btn btnSmall" onClick={addRebrandText} type="button">
                + Testo
              </button>
              <label className="btn btnSmall">
                + Logo
                <input
                  className="fileInput"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void addRebrandLogo(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <div className="sidebarRow sidebarRowWrap">
              <button
                className="btn btnPrimary"
                disabled={isExporting}
                onClick={() => void onExport('flat')}
                type="button"
              >
                {isExporting ? 'Esporto…' : 'Esporta PDF flat'}
              </button>
              <button
                className="btn"
                disabled={isExporting}
                onClick={() => void onExport('template')}
                type="button"
              >
                {isExporting ? 'Esporto…' : 'Esporta template'}
              </button>
            </div>
          </div>
        )}

        <div className="sidebarSection">
          <div className="sidebarTitle">Elementi</div>
          {elements.length === 0 ? (
            <div className="sidebarHint">Nessun elemento.</div>
          ) : (
            <div className="elementList">
              {elements.map((el) => (
                <button
                  key={el.id}
                  className={['elementListItem', selectedId === el.id ? 'isOn' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelectedId(el.id)}
                  type="button"
                >
                  <div className="elementListItem__title">
                    {el.kind}{' '}
                    {el.feature === 'fillable'
                      ? el.name
                      : el.kind === 'text'
                        ? el.fieldName
                        : null}
                  </div>
                  <div className="elementListItem__meta">
                    Pag. {el.pageIndex + 1}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebarSection">
          <div className="sidebarTitle">Proprietà</div>
          {!selected ? (
            <div className="sidebarHint">Seleziona un elemento.</div>
          ) : (
            <div className="propGrid">
              {'name' in selected ? (
                <>
                  <label className="field">
                    <div className="fieldLabel">Nome campo</div>
                    <input
                      className="input"
                      value={(selected as FillableFieldElement).name}
                      onChange={(e) =>
                        updateElement(selected.id, { name: e.target.value })
                      }
                    />
                  </label>
                  <label className="field fieldInline">
                    <input
                      type="checkbox"
                      checked={(selected as FillableFieldElement).required}
                      onChange={(e) =>
                        updateElement(selected.id, { required: e.target.checked })
                      }
                    />
                    <div className="fieldLabel">Obbligatorio</div>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Font</div>
                    <input
                      className="input"
                      type="number"
                      min={6}
                      max={36}
                      value={(selected as FillableFieldElement).fontSize}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          fontSize: Math.max(6, Math.min(36, Number(e.target.value))),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Sovrascrivi</div>
                    <select
                      className="input"
                      value={(selected as FillableFieldElement).background}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          background: e.target.value === 'none' ? 'none' : 'white',
                        })
                      }
                    >
                      <option value="white">Bianco</option>
                      <option value="none">Nessuno</option>
                    </select>
                  </label>
                </>
              ) : selected.kind === 'text' ? (
                <>
                  <label className="field">
                    <div className="fieldLabel">Testo</div>
                    <input
                      className="input"
                      value={selected.value}
                      onChange={(e) =>
                        updateElement(selected.id, { value: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Font</div>
                    <input
                      className="input"
                      type="number"
                      min={6}
                      max={48}
                      value={selected.fontSize}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          fontSize: Math.max(6, Math.min(48, Number(e.target.value))),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Sovrascrivi</div>
                    <select
                      className="input"
                      value={selected.background ?? 'white'}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          background: e.target.value === 'none' ? 'none' : 'white',
                        })
                      }
                    >
                      <option value="white">Bianco</option>
                      <option value="none">Nessuno</option>
                    </select>
                  </label>
                  <label className="field fieldInline">
                    <input
                      type="checkbox"
                      checked={selected.asTemplateField}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          asTemplateField: e.target.checked,
                        })
                      }
                    />
                    <div className="fieldLabel">Campo variabile</div>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Nome campo</div>
                    <input
                      className="input"
                      value={selected.fieldName}
                      onChange={(e) =>
                        updateElement(selected.id, { fieldName: e.target.value })
                      }
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <div className="fieldLabel">Sovrascrivi</div>
                    <select
                      className="input"
                      value={selected.background}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          background: e.target.value === 'none' ? 'none' : 'white',
                        })
                      }
                    >
                      <option value="white">Bianco</option>
                      <option value="none">Nessuno</option>
                    </select>
                  </label>
                  <label className="field">
                    <div className="fieldLabel">Opacità</div>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={selected.opacity}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          opacity: Math.max(
                            0,
                            Math.min(1, Number(e.target.value || '1')),
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}

              <div className="sidebarRow">
                <button className="btn btnDanger" onClick={() => deleteElement(selected.id)} type="button">
                  Elimina
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <section className="viewerArea">
        {isLoadingPdf ? (
          <div className="viewerLoading">Caricamento PDF…</div>
        ) : pdfDoc ? (
          <PdfViewer
            pdfDoc={pdfDoc}
            zoom={project.ui.zoom}
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onElementChange={(id, patch) => updateElement(id, patch)}
            onElementDelete={deleteElement}
            onElementDuplicate={duplicateElement}
            drawKind={mode === 'fillable' ? drawKind : null}
            onCreateElement={createFillableAt}
          />
        ) : (
          <div className="viewerLoading">Documento non disponibile.</div>
        )}
      </section>
    </div>
  )
}
