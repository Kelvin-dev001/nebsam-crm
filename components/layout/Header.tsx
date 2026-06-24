import { TelemarketerSwitcher } from "./TelemarketerSwitcher"
import { NotificationBell } from "./NotificationBell"

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 lg:left-60 z-40 h-16 flex items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <span className="text-base font-bold text-slate-800 lg:hidden">Nebsam CRM</span>
      <div className="hidden lg:block" />
      <div className="flex items-center gap-2">
        <NotificationBell />
        <TelemarketerSwitcher />
      </div>
    </header>
  )
}
