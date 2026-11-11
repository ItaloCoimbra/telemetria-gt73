// Formatação de valores para a tela. Qualquer valor ausente vira "--".

export const VAZIO = "--";

export function numero(valor, casas = 0) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor.toFixed(casas) : VAZIO;
}

export function porcento(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? `${Math.round(valor)}%` : VAZIO;
}

export function tempo(segundos) {
  if (typeof segundos !== "number" || !Number.isFinite(segundos)) return VAZIO;
  const s = Math.floor(segundos);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function bateriaInicioAtual(r) {
  const ini = typeof r.bateriaInicio === "number" ? Math.round(r.bateriaInicio) : null;
  const atu = typeof r.bateriaAtual === "number" ? Math.round(r.bateriaAtual) : null;
  if (ini === null && atu === null) return VAZIO;
  return `${ini ?? VAZIO} → ${atu ?? VAZIO}`;
}

export function dataHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return VAZIO;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// verde > 50, amarelo 20..50, vermelho < 20
export function nivelBateria(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "nenhum";
  if (pct > 50) return "alto";
  if (pct >= 20) return "medio";
  return "baixo";
}
