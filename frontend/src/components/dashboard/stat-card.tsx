import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type StatTone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet';

interface StatCardProps {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: StatTone;
  loading?: boolean;
}

const TONES: Record<StatTone, { chip: string; icon: string }> = {
  indigo: { chip: 'bg-indigo-500/12 text-indigo-600 ring-indigo-500/20 dark:text-indigo-400', icon: '' },
  emerald: { chip: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400', icon: '' },
  amber: { chip: 'bg-amber-500/15 text-amber-600 ring-amber-500/25 dark:text-amber-400', icon: '' },
  rose: { chip: 'bg-rose-500/12 text-rose-600 ring-rose-500/20 dark:text-rose-400', icon: '' },
  sky: { chip: 'bg-sky-500/12 text-sky-600 ring-sky-500/20 dark:text-sky-400', icon: '' },
  violet: { chip: 'bg-violet-500/12 text-violet-600 ring-violet-500/20 dark:text-violet-400', icon: '' },
};

/**
 * Card de métrica para o dashboard com chip de ícone colorido.
 */
export function StatCard({ title, value, hint, icon: Icon, tone = 'indigo', loading }: StatCardProps) {
  const t = TONES[tone];
  return (
    <Card className="group hover:shadow-md hover:shadow-primary/5">
      <CardContent className="flex items-start justify-between p-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-4/5" />
          ) : (
            <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          )}
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover:scale-105',
            t.chip,
          )}
        >
          <Icon className="size-[18px]" />
        </div>
      </CardContent>
    </Card>
  );
}