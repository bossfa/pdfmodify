import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export async function createSampleFillablePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  page.drawText('Demo - Rendi compilabile', {
    x: 50,
    y: 780,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  })

  const labels: Array<{ label: string; y: number; kind: 'text' | 'checkbox' }> =
    [
      { label: 'Nome e Cognome:', y: 720, kind: 'text' },
      { label: 'Indirizzo:', y: 680, kind: 'text' },
      { label: 'Città:', y: 640, kind: 'text' },
      { label: 'Accetto termini e condizioni', y: 580, kind: 'checkbox' },
    ]

  for (const row of labels) {
    page.drawText(row.label, { x: 50, y: row.y, size: 12, font })

    if (row.kind === 'text') {
      page.drawLine({
        start: { x: 170, y: row.y - 2 },
        end: { x: 520, y: row.y - 2 },
        thickness: 1,
        color: rgb(0.2, 0.2, 0.2),
      })
      page.drawText('______________________________', {
        x: 170,
        y: row.y - 1,
        size: 10,
        font,
        color: rgb(0.25, 0.25, 0.25),
      })
    } else {
      page.drawRectangle({
        x: 50,
        y: row.y - 28,
        width: 14,
        height: 14,
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1,
        color: rgb(1, 1, 1),
      })
      page.drawText('[ ]', { x: 51, y: row.y - 26, size: 10, font })
    }
  }

  page.drawText('Firma:', { x: 50, y: 500, size: 12, font })
  page.drawLine({
    start: { x: 100, y: 498 },
    end: { x: 350, y: 498 },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  })
  page.drawText('_________________________', {
    x: 100,
    y: 499,
    size: 10,
    font,
    color: rgb(0.25, 0.25, 0.25),
  })

  return await pdf.save()
}

export async function createSampleRebrandPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89])

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  page.drawRectangle({
    x: 0,
    y: 810,
    width: 595.28,
    height: 31.89,
    color: rgb(0.94, 0.94, 0.96),
  })

  page.drawText('ACME S.p.A.', { x: 50, y: 822, size: 14, font: fontBold })
  page.drawText('P.IVA 00000000000 - Via Vecchia 1, Milano', {
    x: 180,
    y: 822,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2),
  })

  page.drawText('Contratto di fornitura - Demo rebranding', {
    x: 50,
    y: 770,
    size: 16,
    font: fontBold,
  })

  page.drawText(
    'Il presente documento è un esempio. In modalità rebranding puoi sovrascrivere logo e dati anagrafici mantenendo impaginazione e struttura.',
    { x: 50, y: 740, size: 11, font, maxWidth: 500, lineHeight: 14 },
  )

  page.drawText('Dati aziendali:', { x: 50, y: 690, size: 12, font: fontBold })
  page.drawText('Ragione sociale: ACME S.p.A.', {
    x: 70,
    y: 665,
    size: 11,
    font,
  })
  page.drawText('Indirizzo: Via Vecchia 1, 20100 Milano', {
    x: 70,
    y: 645,
    size: 11,
    font,
  })
  page.drawText('P.IVA: 00000000000', {
    x: 70,
    y: 625,
    size: 11,
    font,
  })

  page.drawLine({
    start: { x: 50, y: 600 },
    end: { x: 545, y: 600 },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.88),
  })

  page.drawText('Sezione contenuto', { x: 50, y: 570, size: 12, font: fontBold })
  page.drawText(
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor.',
    { x: 50, y: 545, size: 11, font, maxWidth: 500, lineHeight: 14 },
  )

  return await pdf.save()
}
