export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  page?: string;
  target?: string;
  cta?: string;
  tip?: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Bem-vindo(a) ao LanceZap',
    description:
      'Vamos configurar seu primeiro leilão em 5 passos. O painel tem 4 áreas: WhatsApp, Grupos, Leilões e Segurança. Siga o guia e o bot cuida do resto.',
  },
  {
    id: 'whatsapp',
    title: '1. Conecte o WhatsApp',
    description:
      'O bot precisa de um número do WhatsApp para ler os lances e anunciar os itens. Escaneie o QR Code com o número que fará os leilões.',
    page: '/painel/whatsapp',
    target: 'connect-whatsapp',
    cta: 'Ir para WhatsApp',
    tip: 'Clique em "Conectar WhatsApp" e escaneie o QR Code com o número leiloeiro.',
  },
  {
    id: 'groups',
    title: '2. Vincule grupos',
    description:
      'Cadastre o grupo do WhatsApp onde o leilão vai acontecer. Cole o ID do grupo em "Novo grupo" ou use "Vincular por código" (passo 3) para o bot criar automaticamente.',
    page: '/painel/grupos',
    target: 'new-group',
    cta: 'Ir para Grupos',
    tip: 'Clique em "Novo grupo", preencha o nome e o ID do grupo (ex.: 120363000000000000@g.us) e salve. Para achar o ID, envie uma mensagem no grupo e copie a parte final "1203...@g.us".',
  },
  {
    id: 'link-code',
    title: '3. Vincule por código',
    description:
      'Sem precisar copiar o ID: clique em "Vincular por código", copie o comando gerado e envie no grupo do WhatsApp. O bot cria o grupo automaticamente no painel.',
    page: '/painel/grupos',
    target: 'link-code',
    cta: 'Vincular por código',
    tip: 'Clique em "Vincular por código", copie "!vincular XXXXX" e envie no grupo. Quem envia precisa ser administrador do grupo — o bot cadastra o grupo sozinho.',
  },
  {
    id: 'events',
    title: '4. Crie um leilão',
    description:
      'Em Leilões, crie o evento do leilão. Você pode definir a data/hora de início e término automáticos (opcional) e escolher o grupo vinculado.',
    page: '/painel/leiloes',
    target: 'new-event',
    cta: 'Ir para Leilões',
    tip: 'Clique em "Criar novo leilão", informe o nome, escolha o grupo e, se quiser, defina início/fim automáticos.',
  },
  {
    id: 'items',
    title: '5. Cadastre os itens',
    description:
      'Adicione os itens ao leilão com o valor inicial. A duração é opcional: em minutos (o bot encerra sozinho e avisa 3 min antes) ou deixe vazio para encerrar manualmente.',
    page: '/painel/leiloes',
    target: 'new-item',
    cta: 'Cadastrar itens',
    tip: 'No leilão criado, preencha o nome e o valor inicial e salve. Repita para cada item da lista.',
  },
  {
    id: 'start',
    title: '6. Inicie a lista',
    description:
      'Com os itens cadastrados, clique em "Iniciar lista". O bot anuncia tudo no grupo do WhatsApp e passa a aceitar lances.',
    page: '/painel/leiloes',
    target: 'start-list',
    cta: 'Iniciar a lista',
    tip: 'Selecione o grupo e clique em "Iniciar lista". Depois é só aguardar os lances chegarem no grupo.',
  },
  {
    id: 'done',
    title: 'Pronto!',
    description:
      'O bot gerencia o leilão: avisa "3 minutos", encerra itens no tempo combinado, envia o status no grupo e você finaliza os itens pelo painel. Dúvidas? Acesse "Guia do sistema" a qualquer momento.',
    tip: 'Você concluiu o guia. Seus leilões estão prontos: é só cadastrar o grupo e iniciar a lista no grupo do WhatsApp.',
  },
];

const STORAGE_PREFIX = 'lancezap.onboarding';

function userKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

function stepKey(userId: string): string {
  return `${STORAGE_PREFIX}.${userId}.step`;
}

export function hasCompletedOnboarding(userId: string): boolean {
  try {
    return localStorage.getItem(userKey(userId)) === 'done';
  } catch {
    return false;
  }
}

export function completeOnboarding(userId: string): void {
  try {
    localStorage.setItem(userKey(userId), 'done');
    localStorage.removeItem(stepKey(userId));
  } catch {
    // ignore
  }
}

export function getOnboardingStep(userId: string): number {
  try {
    const raw = localStorage.getItem(stepKey(userId));
    if (raw === null) return 0;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), ONBOARDING_STEPS.length - 1) : 0;
  } catch {
    return 0;
  }
}

export function saveOnboardingStep(userId: string, index: number): void {
  try {
    localStorage.setItem(stepKey(userId), String(index));
  } catch {
    // ignore
  }
}
