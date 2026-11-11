// Acumulador da viagem: distância, tempos, médias, freadas e exportação CSV.
// Puro: recebe leituras já interpretadas e o instante (ms) em que chegaram.

const LACUNA_MAX_MS = 2000; // acima disso a amostra anterior é velha demais para integrar
const AMOSTRAS_MAX = 200000;
const MS_POR_HORA = 3.6e6;

export function novaViagem() {
  return {
    amostras: [], distKm: 0, movMs: 0, totalMs: 0, maxima: 0, freadas: 0, cargaMax: 0,
    ultimoT: null, ultimaV: 0, freioAntes: false,
  };
}

function integrar(v, t) {
  if (v.ultimoT === null) return;
  const dt = t - v.ultimoT;
  if (dt <= 0 || dt > LACUNA_MAX_MS) return;
  v.totalMs += dt;
  if (v.ultimaV > 0) {
    v.movMs += dt;
    v.distKm += (v.ultimaV * dt) / MS_POR_HORA;
  }
}

export function registrar(v, leitura, t) {
  integrar(v, t);
  if (leitura.freio && !v.freioAntes) v.freadas++;
  v.freioAntes = leitura.freio;
  v.maxima = Math.max(v.maxima, leitura.velocidadeKmh);
  v.cargaMax = Math.max(v.cargaMax, leitura.cargaA);
  v.ultimoT = t;
  v.ultimaV = leitura.velocidadeKmh;
  if (v.amostras.length < AMOSTRAS_MAX) v.amostras.push({ t, ...leitura });
}

export function resumo(v) {
  return {
    distanciaKm: v.distKm,
    tempoMovS: v.movMs / 1000,
    tempoTotalS: v.totalMs / 1000,
    mediaKmh: v.movMs > 0 ? v.distKm / (v.movMs / MS_POR_HORA) : 0,
    maximaKmh: v.maxima,
    freadas: v.freadas,
    cargaMax: v.cargaMax,
    amostras: v.amostras.length,
  };
}

export function paraCsv(v) {
  const linhas = ["t_s,velocidade_kmh,cargaA,cargaB,freio,status,periodo"];
  for (const a of v.amostras) {
    const status = a.status.toString(16).padStart(2, "0");
    linhas.push(
      `${(a.t / 1000).toFixed(3)},${a.velocidadeKmh.toFixed(2)},${a.cargaA},${a.cargaB},${a.freio ? 1 : 0},${status},${a.periodo}`,
    );
  }
  return `${linhas.join("\n")}\n`;
}
