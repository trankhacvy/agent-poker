import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(
  value: number | string,
  { min = 0, max = 2 }: { min?: number; max?: number } = {}
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "0";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
}

export function formatCurrency(
  value: number | string,
  {
    min = 0,
    max = 2,
    currency = "USD",
  }: { min?: number; max?: number; currency?: string } = {}
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "$0";
  return num.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });
}
