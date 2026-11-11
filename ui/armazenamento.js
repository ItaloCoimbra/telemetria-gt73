// localStorage seguro (iOS/Bluefy pode bloquear) para ajustes e histórico de viagens.

const CHAVE_AJUSTES = "gt73.ajustes";
const CHAVE_HISTORICO = "gt73.historico";
export const HISTORICO_MAX = 50;
export const AJUSTES_PADRAO = { sparkline: true, unidadeCarga: "carga", telaAcesa: true, chaveNuvem: "", pontosCalibracao: [] };

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export function lerAjustes() {
  const salvo = ler(CHAVE_AJUSTES, {});
  return { ...AJUSTES_PADRAO, ...(salvo && typeof salvo === "object" ? salvo : {}) };
}

export function salvarAjustes(ajustes) {
  return gravar(CHAVE_AJUSTES, ajustes);
}

export function lerHistorico() {
  const lista = ler(CHAVE_HISTORICO, []);
  return Array.isArray(lista) ? lista : [];
}

// Guarda só os campos que a lista exibe, mais data/hora; mais novo primeiro.
export function adicionarViagem(r, agora = new Date()) {
  const item = {
    data: agora.toISOString(),
    distanciaKm: r.distanciaKm ?? null,
    mediaKmh: r.mediaKmh ?? null,
    maximaKmh: r.maximaKmh ?? null,
    consumoPctKm: r.consumoPctKm ?? null,
    tempoMovS: r.tempoMovS ?? null,
    freadas: r.freadas ?? null,
    bateriaInicio: r.bateriaInicio ?? null,
    bateriaAtual: r.bateriaAtual ?? null,
  };
  const lista = [item, ...lerHistorico()].slice(0, HISTORICO_MAX);
  gravar(CHAVE_HISTORICO, lista);
  return lista;
}

export function apagarHistorico() {
  try {
    localStorage.removeItem(CHAVE_HISTORICO);
  } catch {
    // sem armazenamento: nada a apagar
  }
}
