"use client"

import { Users, LayoutList, BarChart2, UserCog, Upload, FileBarChart, ArrowRightLeft } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { AllLeadsOverview } from "./AllLeadsOverview"
import { LeadAssignment } from "./LeadAssignment"
import { PerformanceSummary } from "./PerformanceSummary"
import { TelemarketerManager } from "./TelemarketerManager"
import { CSVImport } from "./CSVImport"
import { RoundRobinWidget } from "./RoundRobinWidget"
import { ReportsTab } from "./ReportsTab"

export function AdminShell() {
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
        <p className="text-slate-500 text-sm mt-0.5">Manage leads, telemarketers, and imports</p>
      </div>

      {/* Round Robin Widget — always visible above tabs */}
      <RoundRobinWidget />

      <Tabs defaultValue="overview">
        <TabsList
          variant="line"
          className="border-b border-slate-200 w-full rounded-none pb-0 gap-0 sticky top-16 bg-white z-20 h-auto"
        >
          <TabsTrigger value="overview" className="gap-1.5 px-4 pb-3 text-sm">
            <LayoutList className="h-4 w-4" />
            All Leads
          </TabsTrigger>
          <TabsTrigger value="assignment" className="gap-1.5 px-4 pb-3 text-sm">
            <Users className="h-4 w-4" />
            Assignment
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5 px-4 pb-3 text-sm">
            <BarChart2 className="h-4 w-4" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="telemarketers" className="gap-1.5 px-4 pb-3 text-sm">
            <UserCog className="h-4 w-4" />
            Telemarketers
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5 px-4 pb-3 text-sm">
            <Upload className="h-4 w-4" />
            CSV Import
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5 px-4 pb-3 text-sm">
            <FileBarChart className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <AllLeadsOverview />
        </TabsContent>
        <TabsContent value="assignment" className="mt-4">
          <LeadAssignment />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceSummary />
        </TabsContent>
        <TabsContent value="telemarketers" className="mt-4">
          <TelemarketerManager />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <CSVImport />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
