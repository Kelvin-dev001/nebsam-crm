import { RAGStatus } from "@/types/crm"

export const RAG_COLORS: Record<RAGStatus, string> = {
  green: "#16A34A",
  amber: "#D97706",
  red: "#DC2626",
}

export const RAG_BG_CLASSES: Record<RAGStatus, string> = {
  green: "bg-green-600",
  amber: "bg-amber-600",
  red: "bg-red-600",
}

export const RAG_LABELS: Record<RAGStatus, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
}

export function getRAGLabel(status: RAGStatus): string {
  return RAG_LABELS[status]
}
