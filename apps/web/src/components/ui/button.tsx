import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import { ButtonSvg } from "./button-svg";

type ButtonVariant = "primary" | "secondary" | "link" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  asChild?: boolean;
}

const BASE =
  "relative inline-flex items-center justify-center font-semibold tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 cursor-pointer";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "text-foreground hover:text-primary",
  secondary: "text-neutral-700 hover:text-neutral-700/80",
  link: "text-neutral-200 hover:text-neutral-50 uppercase text-xs tracking-wider",
  ghost: "text-neutral-200 hover:text-neutral-50 hover:bg-neutral-500/50 rounded-xl",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-xs",
  md: "h-11 px-7 text-xs",
  lg: "h-14 px-10 text-sm",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-14 w-14",
};

const ICON_EL: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      icon = false,
      loading = false,
      leftIcon,
      rightIcon,
      asChild = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    const hasSvg = (variant === "primary" || variant === "secondary") && !icon;
    const classes = cn(BASE, VARIANT[variant], icon ? ICON_SIZE[size] : SIZE[size], className);

    const content = loading ? (
      <Spinner className={ICON_EL[size]} />
    ) : (
      <>
        {leftIcon && <span className={cn("shrink-0", ICON_EL[size])}>{leftIcon}</span>}
        {children}
        {rightIcon && <span className={cn("shrink-0", ICON_EL[size])}>{rightIcon}</span>}
      </>
    );

    if (asChild) {
      if (hasSvg) {
        const child = React.Children.only(children) as React.ReactElement<
          Record<string, unknown>
        >;
        const asChildContent = loading ? (
          <Spinner className={ICON_EL[size]} />
        ) : (
          <>
            {leftIcon && <span className={cn("shrink-0", ICON_EL[size])}>{leftIcon}</span>}
            {child.props.children as React.ReactNode}
            {rightIcon && <span className={cn("shrink-0", ICON_EL[size])}>{rightIcon}</span>}
          </>
        );
        return React.cloneElement(
          child,
          {
            className: cn(classes, child.props.className as string | undefined),
            ref,
            ...props,
          },
          <span className="relative z-10 flex items-center gap-2">{asChildContent}</span>,
          <ButtonSvg variant={variant as "primary" | "secondary"} size={size} />
        );
      }
      return (
        <Slot className={classes} ref={ref} aria-disabled={isDisabled || undefined} {...props}>
          {children}
        </Slot>
      );
    }

    if (hasSvg) {
      return (
        <button className={classes} ref={ref} disabled={isDisabled} {...props}>
          <span className="relative z-10 flex items-center gap-2">{content}</span>
          <ButtonSvg variant={variant} size={size} />
        </button>
      );
    }

    return (
      <button className={cn(classes, "gap-2")} ref={ref} disabled={isDisabled} {...props}>
        {content}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
export type { ButtonVariant, ButtonSize };
