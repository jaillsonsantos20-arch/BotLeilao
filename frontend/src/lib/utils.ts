import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina classes com suporte a conflitos (Tailwind + shadcn).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
