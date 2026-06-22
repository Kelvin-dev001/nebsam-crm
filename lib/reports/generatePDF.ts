import type { TelemarketerReport } from "./fetchReportData"

const NAVY = "#0F1729"
const BLUE = "#2563EB"
const GREEN = "#16A34A"
const AMBER = "#D97706"
const RED = "#DC2626"
const LIGHT_GRAY = "#F1F5F9"
const MID_GRAY = "#94A3B8"
const DARK_TEXT = "#1E293B"

const RANK_LABELS = ["🥇 1st", "🥈 2nd", "🥉 3rd"]

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function setFill(doc: any, hex: string) {
  doc.setFillColor(...hexToRgb(hex))
}

function setTextColor(doc: any, hex: string) {
  doc.setTextColor(...hexToRgb(hex))
}

function setDrawColor(doc: any, hex: string) {
  doc.setDrawColor(...hexToRgb(hex))
}

function buildPage(doc: any, report: TelemarketerReport, date: string, allReports: TelemarketerReport[]) {
  const W = 210 // A4 width mm
  const margin = 14
  let y = 0

  // ── Header band ─────────────────────────────────────────────
  setFill(doc, NAVY)
  doc.rect(0, 0, W, 28, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  setTextColor(doc, "#FFFFFF")
  doc.text("Nebsam Digital Solutions", margin, 11)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  setTextColor(doc, "#94A3B8")
  doc.text("Daily Performance Report", margin, 18)

  // Date + telemarketer on the right
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  setTextColor(doc, "#FFFFFF")
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-KE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  })
  doc.text(dateLabel, W - margin, 11, { align: "right" })
  doc.setFont("helvetica", "normal")
  setTextColor(doc, "#94A3B8")
  doc.text(report.name, W - margin, 18, { align: "right" })

  y = 36

  // ── Rank badge ───────────────────────────────────────────────
  const rankLabel = RANK_LABELS[report.rank - 1] ?? `#${report.rank}`
  const rankColor = report.rank === 1 ? "#CA8A04" : report.rank === 2 ? "#64748B" : "#92400E"
  setFill(doc, rankColor)
  doc.roundedRect(margin, y, 36, 9, 2, 2, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  setTextColor(doc, "#FFFFFF")
  doc.text(rankLabel, margin + 18, y + 6, { align: "center" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  setTextColor(doc, MID_GRAY)
  doc.text("ranked by calls today among all telemarketers", margin + 40, y + 6)

  y += 17

  // ── Stats grid (2 columns) ───────────────────────────────────
  const colW = (W - margin * 2 - 6) / 2
  const stats = [
    { label: "Total Leads Assigned", value: String(report.totalLeads), color: BLUE },
    { label: "Calls Made Today", value: String(report.callsOnDate), color: BLUE },
    { label: "Leads Won Today", value: String(report.winsOnDate), color: GREEN },
    { label: "Win Rate (All-Time)", value: `${report.winRate}%`, color: report.winRate >= 20 ? GREEN : report.winRate >= 10 ? AMBER : RED },
  ]

  stats.forEach((s, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (colW + 6)
    const sy = y + row * 22

    setFill(doc, LIGHT_GRAY)
    doc.roundedRect(x, sy, colW, 18, 2, 2, "F")

    setTextColor(doc, s.color)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(16)
    doc.text(s.value, x + 6, sy + 11)

    setTextColor(doc, MID_GRAY)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.text(s.label.toUpperCase(), x + 6, sy + 16)
  })

  y += 50

  // ── RAG Breakdown ────────────────────────────────────────────
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  setTextColor(doc, DARK_TEXT)
  doc.text("RAG STATUS BREAKDOWN", margin, y)
  y += 5

  const ragItems = [
    { label: "Green — High Intent", count: report.ragGreen, color: GREEN },
    { label: "Amber — Moderate", count: report.ragAmber, color: AMBER },
    { label: "Red — Cold", count: report.ragRed, color: RED },
  ]

  const ragW = (W - margin * 2 - 8) / 3
  ragItems.forEach((r, i) => {
    const x = margin + i * (ragW + 4)
    setFill(doc, r.color)
    doc.roundedRect(x, y, ragW, 14, 2, 2, "F")
    setTextColor(doc, "#FFFFFF")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.text(String(r.count), x + ragW / 2, y + 9, { align: "center" })
    doc.setFont("helvetica", "normal")
    doc.setFontSize(6.5)
    doc.text(r.label.toUpperCase(), x + ragW / 2, y + 13.5, { align: "center" })
  })

  y += 24

  // ── Comparison table ─────────────────────────────────────────
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  setTextColor(doc, DARK_TEXT)
  doc.text("ALL TELEMARKETERS — TODAY", margin, y)
  y += 5

  const headers = ["Telemarketer", "Total Leads", "Calls Today", "Wins Today", "Win Rate", "Rank"]
  const colWidths = [38, 25, 25, 25, 25, 20]
  const rowH = 8

  // Header row
  setFill(doc, NAVY)
  doc.rect(margin, y, W - margin * 2, rowH, "F")
  setTextColor(doc, "#FFFFFF")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(7.5)
  let cx = margin + 3
  headers.forEach((h, i) => {
    doc.text(h, cx, y + 5.5)
    cx += colWidths[i]
  })
  y += rowH

  // Data rows
  allReports.forEach((r, rowIdx) => {
    const isActive = r.id === report.id
    setFill(doc, isActive ? "#EFF6FF" : rowIdx % 2 === 0 ? "#FFFFFF" : LIGHT_GRAY)
    doc.rect(margin, y, W - margin * 2, rowH, "F")

    if (isActive) {
      setDrawColor(doc, BLUE)
      doc.setLineWidth(0.4)
      doc.rect(margin, y, W - margin * 2, rowH, "S")
      doc.setLineWidth(0.2)
    }

    const rankLabel = RANK_LABELS[r.rank - 1] ?? `#${r.rank}`
    const row = [r.name, String(r.totalLeads), String(r.callsOnDate), String(r.winsOnDate), `${r.winRate}%`, rankLabel]

    cx = margin + 3
    row.forEach((val, i) => {
      setTextColor(doc, isActive && i === 0 ? BLUE : DARK_TEXT)
      doc.setFont("helvetica", isActive && i === 0 ? "bold" : "normal")
      doc.setFontSize(7.5)
      doc.text(val, cx, y + 5.5)
      cx += colWidths[i]
    })
    y += rowH
  })

  // ── Footer ───────────────────────────────────────────────────
  const footerY = 287
  setFill(doc, LIGHT_GRAY)
  doc.rect(0, footerY - 2, W, 12, "F")

  setTextColor(doc, MID_GRAY)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  const now = new Date().toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium",
    timeStyle: "short",
  })
  doc.text(`Generated by Nebsam CRM on ${now} EAT`, margin, footerY + 4)
  doc.text("Nebsam Digital Solutions · nebsamdigital.co.ke", W - margin, footerY + 4, { align: "right" })
}

export async function generatePDF(
  reports: TelemarketerReport[],
  date: string,
): Promise<any> {
  // Dynamic import avoids SSR errors in Next.js App Router
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  reports.forEach((report, i) => {
    if (i > 0) doc.addPage()
    buildPage(doc, report, date, reports)
  })

  return doc
}

export async function downloadReport(
  reports: TelemarketerReport[],
  date: string,
  filename: string,
) {
  const doc = await generatePDF(reports, date)
  doc.save(filename)
}
