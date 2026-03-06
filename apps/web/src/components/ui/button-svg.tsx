import * as React from "react";

type SvgSize = "sm" | "md" | "lg";

const HEIGHT_MAP: Record<SvgSize, number> = {
  sm: 36,
  md: 44,
  lg: 56,
};

interface ButtonSvgProps {
  variant: "primary" | "secondary";
  size?: SvgSize;
}

export function ButtonSvg({ variant, size = "md" }: ButtonSvgProps) {
  const id = React.useId();
  const height = HEIGHT_MAP[size];
  const capWidth = (21 / 44) * height;
  const isWhite = variant === "secondary";

  return (
    <>
      {/* Left cap */}
      <svg
        className="absolute top-0 left-0"
        width={capWidth}
        height={height}
        viewBox="0 0 21 44"
      >
        {!isWhite && (
          <defs>
            <linearGradient id={`${id}-l`} x1="100%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#AC6AFF" />
              <stop offset="100%" stopColor="#FF776F" />
            </linearGradient>
          </defs>
        )}
        <path
          fill={isWhite ? "white" : "none"}
          stroke={isWhite ? "white" : `url(#${id}-l)`}
          strokeWidth="2"
          d="M21,43.00005 L8.11111,43.00005 C4.18375,43.00005 1,39.58105 1,35.36365 L1,8.63637 C1,4.41892 4.18375,1 8.11111,1 L21,1"
        />
      </svg>

      {/* Middle — top/bottom lines (primary) or filled rect (secondary) */}
      <svg
        className="absolute top-0"
        style={{ left: capWidth, width: `calc(100% - ${capWidth * 2}px)` }}
        height={height}
        viewBox="0 0 100 44"
        preserveAspectRatio="none"
        fill={isWhite ? "white" : "none"}
      >
        {isWhite ? (
          <polygon fill="white" fillRule="nonzero" points="100 0 100 44 0 44 0 0" />
        ) : (
          <>
            <defs>
              <linearGradient id={`${id}-t`} x1="0%" x2="100%">
                <stop offset="0%" stopColor="#FF776F" />
                <stop offset="100%" stopColor="#AC6AFF" />
              </linearGradient>
              <linearGradient id={`${id}-b`} x1="0%" x2="100%">
                <stop offset="0%" stopColor="#AC6AFF" />
                <stop offset="100%" stopColor="#FFC876" />
              </linearGradient>
            </defs>
            <polygon fill={`url(#${id}-t)`} fillRule="nonzero" points="100 0 100 2 0 2 0 0" />
            <polygon fill={`url(#${id}-b)`} fillRule="nonzero" points="100 42 100 44 0 44 0 42" />
          </>
        )}
      </svg>

      {/* Right cap */}
      <svg
        className="absolute top-0 right-0"
        width={capWidth}
        height={height}
        viewBox="0 0 21 44"
      >
        {!isWhite && (
          <defs>
            <linearGradient id={`${id}-r`} x1="100%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#FFC876" />
              <stop offset="100%" stopColor="#AC6AFF" />
            </linearGradient>
          </defs>
        )}
        <path
          fill={isWhite ? "white" : "none"}
          stroke={isWhite ? "white" : `url(#${id}-r)`}
          strokeWidth="2"
          d="M0,43.00005 L5.028,43.00005 L12.24,43.00005 C16.526,43.00005 20,39.58105 20,35.36365 L20,16.85855 C20,14.59295 18.978,12.44425 17.209,10.99335 L7.187,2.77111 C5.792,1.62675 4.034,1 2.217,1 L0,1"
        />
      </svg>
    </>
  );
}
