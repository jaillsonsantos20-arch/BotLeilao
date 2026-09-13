import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ListChecks,
  MessageCircle,
  MessageSquareReply,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { api } from '@/lib/api';
import type { ApiEnvelope, Plan } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// URL de suporte via WhatsApp. Configure com VITE_SUPPORT_WHATSAPP_URL
// (ex.: https://wa.me/5586999696897?text=Ol%C3%A1...).
const SUPPORT_WHATSAPP_URL =
  (import.meta.env as Record<string, string | undefined>).VITE_SUPPORT_WHATSAPP_URL ??
  'https://wa.me/5586999696897?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20com%20o%20LanceZap.';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type Billing = 'monthly' | 'yearly';

const STEPS = [
  {
    title: 'Cadastre seus produtos',
    description:
      'Subimos os itens e os valores no painel. Podem ser leilões avulsos ou listas de eventos.',
  },
  {
    title: 'Envie a lista para o grupo',
    description:
      'O bot anuncia os produtos no seu grupo e explica como dar lances de forma simples.',
  },
  {
    title: 'Deixe o bot conduzir',
    description:
      'Lances, prazos e o anúncio do vencedor acontecem automaticamente. Você só acompanha o resultado.',
  },
];

const FEATURES = [
  {
    icon: MessageCircle,
    title: 'Leilões no WhatsApp',
    description:
      'Lance pelo número do item — o bot gerencia prazos e vencedor em tempo real, no chat.',
  },
  {
    icon: MessageSquareReply,
    title: 'Confirmação por reação',
    description:
      'A cada lance, o bot confirma na hora com uma reação no seu aviso — sem mensagens extras poluindo o grupo, mesmo com muitos lances.',
  },
  {
    icon: ListChecks,
    title: 'Listas e eventos',
    description:
      'Leiloe vários itens simultaneamente em listas organizadas, com status em andamento.',
  },
  {
    icon: BarChart3,
    title: 'Relatórios completos',
    description:
      'Acompanhe vendas, vencedores e valores finais em relatórios claros para tomar decisões.',
  },
  {
    icon: Users,
    title: 'Múltiplos usuários',
    description:
      'Compartilhe o painel com sua equipe, cada um com controle sobre grupos e leilões.',
  },
  {
    icon: Zap,
    title: 'Automação de ponta a ponta',
    description:
      'Do anúncio ao fechamento, sem trabalho manual. O tempo do leilão se ajusta sozinho a cada lance.',
  },
];

const TESTIMONIALS = [
  {
    name: 'Rafael M.',
    role: 'Leiloeiro autônomo',
    text: 'Eu trocava centenas de mensagens por leilão. Agora o bot faz tudo e o grupo fica limpo — só lance, reação e o anúncio do vencedor.',
  },
  {
    name: 'Carla S.',
    role: 'Loja de usados',
    text: 'A confirmação por reação salvou meu grupo de virar um caos. O status e o fechamento mostram o vencedor na hora certa. Incrível!',
  },
];

const FAQ = [
  {
    q: 'Preciso instalar algo?',    a: 'Não. Você cadastra seus produtos no painel, escaneia o QR Code para conectar o WhatsApp do seu grupo e o bot já trabalhou. Sem instalar nada no seu celular.',
  },
  {
    q: 'Meu número do WhatsApp corre algum risco?',
    a: 'O bot usa a sua conta apenas para interagir nos grupos que você conectou. Você controla tudo e pode desconectar quando quiser.',
  },
  {
    q: 'Como funciona o teste grátis?',
    a: 'Você experimenta completa por 24 horas, sem cadastrar cartão. Só decide de pagar se o resultado valeu a pena.',
  },
  {
    q: 'Funciona para qualquer grupo?',
    a: 'Sim. Basta que você seja administrador do grupo para vincular e começar a leiloar. Em minutos o leilão está no ar.',
  },
  {
    q: 'Posso mudar de plano depois?',
    a: 'Sim. Você faz upgrade ou downgrade a qualquer momento no painel e a diferença é cobrada/reembolsada proporcionalmente.',
  },
];

function planLabels(plan: Plan): Array<{ included: boolean; text: string }> {  const groups =
    plan.maxGroups >= 100 ? 'Grupos ilimitados' : `Até ${plan.maxGroups} grupos`;
  const users =
    plan.maxUsers >= 20 ? 'Usuários ilimitados' : `Até ${plan.maxUsers} usuários`;
  const auctions =
    plan.maxAuctions === null || plan.maxAuctions === undefined
      ? 'Leilões ilimitados'
      : plan.maxAuctions >= 100
        ? 'Leilões ilimitados'
        : `Até ${plan.maxAuctions} leilões simultâneos`;

  const has = (feature: string): boolean => plan.features.includes(feature);
  const listasText = has('listas_ilimitadas')
    ? 'Listas e eventos ilimitados'
    : has('listas')
      ? 'Listas com até 5 itens'
      : 'Listas e eventos';

  return [
    { included: true, text: groups },
    { included: true, text: users },
    { included: true, text: auctions },
    { included: has('whatsapp'), text: 'Bot de WhatsApp' },
    { included: has('relatorios'), text: 'Relatórios de vendas' },
    { included: has('listas'), text: listasText },
  ];
}

export function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billing, setBilling] = useState<Billing>('monthly');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [stickyDismissed, setStickyDismissed] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowStickyCta(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      navigate('/painel', { replace: true });
      return;
    }
    api
      .get<ApiEnvelope<Plan[]>>('/plans')
      .then((response) => setPlans(response.data.data))
      .catch(() => setPlans([]));
  }, [isLoading, isAuthenticated, navigate]);

  // Destaca o plano mediano por preço como "Mais popular".
  const featuredIndex = useMemo(() => {
    if (plans.length === 0) return -1;
    const byPrice = [...plans].sort((a, b) => a.price - b.price);
    const median = byPrice[Math.floor(byPrice.length / 2)];
    return plans.findIndex((p) => p.id === median.id);
  }, [plans]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Logo size={32} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/login">Entrar</Link>
            </Button>
            <Button asChild>
              <Link to="/registro">
                Começar grátis
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_-10%,rgba(99,102,241,0.18),transparent)]"
        />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 lg:grid-cols-2 lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              24 horas grátis — sem cartão
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
              Venda por leilão dentro do{' '}
              <span className="bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">
                WhatsApp
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Cadastre os produtos, envie a lista para o grupo e deixe o bot
              conduzir lances, prazos e o anúncio do vencedor — com confirmação
              na hora e sem poluir o chat.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link to="/registro">
                  Testar grátis por 24h
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <a
                href="#planos"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                Ver planos
                <ChevronDown className="size-4" />
              </a>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              {['Sem instalar nada', 'Bot ativo em segundos', 'Configure o vencedor'].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <Check className="size-4 text-emerald-500" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          {/* Mock de chat */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-2xl shadow-indigo-500/10">
              <div className="flex items-center gap-3 border-b pb-3">
                <Logo size={40} />
                <div>
                  <p className="text-sm font-semibold">Bot Leilão — Grupo da Loja</p>
                  <p className="text-xs text-emerald-600">online</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm">
                  📦 Lista: Sandálias e Tênis — lance com *Nº valor*
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm">
                  🧢 Item 01 — Sandália Rancha
                </div>
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-indigo-500 px-3 py-2 text-sm text-white">
                  01 120
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    ✅ reação recebida
                  </span>
                  <span>Seu lance registrado</span>
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-emerald-500/90 px-3 py-2 text-sm text-white">
                  🏁 Item encerrado — Vencedor: você por R$ 120,00
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center sm:grid-cols-4">
          {[
            ['24h', 'de teste grátis'],
            ['100%', 'sem instalação'],
            ['✅', 'confirmação limpa'],
            ['—', 'sem necessidade de cartão'],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Como funciona
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            Do cadastro ao vencedor em 3 passos
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="relative rounded-2xl border bg-card p-6 first:shadow-md first:shadow-indigo-500/5"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">
                {i + 1}
              </div>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* RECURSOS */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Recursos
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            Tudo o que você precisa para vender mais
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
            Foco no essencial: lances sem ruído, prazos automáticos e relatórios
            para você decidir.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PREÇOS */}
      <section id="planos" className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(99,102,241,0.12),transparent)]"
        />
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="mb-10 text-center">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              Planos simples
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              Escolha o plano ideal para você
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
              Teste grátis por 24 horas em qualquer plano. Sem cartão, sem fidelidade.
            </p>

            {/* Toggle anual / mensal */}
            <div className="mx-auto mt-6 inline-flex items-center gap-1 rounded-full border bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  billing === 'monthly'
                    ? 'bg-card text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setBilling('yearly')}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  billing === 'yearly'
                    ? 'bg-card text-foreground shadow'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Anual
                <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-600">
                  1 mês grátis
                </span>
              </button>
            </div>
          </div>

          <div className="mx-auto grid gap-6 md:max-w-3xl md:grid-cols-2">
            {plans.map((plan, index) => {
              const featured = index === featuredIndex;
              const unitPrice = billing === 'yearly' ? (plan.price * 11) / 12 : plan.price;
              const labels = planLabels(plan);
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'relative flex flex-col rounded-2xl border bg-card p-6 transition-all',
                    featured
                      ? 'border-primary/60 shadow-2xl shadow-primary/15 lg:-my-3 lg:scale-[1.02]'
                      : 'border-border hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5',
                  )}
                >
                  {featured && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1 bg-gradient-to-r from-indigo-500 to-violet-600">
                      <Sparkles className="size-3" />
                      Mais popular
                    </Badge>
                  )}
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                  <div className="mt-4">
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-bold tracking-tight">
                        {formatPrice(billing === 'yearly' ? Math.round(plan.price * 11) : plan.price)}
                      </span>
                      <span className="pb-1 text-sm text-muted-foreground">
                        /{billing === 'yearly' ? 'ano' : 'mês'}
                      </span>
                    </div>
                    {billing === 'yearly' ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="line-through">{formatPrice(plan.price)}</span>
                        {' '}por mês · equivale a{' '}
                        <span className="font-medium text-emerald-600">{formatPrice(unitPrice)}/mês</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-emerald-600">avulso mensal</p>
                    )}
                  </div>
                  {billing === 'yearly' && (
                    <p className="mt-1 text-xs text-emerald-600">cobrado anualmente com 1 mês grátis</p>
                  )}

                  <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                    {labels.map((row) => (
                      <li
                        key={row.text}
                        className={cn(
                          'flex items-start gap-2',
                          !row.included && 'text-muted-foreground/70',
                        )}
                      >
                        {row.included ? (
                          <Check
                            className={cn(
                              'mt-0.5 size-4 shrink-0',
                              featured ? 'text-primary' : 'text-emerald-500',
                            )}
                          />
                        ) : (
                          <X className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                        )}
                        {row.text}
                      </li>
                    ))}
                  </ul>

                  <Button className="mt-6 w-full" variant={featured ? 'default' : 'outline'} asChild>
                    <Link to={`/registro?plano=${plan.id}`}>Começar grátis</Link>
                  </Button>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Todos os planos incluem 24 horas de teste grátis. Cancele quando quiser.
          </p>
        </div>
      </section>

      {/* DEPOIMENTOS */}
      <section id="depoimentos" className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Depoimentos
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            Quem usa, recomenda
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="rounded-2xl border bg-card p-6 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5"
            >
              <div className="flex gap-1 text-amber-400">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-4 text-muted-foreground">{t.text}</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{t.name}</span>
                <span className="text-muted-foreground"> · {t.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-10 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Dúvidas
          </span>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">
            Perguntas frequentes
          </h2>
        </div>
        <div className="space-y-3">
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <div
                key={item.q}
                className="rounded-xl border bg-card transition-all"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span className="font-medium">{item.q}</span>
                  <ChevronDown
                    className={cn(
                      'size-5 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>
                {open && (
                  <p className="px-5 pb-4 text-sm text-muted-foreground">{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-700 p-10 text-center text-white shadow-2xl shadow-indigo-500/30 sm:p-14">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(255,255,255,0.2),transparent)]"
          />
          <ShieldCheck className="mx-auto size-10 opacity-90" />
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Comece a vender por leilão hoje mesmo
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/90">
            Teste grátis por 24 horas, sem cartão. Em minutos seu bot já está
            recebendo lances no grupo.
          </p>
          <div className="mt-8">
            <Button
              size="lg"
              asChild
              className="bg-white text-indigo-700 shadow-lg hover:bg-indigo-50"
            >
              <Link to="/registro">
                Criar conta grátis
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={20} />
            <span>LanceZap — leilões inteligentes no WhatsApp</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#planos" className="hover:text-foreground hover:underline">
              Planos
            </a>
            <a href="#depoimentos" className="hover:text-foreground hover:underline">
              Depoimentos
            </a>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground hover:underline"
            >
              Suporte
            </a>
            <Link to="/login" className="font-medium text-primary hover:underline">
              Acessar painel
            </Link>
          </div>
        </div>
      </footer>

      {/* CTA sticky + suporte flutuante */}
      {showStickyCta && !stickyDismissed && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border bg-background/95 py-2 pl-4 pr-2 shadow-2xl shadow-primary/20 backdrop-blur-xl">
          <span className="hidden text-sm font-medium sm:inline">
            24h grátis — sem cartão
          </span>
          <span className="text-sm font-medium sm:hidden">24h grátis</span>
          <Button size="sm" asChild className="rounded-full">
            <Link to="/registro">
              Testar grátis
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
          <button
            type="button"
            aria-label="Fechar oferta"
            onClick={() => setStickyDismissed(true)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <a
        href={SUPPORT_WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Falar com o suporte no WhatsApp"
        title="Falar com o suporte no WhatsApp"
        className={cn(
          'fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl shadow-emerald-500/40 transition-all hover:scale-105 hover:bg-[#1EBE5B]',
          showStickyCta && !stickyDismissed ? 'bottom-20' : 'bottom-4',
        )}
      >
        <MessageCircle className="size-6" />
        <span className="absolute -top-1 -right-1 flex size-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-4 rounded-full border-2 border-white bg-emerald-500" />
        </span>
      </a>
    </div>
  );
}