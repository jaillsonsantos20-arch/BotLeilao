import { useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { completeOnboarding, ONBOARDING_STEPS } from './onboarding-steps';

interface OnboardingSpotlightProps {
  userId: string;
}

const BUBBLE_WIDTH = 320;
const RETRY_ATTEMPTS = 200;
const RETRY_INTERVAL_MS = 300;

interface BubblePos {
  left: number;
  top: number;
  below: boolean;
}

function computeBubblePos(element: HTMLElement): BubblePos {
  const box = element.getBoundingClientRect();
  const below = box.bottom < window.innerHeight - 140;
  let top = below ? box.bottom + 14 : Math.max(16, box.top - 120);
  if (top + 120 > window.innerHeight) top = window.innerHeight - 136;
  const left = Math.max(16, Math.min(box.left, window.innerWidth - BUBBLE_WIDTH - 16));
  return { left, top, below };
}

/**
 * Destaque de passos do onboarding: ao navegar com "?onboarding=<id>",
 * localiza o elemento alvo (data-tour-target), rola até ele, desenha um
 * anel ao redor e mostra uma bolha com a dica do passo. Enquanto o alvo
 * ainda não existe na página (carregamento assíncrono), mostra um cartão
 * flutuante com a dica.
 */
export function OnboardingSpotlight({ userId }: OnboardingSpotlightProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const stepId = searchParams.get('onboarding');
  const step = ONBOARDING_STEPS.find((item) => item.id === stepId);

  const [found, setFound] = useState<{ stepId: string; element: HTMLElement } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!step || !step.target) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>(`[data-tour-target="${step.target}"]`);
      if (el) {
        setFound({ stepId: step.id, element: el });
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      if (attempts >= RETRY_ATTEMPTS) window.clearInterval(timer);
    }, RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    const handler = () => setTick((tick) => tick + 1);
    window.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);

  useEffect(() => {
    if (found) {
      found.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [found]);

  if (!step || !step.tip) return null;

  const stepIndex = ONBOARDING_STEPS.findIndex((item) => item.id === step.id);
  const nextStep = ONBOARDING_STEPS[stepIndex + 1];
  const isDoneStep = step.id === 'done';

  const matched = found && found.stepId === step.id ? found.element : null;
  const pos = matched ? computeBubblePos(matched) : null;
  const box = matched ? matched.getBoundingClientRect() : null;

  function dismiss(): void {
    setFound(null);
    const params = new URLSearchParams(searchParams);
    params.delete('onboarding');
    setSearchParams(params, { replace: true });
  }

  function handlePrimary(): void {
    if (isDoneStep) completeOnboarding(userId);
    dismiss();
  }

  function handleNext(): void {
    if (!nextStep) {
      handlePrimary();
      return;
    }
    dismiss();
    navigate(nextStep.page ? `${nextStep.page}?onboarding=${nextStep.id}` : '/painel');
  }

  const bubbleContent = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Passo {stepIndex + 1} de {ONBOARDING_STEPS.length}
        </p>
        <button
          aria-label="Fechar dica"
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={dismiss}
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-sm font-medium leading-snug text-card-foreground">{step.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.tip}</p>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {nextStep && nextStep.id !== 'done' && (
          <Button variant="ghost" size="sm" onClick={handleNext}>
            Pular
          </Button>
        )}
        <Button size="sm" onClick={handlePrimary}>
          {isDoneStep ? (
            <>
              <Check className="size-4" />
              Concluir
            </>
          ) : (
            'Entendi'
          )}
        </Button>
        {nextStep && !isDoneStep && (
          <Button variant="outline" size="sm" onClick={handleNext}>
            Próximo
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </>
  );

  if (matched && pos && box) {
    return (
      <>
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 animate-pulse rounded-lg border-2 border-primary shadow-[0_0_0_4px_rgba(99,102,241,0.35)]"
          style={{ left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }}
        />
        <div
          className="fixed z-50 w-[320px] rounded-xl border bg-card p-4 text-card-foreground shadow-2xl"
          style={{ left: pos.left, top: pos.top }}
        >
          {pos.below ? (
            <div
              aria-hidden
              className="absolute left-6 -top-1 h-2 w-2 rotate-45 border-l border-t bg-card"
            />
          ) : (
            <div
              aria-hidden
              className="absolute left-6 -bottom-1 h-2 w-2 rotate-45 border-b border-r bg-card"
            />
          )}
          {bubbleContent}
        </div>
      </>
    );
  }

  return (
    <div className="fixed right-4 top-16 z-50 w-[320px] rounded-xl border bg-card p-4 text-card-foreground shadow-2xl">
      {bubbleContent}
    </div>
  );
}
