// Envio automático da viagem para a API (Railway). Só avança o ponteiro depois que o servidor confirmar,
// então sem internet nada se perde: o próximo envio leva tudo o que faltou.

export const API_PADRAO = "https://api-viagens-production.up.railway.app";
const LOTE_MAX = 600; // ~10 min de amostras a 1 por segundo por envio

/** Uma amostra por segundo, em tempo absoluto (ms), a partir do índice `desde`. */
export function reduzirAmostras(amostras, desde, origemMs, ultimoSegundo = null, max = LOTE_MAX) {
  const lote = [];
  let i = desde;
  let ultimo = ultimoSegundo;
  for (; i < amostras.length && lote.length < max; i++) {
    const a = amostras[i];
    const segundo = Math.floor(a.t / 1000);
    if (segundo === ultimo) continue;
    ultimo = segundo;
    lote.push({
      t_ms: origemMs + Math.round(a.t),
      velocidade_kmh: a.velocidadeKmh,
      carga_a: a.cargaA,
      carga_b: a.cargaB,
      freio: Boolean(a.freio),
      bateria_pct: Number.isFinite(a.bateriaPct) ? a.bateriaPct : null,
    });
  }
  return { lote, proximo: i, ultimoSegundo: ultimo };
}

export function corpoResumo(resumo, iniciadaEmMs, versao) {
  return { iniciadaEm: new Date(iniciadaEmMs).toISOString(), versao, resumo };
}

export function novoEstadoNuvem(id, origemMs) {
  return { id, origemMs, enviadoAte: 0, ultimoSegundo: null };
}

export function prepararEnvio(estado, amostras, resumo, origemMs, versao) {
  const inicio = amostras.length ? origemMs + amostras[0].t : Date.now();
  const r = reduzirAmostras(amostras, estado.enviadoAte, origemMs, estado.ultimoSegundo);
  return { id: estado.id, corpo: corpoResumo(resumo, inicio, versao), ...r };
}

export function confirmarEnvio(estado, envio) {
  estado.enviadoAte = envio.proximo;
  estado.ultimoSegundo = envio.ultimoSegundo;
}

/** Manda o resumo (PUT) e o lote de amostras (POST). Lança erro se o servidor recusar. */
export async function enviar(endpoint, chave, envio) {
  const base = endpoint.replace(/\/+$/, "");
  const cab = { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" };
  const r1 = await fetch(`${base}/viagens/${envio.id}`, { method: "PUT", headers: cab, body: JSON.stringify(envio.corpo) });
  if (!r1.ok) throw new Error(`resumo recusado (${r1.status})`);
  if (!envio.lote.length) return;
  const r2 = await fetch(`${base}/viagens/${envio.id}/amostras`, {
    method: "POST", headers: cab, body: JSON.stringify({ amostras: envio.lote }),
  });
  if (!r2.ok) throw new Error(`amostras recusadas (${r2.status})`);
}

/** Confere se a API aceita a chave (leitura simples, não grava nada). */
export async function testarChave(endpoint, chave) {
  const r = await fetch(`${endpoint.replace(/\/+$/, "")}/viagens`, { headers: { Authorization: `Bearer ${chave}` } });
  return r.ok;
}

const br = (n, casas) => Number(n).toFixed(casas).replace(".", ",");
const temNumero = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

/** Linhas de texto da análise geral devolvida por GET /analise. */
export function linhasAnalise(api) {
  const t = api?.totais ?? {};
  const n = Number(t.viagens ?? 0);
  const linhas = [`${n} ${n === 1 ? "viagem" : "viagens"} · ${br(t.km ?? 0, 1)} km · ${br(t.horas_andando ?? 0, 1)} h andando`];
  if (temNumero(t.maxima_kmh)) linhas.push(`Máxima registrada: ${br(t.maxima_kmh, 0)} km/h`);
  if (!temNumero(t.consumo_pct_km)) {
    linhas.push("Consumo e autonomia aparecem depois de viagens com pelo menos 0,5 km e queda de bateria.");
    return linhas;
  }
  linhas.push(`Consumo médio: ${br(t.consumo_pct_km, 2)} %/km`);
  if (temNumero(api.autonomia_100_a_0_km)) {
    linhas.push(`Autonomia estimada (100 % → 0): ${br(Math.floor(api.autonomia_100_a_0_km), 0)} km`);
  }
  for (const f of api.por_velocidade_media ?? []) {
    if (temNumero(f.consumo_pct_km)) {
      linhas.push(`Média ${f.faixa_media_kmh} km/h: ${br(f.consumo_pct_km, 2)} %/km em ${br(f.km, 1)} km`);
    }
  }
  return linhas;
}

/** Busca a análise geral na API. */
export async function buscarAnalise(endpoint, chave) {
  const r = await fetch(`${endpoint.replace(/\/+$/, "")}/analise`, { headers: { Authorization: `Bearer ${chave}` } });
  if (!r.ok) throw new Error(`análise indisponível (${r.status})`);
  return r.json();
}
