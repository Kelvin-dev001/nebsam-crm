import { TelemarketerSwitcher } from "./TelemarketerSwitcher"

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-60 z-40 h-16 flex items-center justify-between border-b border-slate-200 bg-white px-6">
      <div />
      <TelemarketerSwitcher />
    </header>
  )
}
