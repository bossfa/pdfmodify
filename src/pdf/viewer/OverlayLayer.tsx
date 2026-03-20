import { useCallback, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Rnd } from 'react-rnd'
import type { PageViewport } from 'pdfjs-dist'
import type { WorkspaceElement } from '../workspace/types'
import { pdfRectToViewportRect, viewportRectToPdfRect } from './geometry'

type Props = {
  pageIndex: number
  viewport: PageViewport
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

export function OverlayLayer({
  pageIndex,
  viewport,
  elements,
  selectedId,
  onSelect,
  onElementChange,
  onElementDelete,
  onElementDuplicate,
  drawKind,
  onCreateElement,
}: Props) {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(
    null,
  )

  const isDrawing = Boolean(drawKind && dragStart && dragPoint)

  const rubberBand = useMemo(() => {
    if (!drawKind || !dragStart || !dragPoint) return null
    const x = Math.min(dragStart.x, dragPoint.x)
    const y = Math.min(dragStart.y, dragPoint.y)
    const width = Math.abs(dragPoint.x - dragStart.x)
    const height = Math.abs(dragPoint.y - dragStart.y)
    return { x, y, width, height }
  }, [drawKind, dragPoint, dragStart])

  const clamp = useCallback((v: number, min: number, max: number) => {
    return Math.max(min, Math.min(max, v))
  }, [])

  const createDefaultRect = useCallback(
    (x: number, y: number) => {
      if (!drawKind) return null
      const size =
        drawKind === 'checkbox'
          ? { width: 16, height: 16 }
          : drawKind === 'signature'
            ? { width: 260, height: 24 }
            : { width: 240, height: 24 }
      const left = clamp(x - size.width / 2, 0, viewport.width - size.width)
      const top = clamp(y - size.height / 2, 0, viewport.height - size.height)
      return { x: left, y: top, width: size.width, height: size.height }
    },
    [clamp, drawKind, viewport.height, viewport.width],
  )

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!drawKind) return
      if (e.target !== e.currentTarget) return
      const bounds = e.currentTarget.getBoundingClientRect()
      const x = clamp(e.clientX - bounds.left, 0, viewport.width)
      const y = clamp(e.clientY - bounds.top, 0, viewport.height)
      setDragStart({ x, y })
      setDragPoint({ x, y })
    },
    [clamp, drawKind, viewport.height, viewport.width],
  )

  const handleBackgroundMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (drawKind) return
      if (e.target !== e.currentTarget) return
      onSelect(null)
    },
    [drawKind, onSelect],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!drawKind) return
      if (!dragStart) return
      const bounds = e.currentTarget.getBoundingClientRect()
      const x = clamp(e.clientX - bounds.left, 0, viewport.width)
      const y = clamp(e.clientY - bounds.top, 0, viewport.height)
      setDragPoint({ x, y })
    },
    [clamp, dragStart, drawKind, viewport.height, viewport.width],
  )

  const handleMouseUp = useCallback(() => {
    if (!drawKind || !dragStart || !dragPoint) return

    const x1 = Math.min(dragStart.x, dragPoint.x)
    const y1 = Math.min(dragStart.y, dragPoint.y)
    const w = Math.abs(dragPoint.x - dragStart.x)
    const h = Math.abs(dragPoint.y - dragStart.y)

    const viewportRect =
      w < 8 && h < 8
        ? createDefaultRect(dragStart.x, dragStart.y)
        : { x: x1, y: y1, width: w, height: h }

    setDragStart(null)
    setDragPoint(null)

    if (!viewportRect) return
    if (viewportRect.width < 8 || viewportRect.height < 8) return

    const pdfRect = viewportRectToPdfRect(viewport, viewportRect)
    onCreateElement(pageIndex, drawKind, pdfRect)
  }, [
    createDefaultRect,
    drawKind,
    dragPoint,
    dragStart,
    onCreateElement,
    pageIndex,
    viewport,
  ])

  return (
    <div
      className={['overlay', drawKind ? 'isDrawMode' : ''].filter(Boolean).join(' ')}
      style={{ width: viewport.width, height: viewport.height }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => {
        handleBackgroundMouseDown(e)
        handleMouseDown(e)
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {isDrawing && rubberBand ? (
        <div
          className="rubberBand"
          style={{
            left: rubberBand.x,
            top: rubberBand.y,
            width: rubberBand.width,
            height: rubberBand.height,
          }}
        />
      ) : null}
      {elements.map((el) => {
        const r = pdfRectToViewportRect(viewport, el.rect)
        const isSelected = selectedId === el.id
        const label =
          el.feature === 'fillable'
            ? el.kind === 'text'
              ? el.name
              : el.kind
            : el.kind === 'text'
              ? el.fieldName
              : 'logo'

        return (
          <Rnd
            key={el.id}
            size={{ width: r.width, height: r.height }}
            position={{ x: r.x, y: r.y }}
            minWidth={8}
            minHeight={8}
            bounds="parent"
            onMouseDown={() => onSelect(el.id)}
            onDragStop={(_, d) => {
              const nextPdf = viewportRectToPdfRect(viewport, {
                x: d.x,
                y: d.y,
                width: r.width,
                height: r.height,
              })
              onElementChange(el.id, { rect: nextPdf })
            }}
            onResizeStop={(_, __, ref, ___, position) => {
              const width = ref.offsetWidth
              const height = ref.offsetHeight
              const nextPdf = viewportRectToPdfRect(viewport, {
                x: position.x,
                y: position.y,
                width,
                height,
              })
              onElementChange(el.id, { rect: nextPdf })
            }}
            enableResizing={{
              bottom: true,
              bottomLeft: true,
              bottomRight: true,
              left: true,
              right: true,
              top: true,
              topLeft: true,
              topRight: true,
            }}
            dragGrid={[1, 1]}
            resizeGrid={[1, 1]}
            className={['box', isSelected ? 'isSelected' : '', `kind_${el.kind}`]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="boxLabel">
              <div className="boxLabel__kind">{label}</div>
              <div className="boxLabel__meta">
                {isSelected ? (
                  <div className="boxActions">
                    <button
                      className="boxActionBtn"
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onElementDuplicate(el.id)
                      }}
                      aria-label="Duplica"
                      title="Duplica"
                    >
                      +
                    </button>
                    <button
                      className="boxActionBtn boxActionBtnDanger"
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        onElementDelete(el.id)
                      }}
                      aria-label="Elimina"
                      title="Elimina"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <span>Pag. {pageIndex + 1}</span>
              </div>
            </div>
          </Rnd>
        )
      })}
    </div>
  )
}
