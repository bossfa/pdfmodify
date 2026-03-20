import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { RebrandElement } from '../workspace/types'

type ExportMode = 'flat' | 'template'

export async function exportRebrandedPdf(
  originalBytes: Uint8Array,
  elements: RebrandElement[],
  opts: { mode: ExportMode },
): Promise<Uint8Array> {
  const bytes =
    originalBytes.byteOffset === 0 &&
    originalBytes.byteLength === originalBytes.buffer.byteLength
      ? originalBytes
      : new Uint8Array(originalBytes)
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const form = pdfDoc.getForm()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const usedNames = new Set<string>()

  for (const el of elements) {
    const page = pdfDoc.getPage(el.pageIndex)

    if (el.kind === 'logo') {
      const img =
        el.imageMime === 'image/png'
          ? await pdfDoc.embedPng(el.imageBytes)
          : await pdfDoc.embedJpg(el.imageBytes)

      if (el.background === 'white') {
        page.drawRectangle({
          x: el.rect.x,
          y: el.rect.y,
          width: el.rect.width,
          height: el.rect.height,
          color: rgb(1, 1, 1),
          opacity: 1,
        })
      }

      page.drawImage(img, {
        x: el.rect.x,
        y: el.rect.y,
        width: el.rect.width,
        height: el.rect.height,
        opacity: Math.max(0, Math.min(1, el.opacity)),
      })
      continue
    }

    const shouldCreateField =
      opts.mode === 'template' && el.asTemplateField === true

    if (el.background === 'white') {
      page.drawRectangle({
        x: el.rect.x,
        y: el.rect.y,
        width: el.rect.width,
        height: el.rect.height,
        color: rgb(1, 1, 1),
        opacity: 1,
      })
    }

    if (shouldCreateField) {
      const name = ensureUniqueFieldName(
        sanitizeFieldName(el.fieldName),
        usedNames,
      )
      const field = form.createTextField(name)
      field.setText(el.value ?? '')
      field.addToPage(page, {
        x: el.rect.x,
        y: el.rect.y,
        width: el.rect.width,
        height: el.rect.height,
        font,
      })
      setTextDefaultAppearance(field, font.name, el.fontSize)
      try {
        field.updateAppearances(font)
      } catch {
        void 0
      }
      continue
    }

    page.drawText(el.value ?? '', {
      x: el.rect.x,
      y: el.rect.y + Math.max(0, el.rect.height - el.fontSize) / 2,
      size: el.fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: el.rect.width,
    })
  }

  try {
    form.updateFieldAppearances(font)
  } catch {
    void 0
  }
  if (opts.mode === 'flat') {
    form.flatten()
  }
  return await pdfDoc.save({ updateFieldAppearances: true })
}

function sanitizeFieldName(input: string): string {
  const trimmed = input.trim() || 'field'
  const normalized = trimmed.replace(/\s+/g, '_')
  const safe = normalized.replace(/[^a-zA-Z0-9_.-]/g, '_')
  return safe.length > 64 ? safe.slice(0, 64) : safe
}

function setTextDefaultAppearance(
  field: { acroField: { setDefaultAppearance(appearance: string): void } },
  fontName: string,
  fontSize: number,
): void {
  const safeFontName = fontName.replace(/^\//, '') || 'Helv'
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12
  field.acroField.setDefaultAppearance(
    `0 0 0 rg\n/${safeFontName} ${safeFontSize} Tf`,
  )
}

function ensureUniqueFieldName(base: string, used: Set<string>): string {
  let name = base
  let i = 1
  while (used.has(name)) {
    i += 1
    name = `${base}_${i}`
  }
  used.add(name)
  return name
}
