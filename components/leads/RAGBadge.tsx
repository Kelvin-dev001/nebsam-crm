import { RAGStatus } from "@/types/crm"
import { cn } from "@/lib/utils"

const RAG: Record<RAGStatus, { dot: string; label: string; text: string }> = {
  green: { dot: "bg-green-500",  label: "Green", text: "text-green-700" },
  amber: { dot: "bg-amber-500",  label: "Amber", text: "text-amber-700" },
  red:   { dot: "bg-red-500",    label: "Red",   text: "text-red-700"   },
}

interface Props {
  status: RAGStatus
  showLabel?: boolean
  className?: string
}

export function RAGBadge({ status, showLabel = true, className }: Props) {
  const config = RAG[status] ?? RAG.red
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("h-2 w-2 rounded-full shrink-0", config.dot)} />
      {showLabel && (
        <span className={cn("text-xs font-medium", config.text)}>{config.label}</span>
      )}
    </span>
  )
}
