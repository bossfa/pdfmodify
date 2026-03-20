import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { PdfWorkspace } from '../../pdf/workspace/PdfWorkspace'
import type { PdfProjectMode, PdfWorkspaceProject } from '../../pdf/workspace/types'
import { createSampleFillablePdf, createSampleRebrandPdf } from '../../pdf/workspace/samplePdfs'
import { projectStore } from '../../storage/projectStore'
import { loadPdfDocument } from '../../pdf/pdfjs'
import { exportFillablePdf } from '../../pdf/export/exportFillablePdf'
import { exportRebrandedPdf } from '../../pdf/export/exportRebrandedPdf'
import { detectFillableFields } from '../../pdf/detect/detectFillableFields'
import { Tools } from '../tools/Tools'

export function SmartPdfEditorApp() {
  const [projects, setProjects] = useState<PdfWorkspaceProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [mode, setMode] = useState<PdfProjectMode>('fillable')
  const [screen, setScreen] = useState<'tools' | 'editor'>('tools')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [isWelcomeDragOver, setIsWelcomeDragOver] = useState(false)

  const title = useMemo(() => 'SmartPDF Editor', [])

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null
    return projects.find((p) => p.id === activeProjectId) ?? null
  }, [activeProjectId, projects])

  const setActiveProject = useCallback((next: PdfWorkspaceProject) => {
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)))
    setActiveProjectId(next.id)
    setMode(next.mode)
  }, [])

  const setModeAndPersist = useCallback((nextMode: PdfProjectMode) => {
    setMode(nextMode)
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProjectId ? { ...p, mode: nextMode } : p)),
    )
  }, [activeProjectId])

  const loadBytes = useCallback(
    async (bytes: Uint8Array, fileName: string, nextMode?: PdfProjectMode) => {
      setError(null)
      setNotice(null)
      const resolvedMode = nextMode ?? mode
      setMode(resolvedMode)
      const normalized =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes
          : new Uint8Array(bytes)
      const project: PdfWorkspaceProject = {
        id: crypto.randomUUID(),
        fileName,
        originalBytes: normalized,
        mode: resolvedMode,
        elements: [],
        ui: { zoom: 1.25 },
      }
      setProjects((prev) => [project, ...prev])
      setActiveProjectId(project.id)
      setScreen('editor')
    },
    [mode],
  )

  const onUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null)
      setNotice(null)
      const list = Array.from(files)
      for (const file of list) {
        if (
          !file.type.includes('pdf') &&
          !file.name.toLowerCase().endsWith('.pdf')
        ) {
          setError(`File non valido: ${file.name}`)
          return
        }
        if (file.size > 50 * 1024 * 1024) {
          setError(`File troppo grande (max 50MB): ${file.name}`)
          return
        }
      }

      for (const file of list) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await loadBytes(bytes, file.name)
      }
    },
    [loadBytes],
  )

  const onCreateSampleFillable = useCallback(async () => {
    setNotice(null)
    const bytes = await createSampleFillablePdf()
    await loadBytes(bytes, 'demo-rendi-compilabile.pdf', 'fillable')
  }, [loadBytes])

  const onCreateSampleRebrand = useCallback(async () => {
    setNotice(null)
    const bytes = await createSampleRebrandPdf()
    await loadBytes(bytes, 'demo-template-rebranding.pdf', 'rebrand')
  }, [loadBytes])

  const onSaveProject = useCallback(async () => {
    if (!activeProject) return
    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      await projectStore.save(activeProject)
      const confirm = await projectStore.getLast()
      if (!confirm || confirm.id !== activeProject.id) {
        throw new Error('Salvataggio non verificabile in IndexedDB')
      }
      const now = Date.now()
      setLastSavedAt(now)
      setNotice(`Progetto salvato in locale (${new Date(now).toLocaleTimeString()}).`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(`Impossibile salvare il progetto: ${message}`)
    } finally {
      setIsSaving(false)
    }
  }, [activeProject])

  const onLoadLastProject = useCallback(async () => {
    setError(null)
    setNotice(null)
    try {
      const last = await projectStore.getLast()
      if (!last) {
        setError('Nessun progetto salvato trovato.')
        return
      }
      const bytes =
        last.originalBytes instanceof Uint8Array
          ? last.originalBytes
          : new Uint8Array(last.originalBytes as unknown as ArrayBuffer)
      const normalized =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? bytes
          : new Uint8Array(bytes)
      setMode(last.mode)
      setProjects([{ ...last, originalBytes: normalized }])
      setActiveProjectId(last.id)
      setNotice('Progetto ripristinato.')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(`Impossibile caricare il progetto: ${message}`)
    }
  }, [])

  const onCloseActive = useCallback(() => {
    if (!activeProjectId) return
    setError(null)
    setNotice(null)
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== activeProjectId)
      const nextActive = next[0] ?? null
      setActiveProjectId(nextActive?.id ?? null)
      setMode(nextActive?.mode ?? 'fillable')
      return next
    })
  }, [activeProjectId])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const key = 'smartpdf_selftest_status'
    if (sessionStorage.getItem(key) === 'ok') return

    void (async () => {
      try {
        const fillableBytes = await createSampleFillablePdf()
        const doc1 = await loadPdfDocument(fillableBytes)
        await doc1.destroy()

        const rebrandBytes = await createSampleRebrandPdf()
        const doc2 = await loadPdfDocument(rebrandBytes)
        await doc2.destroy()

        const probeProject: PdfWorkspaceProject = {
          id: crypto.randomUUID(),
          fileName: 'selftest.pdf',
          originalBytes: fillableBytes,
          mode: 'fillable',
          elements: [],
          ui: { zoom: 1.25 },
        }
        await projectStore.save(probeProject)
        const restored = await projectStore.getLast()
        if (!restored) throw new Error('IndexedDB: progetto non ripristinabile')

        const rebrandExport = await exportRebrandedPdf(
          rebrandBytes,
          [
            {
              id: crypto.randomUUID(),
              pageIndex: 0,
              rect: { x: 50, y: 790, width: 240, height: 18 },
              feature: 'rebrand',
              kind: 'text',
              value: 'SELF-TEST OK',
              fontSize: 12,
              background: 'white',
              asTemplateField: false,
              fieldName: 'selftest',
            },
          ],
          { mode: 'flat' },
        )
        const doc3 = await loadPdfDocument(rebrandExport)
        await doc3.destroy()

        const rebrandTemplateExport = await exportRebrandedPdf(
          rebrandBytes,
          [
            {
              id: crypto.randomUUID(),
              pageIndex: 0,
              rect: { x: 50, y: 760, width: 240, height: 18 },
              feature: 'rebrand',
              kind: 'text',
              value: 'SELF-TEST TEMPLATE',
              fontSize: 12,
              background: 'white',
              asTemplateField: true,
              fieldName: 'selftest_template',
            },
          ],
          { mode: 'template' },
        )
        const docTemplate = await loadPdfDocument(rebrandTemplateExport)
        await docTemplate.destroy()

        const fillableExport = await exportFillablePdf(fillableBytes, [
          {
            id: crypto.randomUUID(),
            pageIndex: 0,
            rect: { x: 170, y: 716, width: 250, height: 22 },
            feature: 'fillable',
            kind: 'text',
            name: 'selftest_name',
            required: false,
            fontSize: 12,
            background: 'none',
          },
        ])
        const doc4 = await loadPdfDocument(fillableExport)
        await doc4.destroy()

        const doc5 = await loadPdfDocument(fillableBytes)
        const aggressive = await detectFillableFields(doc5, { mode: 'aggressive' })
        await doc5.destroy()
        if (aggressive.length === 0) {
          throw new Error('detectFillableFields(aggressive) returned 0')
        }

        sessionStorage.setItem(key, 'ok')
        setNotice('Self-test OK (demo + export + storage).')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setError(`Self-test fallito: ${message}`)
      }
    })()
  }, [])

  return (
    <div className="app">
      <header className="appHeader">
        <div className="appHeader__left">
          <div className="appTitle">{title}</div>
          <div className="appSubtitle">
            Privacy-first: l’elaborazione avviene nel browser. Nessun PDF viene
            inviato a server esterni.
          </div>
        </div>
        <div className="appHeader__right">
          <div className="segmented">
            <button
              className={clsx('segmented__btn', screen === 'tools' && 'isOn')}
              onClick={() => setScreen('tools')}
              type="button"
            >
              Strumenti
            </button>
            <button
              className={clsx('segmented__btn', screen === 'editor' && 'isOn')}
              onClick={() => setScreen('editor')}
              type="button"
            >
              Editor
            </button>
          </div>
          {screen === 'editor' ? (
            <>
              <div className="segmented">
                <button
                  className={clsx('segmented__btn', mode === 'fillable' && 'isOn')}
                  onClick={() => setModeAndPersist('fillable')}
                  type="button"
                >
                  Rendi compilabile
                </button>
                <button
                  className={clsx('segmented__btn', mode === 'rebrand' && 'isOn')}
                  onClick={() => setModeAndPersist('rebrand')}
                  type="button"
                >
                  Template rebranding
                </button>
              </div>
              {projects.length > 0 ? (
                <select
                  className="input inputInline"
                  value={activeProjectId ?? ''}
                  onChange={(e) => {
                    const id = e.target.value
                    const p = projects.find((x) => x.id === id)
                    if (!p) return
                    setActiveProjectId(p.id)
                    setMode(p.mode)
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fileName}
                    </option>
                  ))}
                </select>
              ) : null}
              <button className="btn" onClick={onLoadLastProject} type="button">
                Riprendi ultimo
              </button>
              <button
                className="btn btnPrimary"
                disabled={!activeProject || isSaving}
                onClick={onSaveProject}
                type="button"
              >
                {isSaving ? 'Salvataggio…' : 'Salva progetto'}
              </button>
              {activeProject && lastSavedAt ? (
                <div className="sidebarHint">
                  Salvato alle {new Date(lastSavedAt).toLocaleTimeString()}
                </div>
              ) : null}
              {activeProject ? (
                <button className="btn btnDanger" onClick={onCloseActive} type="button">
                  Chiudi
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="globalError">
          <div className="errorBanner">{error}</div>
        </div>
      ) : null}
      {notice ? (
        <div className="globalError">
          <div className="noticeBanner">{notice}</div>
        </div>
      ) : null}

      <main className="appMain">
        {screen === 'tools' ? (
          <Tools onOpenEditor={() => setScreen('editor')} />
        ) : !activeProject ? (
          <div
            className={clsx('welcome', isWelcomeDragOver && 'isDragOver')}
            onDragOver={(e) => {
              e.preventDefault()
              setIsWelcomeDragOver(true)
            }}
            onDragLeave={() => setIsWelcomeDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsWelcomeDragOver(false)
              const fs = e.dataTransfer.files
              if (fs?.length) void onUploadFiles(fs)
            }}
          >
            <div className="welcomeCard">
              <h1>Modifica PDF in modo semplice</h1>
              <p>
                Carica un PDF oppure usa una demo generata al volo per provare le
                due funzionalità principali.
              </p>

              <div className="welcomeActions">
                <label className="btn btnPrimary">
                  Carica PDF…
                  <input
                    className="fileInput"
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    onChange={(e) => {
                      const fs = e.target.files
                      if (fs?.length) void onUploadFiles(fs)
                      e.target.value = ''
                    }}
                  />
                </label>
                <button
                  className="btn"
                  onClick={onCreateSampleFillable}
                  type="button"
                >
                  Demo “Rendi compilabile”
                </button>
                <button
                  className="btn"
                  onClick={onCreateSampleRebrand}
                  type="button"
                >
                  Demo “Rebranding”
                </button>
              </div>

            </div>
          </div>
        ) : (
          <PdfWorkspace
            key={activeProject.id}
            mode={mode}
            project={activeProject}
            onProjectChange={setActiveProject}
            onUpload={(file) => void onUploadFiles([file])}
            onError={setError}
          />
        )}
      </main>
    </div>
  )
}
