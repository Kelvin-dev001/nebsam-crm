import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

// Must forwardRef: react-hook-form's register() attaches the field via a ref
// callback. This wrapper is a plain function component, and on React 18 `ref`
// is handled specially and never appears in props — so {...props} silently
// dropped it before it ever reached base-ui's InputPrimitive. The field was
// never added to RHF's _fields map and its value was never captured, which is
// why KYC fields, follow-up date, and duration all persisted as null/empty
// (0 follow-up_schedule rows, 0 durations across 264 calls). forwardRef wires
// the ref through so RHF can register the underlying <input>.
const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => {
  return (
    <InputPrimitive
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
