// Calibração da velocidade: pontos "velocidade real" x "velocidade do app" e fator médio.

export const PONTOS_MAX = 5;
const APP_MIN_KMH = 3; // abaixo disso a leitura é instável demais para calibrar
const RAZAO_MIN = 0.5;
const RAZAO_MAX = 2;

/** Fator = média das razões real / app. Sem pontos válidos, 1. */
export function fatorDosPontos(pontos) {
  const validos = (pontos ?? []).filter((p) => p.app > 0 && p.real > 0);
  if (!validos.length) return 1;
  return validos.reduce((soma, p) => soma + p.real / p.app, 0) / validos.length;
}

/** Novo ponto (mantém os mais recentes). Lança erro com mensagem para o usuário se for inválido. */
export function adicionarPonto(pontos, real, app) {
  if (!(app >= APP_MIN_KMH)) throw new Error("App muito devagar para calibrar: ande a uma velocidade constante.");
  if (!(real > 0)) throw new Error("Informe a velocidade real (do painel ou do GPS).");
  const razao = real / app;
  if (razao < RAZAO_MIN || razao > RAZAO_MAX) {
    throw new Error("Valor real diferente demais do app: confira o número digitado.");
  }
  return [...(pontos ?? []), { real, app, em: new Date().toISOString() }].slice(-PONTOS_MAX);
}

export function aplicarFator(leitura, fator) {
  return { ...leitura, velocidadeBrutaKmh: leitura.velocidadeKmh, velocidadeKmh: leitura.velocidadeKmh * fator };
}

/** Média de `v` nas amostras dos últimos `janelaMs` (série de { t, v }). */
export function mediaRecente(serie, agora, janelaMs) {
  const recentes = serie.filter((x) => x.t >= agora - janelaMs);
  if (!recentes.length) return null;
  return recentes.reduce((s, x) => s + x.v, 0) / recentes.length;
}
