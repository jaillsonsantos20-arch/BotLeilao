import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  completeOnboarding,
  getOnboardingStep,
  ONBOARDING_STEPS,
  saveOnboardingStep,
} from './onboarding-steps';

interface OnboardingTourProps {
  open: boolean;
  userId: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal guia do sistema: apresenta os passos do LanceZap em sequência.
 * Passos com "página de destino" oferecem um botão que navega até a tela
 * e ativa o destaque (OnboardingSpotlight) na ação correspondente.
 */
export function OnboardingTour({ open, userId, onOpenChange }: OnboardingTourProps) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(() => getOnboardingStep(userId));

  if (!open) return null;

  const step = ONBOARDING_STEPS[index];
  const total = ONBOARDING_STEPS.length;
  const isLast = index === total - 1;
  const progress = ((index + 1) / total) * 100;

  function close(): void {
    onOpenChange(false);
  }

  function goTo(targetIndex: number): void {
    const next = Math.min(Math.max(targetIndex, 0), total - 1);
    setIndex(next);
    saveOnboardingStep(userId, next);
  }

  function continueToPage(): void {
    if (!step.page) return;
    saveOnboardingStep(userId, index);
    close();
    navigate(`${step.page}?onboarding=${step.id}`);
  }

  function finish(): void {
    completeOnboarding(userId);
    close();
  }

  function skip(): void {
    completeOnboarding(userId);
    close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl">
        <div className="h-1.5 bg-muted">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <Logo size={48} />
            <button
              aria-label="Fechar guia"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={close}
            >
              <X className="size-5" />
            </button>
          </div>

          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
            Passo {index + 1} de {total}
          </p>
          <h2 className="mb-2 text-xl font-semibold tracking-tight">{step.title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {ONBOARDING_STEPS.map((item, i) => (
              <span
                key={item.id}
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  i === index
                    ? 'bg-primary text-primary-foreground'
                    : i < index
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {i < index ? <Check className="size-3.5" /> : i + 1}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 p-4">
          <Button variant="ghost" size="sm" onClick={skip}>
            Pular guia
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>

            {isLast ? (
              <Button size="sm" onClick={finish}>
                <Check className="size-4" />
                Concluir
              </Button>
            ) : step.page ? (
              <Button size="sm" onClick={continueToPage}>
                {step.cta}
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => goTo(index + 1)}>
                Começar
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
