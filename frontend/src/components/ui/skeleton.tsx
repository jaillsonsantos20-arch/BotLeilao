import { cn } from '@/lib/utils';

/**
 * Esqueleto de carregamento (skeleton).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
