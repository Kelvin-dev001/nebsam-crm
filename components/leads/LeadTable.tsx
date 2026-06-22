"use client"

import { type Table, flexRender } from "@tanstack/react-table"
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { ProcessedLead } from "./LeadsShell"

interface Props {
  table: Table<ProcessedLead>
  loading: boolean
}

export function LeadTable({ table, loading }: Props) {
  const rows = table.getRowModel().rows
  const totalFiltered = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize } = table.getState().pagination

  return (
    <div className="space-y-3">
      {/* Scrollable table wrapper */}
      <div className="rounded-lg border border-slate-200 overflow-x-auto">
        <UITable>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-slate-50 hover:bg-slate-50">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap py-3",
                        canSort && "cursor-pointer select-none"
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span className="text-slate-400">
                            {sorted === "asc" ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : sorted === "desc" ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronsUpDown className="h-3 w-3" />
                            )}
                          </span>
                        )}
                      </div>
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getAllColumns().map((col) => (
                    <TableCell key={col.id}>
                      <Skeleton className="h-4 w-full max-w-[120px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={table.getAllColumns().length} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-10 w-10 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">No leads found</p>
                    <p className="text-xs text-slate-400">Try adjusting the filters above</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-slate-50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5 text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </UITable>
      </div>

      {/* Pagination */}
      {!loading && totalFiltered > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-500">
            {pageIndex * pageSize + 1}–{Math.min((pageIndex + 1) * pageSize, totalFiltered)} of {totalFiltered}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-slate-600 px-2">
              Page {pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
