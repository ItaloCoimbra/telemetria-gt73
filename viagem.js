// Acumulador da viagem: distância, tempos, médias, freadas e exportação CSV.
// Puro: recebe leituras já interpretadas e o instante (ms) em que chegaram.

const LACUNA_MAX_MS = 2000; // acima disso a amostra anterior é velha demais para integrar
const AMOSTRAS_MAX = 200000;
const MS_POR_HORA = 3.6e6;
const DIST_MIN_CONSUMO_KM = 0.5;
const METAS_ARRANCADA = [20, 40];
const TOLERANCIA_KMH = 2; // oscilação de leitura que não cancela a arrancada

export function novaViagem() {
  return {
    amostras: [], distKm: 0, movMs: 0, totalMs: 0, semDadosMs: 0, maxima: 0, freadas: 0, cargaMax: 0,
    ultimoT: null, ultimaV: 0, freioAntes: false,
    bateriaInicio: null, bateriaAtual: null,
    arrancada: null, // { t0, atingidas } desde a última amostra parada
    melhores: { 20: null, 40: null },
  };
}

function integrar(v, t) {
  if (v.ultimoT === null) return;
  const dt = t - v.ultimoT;
  if (dt > LACUNA_MAX_MS) v.semDadosMs += dt; // app em segundo plano ou Bluetooth fora: não conta distância
  if (dt <= 0 || dt > LACUNA_MAX_MS) return;
  v.totalMs += dt;
  if (v.ultimaV > 0) {
    v.movMs += dt;
    v.distKm += (v.ultimaV * dt) / MS_POR_HORA;
  }
}

function registrarBateria(v, pct) {
  if (!Number.isFinite(pct)) return;
  if (v.bateriaInicio === null) v.bateriaInicio = pct;
  v.bateriaAtual = pct;
}

function confirmarPendentes(v, a, kmh) {
  for (const [meta, tMeta] of a.pendentes) {
    a.pendentes.delete(meta);
    if (kmh < meta) continue; // pico isolado: a amostra seguinte não confirmou
    a.atingidas.add(meta);
    const dt = (tMeta - a.t0) / 1000;
    if (v.melhores[meta] === null || dt < v.melhores[meta]) v.melhores[meta] = dt;
  }
}

function acompanharArrancada(v, kmh, t) {
  const lacuna = v.ultimoT !== null && t - v.ultimoT > LACUNA_MAX_MS;
  if (kmh <= 0) {
    v.arrancada = { t0: t, atingidas: new Set(), pendentes: new Map() };
    return;
  }
  const a = v.arrancada;
  if (!a || lacuna || kmh < v.ultimaV - TOLERANCIA_KMH) {
    v.arrancada = null; // desacelerou ou perdeu dados: arrancada inválida
    return;
  }
  confirmarPendentes(v, a, kmh);
  for (const meta of METAS_ARRANCADA) {
    if (kmh >= meta && !a.atingidas.has(meta) && !a.pendentes.has(meta)) a.pendentes.set(meta, t);
  }
}

export function registrar(v, leitura, t) {
  acompanharArrancada(v, leitura.velocidadeKmh, t);
  integrar(v, t);
  registrarBateria(v, leitura.bateriaPct);
  if (leitura.freio && !v.freioAntes) v.freadas++;
  v.freioAntes = leitura.freio;
  v.maxima = Math.max(v.maxima, leitura.velocidadeKmh);
  v.cargaMax = Math.max(v.cargaMax, leitura.cargaA);
  v.ultimoT = t;
  v.ultimaV = leitura.velocidadeKmh;
  if (v.amostras.length < AMOSTRAS_MAX) {
    const { bruto: _bruto, ...amostra } = leitura; // frame bruto não vai para o histórico (memória)
    v.amostras.push({ t, ...amostra });
  }
}

function consumo(v) {
  if (v.bateriaInicio === null || v.distKm < DIST_MIN_CONSUMO_KM) return null;
  const queda = v.bateriaInicio - v.bateriaAtual;
  return queda > 0 ? queda / v.distKm : null;
}

export function resumo(v) {
  const consumoPctKm = consumo(v);
  return {
    distanciaKm: v.distKm,
    tempoMovS: v.movMs / 1000,
    tempoTotalS: v.totalMs / 1000,
    mediaKmh: v.movMs > 0 ? v.distKm / (v.movMs / MS_POR_HORA) : 0,
    maximaKmh: v.maxima,
    freadas: v.freadas,
    cargaMax: v.cargaMax,
    amostras: v.amostras.length,
    bateriaInicio: v.bateriaInicio,
    bateriaAtual: v.bateriaAtual,
    consumoPctKm,
    autonomiaKm: consumoPctKm === null ? null : v.bateriaAtual / consumoPctKm,
    melhor0a20S: v.melhores[20],
    melhor0a40S: v.melhores[40],
    tempoSemDadosS: v.semDadosMs / 1000,
  };
}

export function paraCsv(v) {
  const linhas = ["t_s,velocidade_kmh,cargaA,cargaB,freio,status,periodo,bateria_pct"];
  for (const a of v.amostras) {
    const status = a.status.toString(16).padStart(2, "0");
    linhas.push(
      `${(a.t / 1000).toFixed(3)},${a.velocidadeKmh.toFixed(2)},${a.cargaA},${a.cargaB},${a.freio ? 1 : 0},${status},${a.periodo},${Number.isFinite(a.bateriaPct) ? a.bateriaPct : ""}`,
    );
  }
  return `${linhas.join("\n")}\n`;
}
