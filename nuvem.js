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
