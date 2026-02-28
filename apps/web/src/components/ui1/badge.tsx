import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-transparent [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground border-transparent [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white border-transparent [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        open: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
        full: "bg-amber-900/50 text-amber-300 border-amber-700",
        "in-progress": "bg-blue-900/50 text-blue-300 border-blue-700",
        settled: "bg-zinc-800 text-zinc-400 border-zinc-600",
        win: "bg-emerald-900/50 text-emerald-300 border-emerald-700",
        loss: "bg-red-900/50 text-red-300 border-red-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
