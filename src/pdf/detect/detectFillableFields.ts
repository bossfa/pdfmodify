import type { PDFDocumentProxy } from '../pdfjs'
import type { FillableFieldElement } from '../workspace/types'
import { OPS } from 'pdfjs-dist'

type TextItem = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

type TextMark = {
  str: string
  rect: { x: number; y: number; width: number; height: number }
  cx: number
  cy: number
  fontSize: number
}

export type DetectFillableFieldsMode = 'simple' | 'aggressive'

function isLikelyUnderlineText(str: string): boolean {
  return /_{4,}/.test(str) || /—{3,}/.test(str) || /-{6,}/.test(str)
}

function isCheckboxGlyph(str: string): boolean {
  const s = str.trim()
  return s === '☐' || s === '□' || s === '[ ]' || s === '[x]' || s === '[X]'
}

function isSignatureLabel(str: string): boolean {
  return /\b(firma|signature|sign)\b/i.test(str)
}

export async function detectFillableFields(
  pdfDoc: PDFDocumentProxy,
  opts?: { mode?: DetectFillableFieldsMode },
): Promise<FillableFieldElement[]> {
  const mode: DetectFillableFieldsMode = opts?.mode ?? 'simple'
  const results: FillableFieldElement[] = []

  for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex += 1) {
    const page = await pdfDoc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const items = textContent.items as unknown as TextItem[]
    const textMarks: TextMark[] = []

    for (const item of items) {
      const raw = item.str ?? ''
      if (!raw) continue
      const str = String(raw)

      if (!item.transform || item.transform.length < 6) continue
      const xPdf = Number(item.transform[4])
      const yPdf = Number(item.transform[5])
      if (!Number.isFinite(xPdf) || !Number.isFinite(yPdf)) continue
      const [vx, vy] = viewport.convertToViewportPoint(xPdf, yPdf)
      const inferredFontSize = Math.max(
        6,
        Math.min(
          36,
          Math.max(Math.abs(Number(item.transform[0])), Math.abs(Number(item.transform[3])), 12),
        ),
      )
      const w = Number.isFinite(item.width)
        ? Math.max(2, Number(item.width))
        : Math.max(2, str.trim().length * inferredFontSize * 0.55)
      const h = Number.isFinite(item.height) ? Math.max(2, Number(item.height)) : inferredFontSize

      const textRect = {
        x: xPdf,
        y: yPdf - h * 0.85,
        width: w,
        height: h * 1.1,
      }
      textMarks.push({
        str,
        rect: textRect,
        cx: textRect.x + textRect.width / 2,
        cy: yPdf,
        fontSize: inferredFontSize,
      })

      if (isCheckboxGlyph(str)) {
        const id = crypto.randomUUID()
        const [x1, y1] = viewport.convertToPdfPoint(vx, vy - 14)
        const [x2, y2] = viewport.convertToPdfPoint(vx + 14, vy)
        const rect = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }
        results.push({
          id,
          pageIndex,
          rect,
          feature: 'fillable',
          kind: 'checkbox',
          name: `checkbox_${pageIndex + 1}_${id.slice(0, 6)}`,
          required: false,
          fontSize: 12,
          background: 'none',
        })
        continue
      }

      if (isLikelyUnderlineText(str)) {
        const id = crypto.randomUUID()
        const pad = 2
        const width = Math.min(w + 10, viewport.width - vx - 10)
        const height = Math.max(18, h + 8)

        const [x1, y1] = viewport.convertToPdfPoint(vx - pad, vy - height)
        const [x2, y2] = viewport.convertToPdfPoint(vx + width, vy + pad)

        const rect = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }

        results.push({
          id,
          pageIndex,
          rect,
          feature: 'fillable',
          kind: 'text',
          name: `text_${pageIndex + 1}_${id.slice(0, 6)}`,
          required: false,
          fontSize: 12,
          background: 'none',
        })
      }

      if (isSignatureLabel(str)) {
        const id = crypto.randomUUID()
        const [x1, y1] = viewport.convertToPdfPoint(vx + 60, vy - 26)
        const [x2, y2] = viewport.convertToPdfPoint(vx + 280, vy - 6)
        const rect = {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }

        results.push({
          id,
          pageIndex,
          rect,
          feature: 'fillable',
          kind: 'signature',
          name: `signature_${pageIndex + 1}_${id.slice(0, 6)}`,
          required: false,
          fontSize: 12,
          background: 'none',
        })
      }
    }

    const beforeAggressive = results.length
    if (mode === 'aggressive') {
      let opList: Awaited<ReturnType<typeof page.getOperatorList>> | null = null
      try {
        opList = await page.getOperatorList()
      } catch {
        opList = null
      }

      if (opList) {
        const underlineBoxes: Array<{
          x: number
          y: number
          width: number
          height: number
        }> = []
        const inputBoxes: Array<{
          x: number
          y: number
          width: number
          height: number
        }> = []
        const squareBoxes: Array<{
          x: number
          y: number
          width: number
          height: number
        }> = []
        const labelBoxes: Array<{
          x: number
          y: number
          width: number
          height: number
        }> = []

        const stack: Array<[number, number, number, number, number, number]> = []
        let m: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]

        for (let i = 0; i < opList.fnArray.length; i += 1) {
          const fn = opList.fnArray[i]

          if (fn === OPS.save) {
            stack.push([...m] as [number, number, number, number, number, number])
            continue
          }
          if (fn === OPS.restore) {
            m = stack.pop() ?? [1, 0, 0, 1, 0, 0]
            continue
          }
          if (fn === OPS.transform) {
            const args = opList.argsArray[i] as unknown
            if (Array.isArray(args) && args.length >= 6) {
              const a = Number(args[0])
              const b = Number(args[1])
              const c = Number(args[2])
              const d = Number(args[3])
              const e = Number(args[4])
              const f = Number(args[5])
              if ([a, b, c, d, e, f].every((n) => Number.isFinite(n))) {
                m = multiply(m, [a, b, c, d, e, f])
              }
            }
            continue
          }

          if (fn !== OPS.constructPath) continue

          const fnArgs = opList.argsArray[i] as unknown
          if (!Array.isArray(fnArgs) || fnArgs.length < 3) continue

          const op = Number(fnArgs[0])
          if (
            op !== OPS.stroke &&
            op !== OPS.closeStroke &&
            op !== OPS.fill &&
            op !== OPS.eoFill &&
            op !== OPS.fillStroke &&
            op !== OPS.eoFillStroke
          ) {
            continue
          }

          const bbox =
            computePathMinMax(fnArgs[1]) ??
            findMinMaxCandidate(fnArgs[2]) ??
            findMinMaxCandidate(fnArgs)
          if (!bbox) continue

          const [x0, y0, x1, y1] = transformMinMax(bbox, m)
          const minX = clamp(Math.min(x0, x1), 0, viewport.width)
          const minY = clamp(Math.min(y0, y1), 0, viewport.height)
          const maxX = clamp(Math.max(x0, x1), 0, viewport.width)
          const maxY = clamp(Math.max(y0, y1), 0, viewport.height)
          const width = maxX - minX
          const height = maxY - minY
          if (!(width > 0 && height > 0)) continue

          if (width > viewport.width * 0.98 && height > viewport.height * 0.98)
            continue

          const aspect = width / Math.max(0.001, height)

          const isUnderline =
            height <= 3 && width >= 70 && width <= viewport.width * 0.95 && aspect >= 20
          const isInputBox =
            height >= 10 &&
            height <= 32 &&
            width >= 60 &&
            width <= 420 &&
            width <= viewport.width * 0.95 &&
            aspect >= 2.2
          const isSmallSquare =
            width >= 9 &&
            width <= 24 &&
            height >= 9 &&
            height <= 24 &&
            aspect >= 0.7 &&
            aspect <= 1.4
          const isLabeledBox =
            width >= 70 &&
            width <= 360 &&
            height >= 16 &&
            height <= 48 &&
            aspect >= 1.6 &&
            aspect <= 30

          if (isUnderline) {
            underlineBoxes.push({ x: minX, y: minY, width, height })
          } else if (isInputBox) {
            inputBoxes.push({ x: minX, y: minY, width, height })
          } else if (isSmallSquare) {
            squareBoxes.push({ x: minX, y: minY, width, height })
          } else if (isLabeledBox) {
            labelBoxes.push({ x: minX, y: minY, width, height })
          }
        }

        if (underlineBoxes.length > 0 && underlineBoxes.length <= 60) {
          const signatureMarks = textMarks.filter((t) => isSignatureLabel(t.str))

          for (const b of underlineBoxes) {
            const lineY = b.y

            const isSignature = signatureMarks.some(
              (t) => Math.abs(t.cy - lineY) <= 34 && t.rect.x <= b.x + 140,
            )

            const hasLabel =
              isSignature ||
              textMarks.some((t) => {
                if (isLikelyUnderlineText(t.str)) return false
                if (Math.abs(t.cy - lineY) > 18) return false
                const right = t.rect.x + t.rect.width
                if (right > b.x + 10) return false
                if (right < b.x - 260) return false
                return true
              })

            if (!hasLabel) continue
            if (!isSignature && b.width > viewport.width * 0.85) continue

            const kind: FillableFieldElement['kind'] = isSignature ? 'signature' : 'text'
            const id = crypto.randomUUID()
            const padX = 2
            const targetHeight = kind === 'signature' ? 24 : 22
            const x = clamp(b.x - padX, 0, viewport.width)
            const maxWidth = kind === 'signature' ? 460 : 360
            const width = clamp(
              Math.min(b.width + padX * 2, maxWidth),
              8,
              viewport.width - x,
            )
            const y = clamp(b.y + 2, 0, viewport.height - targetHeight)
            const rect = { x, y, width, height: targetHeight }

            results.push({
              id,
              pageIndex,
              rect,
              feature: 'fillable',
              kind,
              name: `${kind}_${pageIndex + 1}_${id.slice(0, 6)}`,
              required: false,
              fontSize: 12,
              background: 'none',
            })
          }
        }

        if (labelBoxes.length > 0 && labelBoxes.length <= 120) {
          for (const b of labelBoxes) {
            const inside = textMarks.filter(
              (t) =>
                t.cx >= b.x - 2 &&
                t.cx <= b.x + b.width + 2 &&
                t.cy >= b.y - 2 &&
                t.cy <= b.y + b.height + 2,
            )
            if (inside.length === 0) continue

            let textRight = -Infinity
            for (const t of inside) {
              const r = t.rect
              textRight = Math.max(textRight, r.x + r.width)
            }

            const fieldX = textRight + 6
            const fieldWidth = b.x + b.width - fieldX - 4
            if (fieldWidth < 36) continue

            const id = crypto.randomUUID()
            const kind: FillableFieldElement['kind'] =
              fieldWidth >= 180 ? 'signature' : 'text'
            const rect = {
              x: clamp(fieldX, 0, viewport.width),
              y: clamp(b.y + 3, 0, viewport.height),
              width: clamp(
                Math.min(fieldWidth, kind === 'signature' ? 460 : 360),
                8,
                viewport.width - clamp(fieldX, 0, viewport.width),
              ),
              height: clamp(b.height - 6, 12, 48),
            }

            results.push({
              id,
              pageIndex,
              rect,
              feature: 'fillable',
              kind,
              name: `${kind}_${pageIndex + 1}_${id.slice(0, 6)}`,
              required: false,
              fontSize: 12,
              background: 'none',
            })
          }
        }

        if (inputBoxes.length > 0 && inputBoxes.length <= 220) {
          for (const b of inputBoxes) {
            if (b.width > viewport.width * 0.9) continue
            const id = crypto.randomUUID()
            const rect = {
              x: clamp(b.x + 4, 0, viewport.width),
              y: clamp(b.y + 3, 0, viewport.height),
              width: clamp(b.width - 8, 8, viewport.width - clamp(b.x + 4, 0, viewport.width)),
              height: clamp(b.height - 6, 12, 28),
            }
            results.push({
              id,
              pageIndex,
              rect,
              feature: 'fillable',
              kind: 'text',
              name: `text_${pageIndex + 1}_${id.slice(0, 6)}`,
              required: false,
              fontSize: 12,
              background: 'none',
            })
          }
        }

        if (squareBoxes.length > 0 && squareBoxes.length <= 80) {
          for (const b of squareBoxes) {
            const id = crypto.randomUUID()
            const size = Math.min(Math.max(b.width, b.height), 20)
            const x = clamp(b.x - 1, 0, viewport.width - size)
            const y = clamp(b.y - 1, 0, viewport.height - size)
            const rect = { x, y, width: size, height: size }
            results.push({
              id,
              pageIndex,
              rect,
              feature: 'fillable',
              kind: 'checkbox',
              name: `checkbox_${pageIndex + 1}_${id.slice(0, 6)}`,
              required: false,
              fontSize: 12,
              background: 'none',
            })
          }
        }
      }
    }

    if (mode === 'aggressive') {
      const added = results.slice(beforeAggressive)
      const addedNonCheckbox = added.some((a) => a.kind !== 'checkbox')
      if (!addedNonCheckbox) {
        const fallback = detectFieldsFromLabels(textMarks, viewport.width, viewport.height, pageIndex)
        results.push(...fallback)
      }
    }
  }

  return dedupeOverlaps(results)
}

function detectFieldsFromLabels(
  marks: TextMark[],
  pageWidth: number,
  pageHeight: number,
  pageIndex: number,
): FillableFieldElement[] {
  const out: FillableFieldElement[] = []
  const candidates = marks
    .map((t) => ({ ...t, s: t.str.trim() }))
    .filter((t) => t.s.length >= 2 && t.s.length <= 46)
    .filter((t) => t.fontSize <= 13)
    .filter((t) => t.cy >= 110)
    .filter((t) => isLikelyFieldLabel(t.s))

  for (const t of candidates) {
    const labelRight = t.rect.x + t.rect.width
    const startX = labelRight + 8
    if (startX >= pageWidth - 40) continue

    const lineBand = Math.max(8, t.fontSize * 0.9)
    let width = Math.min(260, pageWidth - 20 - startX)
    const blockers = marks
      .filter((o) => o !== t)
      .filter((o) => Math.abs(o.cy - t.cy) <= lineBand)
      .map((o) => o.rect.x)
      .filter((x) => x > startX + 20)
    const nextTextX = blockers.length > 0 ? Math.min(...blockers) : null
    if (nextTextX !== null && Number.isFinite(nextTextX)) {
      width = Math.min(width, nextTextX - startX - 8)
    }

    const kind: FillableFieldElement['kind'] = isSignatureLabel(t.s)
      ? 'signature'
      : 'text'
    const height = kind === 'signature' ? 24 : 22
    const cappedWidth = Math.min(
      width,
      kind === 'signature' ? 460 : labelWidthHint(t.s),
    )
    if (cappedWidth < 70) continue

    const x = clamp(startX, 0, pageWidth - 8)
    const y = clamp(t.cy - (kind === 'signature' ? 22 : 18), 0, pageHeight - height)
    const rect = {
      x,
      y,
      width: clamp(cappedWidth, 8, pageWidth - x),
      height,
    }

    const id = crypto.randomUUID()
    out.push({
      id,
      pageIndex,
      rect,
      feature: 'fillable',
      kind,
      name: `${kind}_${pageIndex + 1}_${id.slice(0, 6)}`,
      required: false,
      fontSize: 12,
      background: 'none',
    })
  }

  return dedupeOverlaps(out)
}

function isLikelyFieldLabel(s: string): boolean {
  const low = s.toLowerCase()
  if (low.includes('@')) return false
  if (/\b(daikin|air conditioning|italy s\.p\.a|pag\.)\b/i.test(s)) return false
  if (/^[0-9\s./-]+$/.test(s)) return false
  if (/(?:\bcap\b|\bprov\b|\bcitt[aà]\b|\bvia\b|\btel\b|\bfax\b|e-?mail)/i.test(s)) return true
  if (/(?:\bn\.\s*(?:matricola|progressivo)\b|\bmatricola\b|\bmodello\b)/i.test(s)) return true
  if (/(?:\bdata\b|\bintervento\b|\btracing\b|\bnumber\b|\bgaranzia\b)/i.test(s)) return true
  if (/(?:\bnome\b|\bragione\b|\binstallatore\b|\bresponsabile\b|\bcentro\b|\bservizi\b)/i.test(s)) return true
  return false
}

function labelWidthHint(s: string): number {
  if (/\bcap\b/i.test(s)) return 90
  if (/\bprov\b/i.test(s)) return 90
  if (/\bcitt[aà]\b/i.test(s)) return 180
  if (/\bdata\b/i.test(s)) return 150
  if (/\bmatricola\b/i.test(s)) return 260
  if (/\bmodello\b/i.test(s)) return 260
  return 320
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function computePathMinMax(dataArg: unknown): [number, number, number, number] | null {
  const arr = findDrawOpsArrayLike(dataArg)
  if (!arr) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < arr.length; ) {
    const op = Number(arr[i++])
    if (!Number.isFinite(op)) break

    if (op === 0) {
      const x = Number(arr[i++])
      const y = Number(arr[i++])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      continue
    }

    if (op === 1) {
      const x = Number(arr[i++])
      const y = Number(arr[i++])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      continue
    }

    if (op === 2) {
      const x1 = Number(arr[i++])
      const y1 = Number(arr[i++])
      const x2 = Number(arr[i++])
      const y2 = Number(arr[i++])
      const x = Number(arr[i++])
      const y = Number(arr[i++])
      if ([x1, y1, x2, y2, x, y].every((n) => Number.isFinite(n))) {
        minX = Math.min(minX, x1, x2, x)
        minY = Math.min(minY, y1, y2, y)
        maxX = Math.max(maxX, x1, x2, x)
        maxY = Math.max(maxY, y1, y2, y)
      }
      continue
    }

    if (op === 3) {
      const x1 = Number(arr[i++])
      const y1 = Number(arr[i++])
      const x = Number(arr[i++])
      const y = Number(arr[i++])
      if ([x1, y1, x, y].every((n) => Number.isFinite(n))) {
        minX = Math.min(minX, x1, x)
        minY = Math.min(minY, y1, y)
        maxX = Math.max(maxX, x1, x)
        maxY = Math.max(maxY, y1, y)
      }
      continue
    }

    if (op === 4) {
      continue
    }

    break
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  if (maxX <= minX || maxY <= minY) return null
  return [minX, minY, maxX, maxY]
}

function findDrawOpsArrayLike(
  v: unknown,
): { length: number; [k: number]: unknown } | null {
  const direct = asArrayLike(v)
  if (direct && direct.length >= 3) return direct

  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findDrawOpsArrayLike(item)
      if (found) return found
    }
  }

  return null
}

function asArrayLike(v: unknown): { length: number; [k: number]: unknown } | null {
  if (!v) return null
  if (typeof v !== 'object') return null
  const anyV = v as unknown as { length?: unknown; [k: number]: unknown }
  const len = Number(anyV.length)
  if (!Number.isFinite(len) || len <= 0) return null
  return anyV as { length: number; [k: number]: unknown }
}

function findMinMaxCandidate(v: unknown): [number, number, number, number] | null {
  const direct = readMinMax(v)
  if (direct) return direct

  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findMinMaxCandidate(item)
      if (found) return found
    }
  }

  return null
}

function readMinMax(v: unknown): [number, number, number, number] | null {
  if (!v || typeof v !== 'object') return null
  const anyV = v as unknown as { length?: unknown; [k: number]: unknown }
  if (anyV.length !== 4) return null
  const x1 = Number(anyV[0])
  const y1 = Number(anyV[1])
  const x2 = Number(anyV[2])
  const y2 = Number(anyV[3])
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null
  if (x2 <= x1 || y2 <= y1) return null
  return [x1, y1, x2, y2]
}

function multiply(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function transformMinMax(
  minMax: [number, number, number, number],
  m: [number, number, number, number, number, number],
): [number, number, number, number] {
  const x0 = minMax[0]
  const y0 = minMax[1]
  const x1 = minMax[2]
  const y1 = minMax[3]

  const p1 = applyTransform(x0, y0, m)
  const p2 = applyTransform(x0, y1, m)
  const p3 = applyTransform(x1, y0, m)
  const p4 = applyTransform(x1, y1, m)

  const minX = Math.min(p1[0], p2[0], p3[0], p4[0])
  const minY = Math.min(p1[1], p2[1], p3[1], p4[1])
  const maxX = Math.max(p1[0], p2[0], p3[0], p4[0])
  const maxY = Math.max(p1[1], p2[1], p3[1], p4[1])
  return [minX, minY, maxX, maxY]
}

function applyTransform(
  x: number,
  y: number,
  m: [number, number, number, number, number, number],
): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
}

function dedupeOverlaps(fields: FillableFieldElement[]): FillableFieldElement[] {
  const out: FillableFieldElement[] = []
  for (const f of fields) {
    const exists = out.some(
      (o) => o.pageIndex === f.pageIndex && iou(o.rect, f.rect) > 0.65,
    )
    if (!exists) out.push(f)
  }
  return out
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
