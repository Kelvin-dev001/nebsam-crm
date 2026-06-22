import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-6">
      <p className="text-8xl font-bold text-slate-100 select-none">404</p>
      <div className="-mt-4">
        <h2 className="text-xl font-semibold text-slate-800">Page not found</h2>
        <p className="text-sm text-slate-500 mt-1">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
      </div>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        Go to Dashboard
      </Link>
    </div>
  )
}
