// Gráficos desenhados à mão em <canvas>. Séries: [{ t (ms), v (km/h), c (carga) }].

const COR_VEL = "#22d3ee";
const COR_CARGA = "#fbbf24";
const COR_GRADE = "#2e2e38";
const COR_TEXTO = "#c9c9d1";

function preparar(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null; // aba oculta
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function janela(serie, agora, duracaoMs) {
  const ini = agora - duracaoMs;
  return serie.filter((p) => p.t >= ini);
}

function tracar(ctx, pontos, x, y, cor, largura) {
  if (pontos.length < 2) return;
  ctx.beginPath();
  pontos.forEach((p, i) => (i ? ctx.lineTo(x(p), y(p)) : ctx.moveTo(x(p), y(p))));
  ctx.strokeStyle = cor;
  ctx.lineWidth = largura;
  ctx.lineJoin = "round";
  ctx.stroke();
}

export function desenharSparkline(canvas, serie, agora, duracaoMs = 60000) {
  const base = preparar(canvas);
  if (!base) return;
  const { ctx, w, h } = base;
  const pts = janela(serie, agora, duracaoMs);
  const topo = Math.max(30, ...pts.map((p) => p.v));
  const x = (p) => ((p.t - (agora - duracaoMs)) / duracaoMs) * w;
  const y = (p) => h - 3 - (p.v / topo) * (h - 6);
  if (pts.length >= 2) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p), y(p)) : ctx.moveTo(x(p), y(p))));
    ctx.lineTo(x(pts[pts.length - 1]), h);
    ctx.lineTo(x(pts[0]), h);
    ctx.closePath();
    ctx.fillStyle = "rgba(34,211,238,.18)";
    ctx.fill();
  }
  tracar(ctx, pts, x, y, COR_VEL, 2.5);
  ctx.fillStyle = COR_TEXTO;
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("60 s", 4, 12);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(topo)} km/h`, w - 4, 12);
}

export function desenharGrafico(canvas, serie, agora, duracaoMs = 300000) {
  const base = preparar(canvas);
  if (!base) return;
  const { ctx, w, h } = base;
  const m = { e: 34, d: 30, t: 8, b: 20 };
  const pw = w - m.e - m.d;
  const ph = h - m.t - m.b;
  const pts = janela(serie, agora, duracaoMs);
  const topoV = Math.max(40, Math.ceil(Math.max(0, ...pts.map((p) => p.v)) / 10) * 10);
  const topoC = Math.max(10, Math.ceil(Math.max(0, ...pts.map((p) => p.c)) / 5) * 5);
  const x = (p) => m.e + ((p.t - (agora - duracaoMs)) / duracaoMs) * pw;
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = m.t + (ph * i) / 4;
    ctx.strokeStyle = COR_GRADE;
    ctx.beginPath();
    ctx.moveTo(m.e, gy);
    ctx.lineTo(m.e + pw, gy);
    ctx.stroke();
    ctx.fillStyle = COR_VEL;
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(topoV * (1 - i / 4))), m.e - 4, gy + 4);
    ctx.fillStyle = COR_CARGA;
    ctx.textAlign = "left";
    ctx.fillText(String(Math.round(topoC * (1 - i / 4))), m.e + pw + 4, gy + 4);
  }
  ctx.fillStyle = COR_TEXTO;
  ctx.textAlign = "center";
  for (let min = 0; min <= 5; min++) {
    const gx = m.e + (pw * (5 - min)) / 5;
    ctx.fillText(min === 0 ? "agora" : `-${min}m`, Math.min(w - 16, Math.max(14, gx)), h - 4);
  }
  tracar(ctx, pts, x, (p) => m.t + ph - (p.c / topoC) * ph, COR_CARGA, 1.8);
  tracar(ctx, pts, x, (p) => m.t + ph - (p.v / topoV) * ph, COR_VEL, 2.4);
}
