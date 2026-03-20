import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from '../pdfjs'
import type { WorkspaceElement } from '../workspace/types'
import { OverlayLayer } from './OverlayLayer'

type Props = {
  pdfDoc: PDFDocumentProxy
  pageIndex: number
  zoom: number
  elements: WorkspaceElement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onElementChange: (id: string, patch: Partial<WorkspaceElement>) => void
  onElementDelete: (id: string) => void
  onElementDuplicate: (id: string) => void
  drawKind: 'text' | 'checkbox' | 'signature' | null
  onCreateElement: (
    pageIndex: number,
    kind: 'text' | 'checkbox' | 'signature',
    rect: { x: number; y: number; width: number; height: number },
  ) => void
}

export function PageView({
  pdfDoc,
  pageIndex,
  zoom,
  elements,
  selectedId,
  onSelect,
  onElementChange,
  onElementDelete,
  onElementDuplicate,
  drawKind,
  onCreateElement,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsVisible(entry?.isIntersecting ?? false)
      },
      { root: null, rootMargin: '800px 0px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await pdfDoc.getPage(pageIndex + 1)
      if (!cancelled) setPage(p)
    })()
    return () => {
      cancelled = true
    }
  }, [pageIndex, pdfDoc])

  const viewport = useMemo(() => {
    if (!page) return null
    return page.getViewport({ scale: zoom })
  }, [page, zoom])

  useEffect(() => {
    if (!page) return
    if (!isVisible) return

    const canvas = canvasRef.current
    if (!canvas) return

    const vp = page.getViewport({ scale: zoom })
    const outputScale = window.devicePixelRatio || 1

    canvas.width = Math.floor(vp.width * outputScale)
    canvas.height = Math.floor(vp.height * outputScale)
    canvas.style.width = `${Math.floor(vp.width)}px`
    canvas.style.height = `${Math.floor(vp.height)}px`

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0)

    const renderTask = page.render({
      canvas,
      canvasContext: ctx,
      viewport: vp,
      intent: 'display',
    })
    renderTask.promise.catch(() => {})

    return () => {
      renderTask.cancel()
    }
  }, [isVisible, page, zoom])

  const placeholderHeight = useMemo(() => {
    if (!page) return 900
    const vp = page.getViewport({ scale: zoom })
    return Math.floor(vp.height)
  }, [page, zoom])

  return (
    <div
      id={`pdf-page-${pageIndex}`}
      ref={containerRef}
      className="pdfPage"
    >
      <div className="pdfPage__header">Pagina {pageIndex + 1}</div>
      <div
        className="pdfPage__stage"
        style={{ height: isVisible ? undefined : placeholderHeight }}
      >
        {isVisible && viewport ? (
          <>
            <canvas className="pdfCanvas" ref={canvasRef} />
            <OverlayLayer
              pageIndex={pageIndex}
              viewport={viewport}
              elements={elements}
              selectedId={selectedId}
              onSelect={onSelect}
              onElementChange={onElementChange}
              onElementDelete={onElementDelete}
              onElementDuplicate={onElementDuplicate}
              drawKind={drawKind}
              onCreateElement={onCreateElement}
            />
          </>
        ) : (
          <div className="pdfPlaceholder">Rendering su richiesta…</div>
        )}
      </div>
    </div>
  )
}
