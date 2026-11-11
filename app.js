import { Montador, interpretar } from "./painel.js";
import { novaViagem, registrar, resumo, paraCsv } from "./viagem.js";

const SERVICO = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CARACTERISTICA = "0000ffec-0000-1000-8000-00805f9b34fb";
const LIMITE_SEM_DADOS_MS = 2000;
const ESPERAS_RECONEXAO_MS = [1000, 2000, 4000, 10000];
const CARGA_ESCALA = 40; // escala estimada da barra: valores vistos até ~25 acelerando forte

const $ = (id) => document.getElementById(id);
const el = {
  painel: $("painel"), status: $("status"), semdados: $("semdados"), aviso: $("aviso"),
  velocidade: $("velocidade"), freio: $("freio"), cargaA: $("cargaA"), cargaB: $("cargaB"),
  barra: $("barra"), conectar: $("conectar"), exportar: $("exportar"), zerar: $("zerar"),
  distancia: $("distancia"), tempo: $("tempo"), media: $("media"), maxima: $("maxima"),
  freadas: $("freadas"), cargaMax: $("cargaMax"), frames: $("frames"), descartados: $("descartados"),
};

const estado = {
  dispositivo: null,
  caracteristica: null,
  montador: new Montador(),
  decodificador: new Worker("./decodificador.js", { type: "module" }),
  ocupado: false,
  pendente: null,
  proximoId: 0,
  viagem: novaViagem(),
  frames: 0,
  descartados: 0,
  ultimoDado: 0,
  tentativa: 0,
  desconexaoManual: false,
  wakeLock: null,
};

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function definirStatus(texto, fase) {
  el.status.textContent = texto;
  el.painel.dataset.estado = fase;
}

function mostrarAviso(texto) {
  el.aviso.textContent = texto;
  el.aviso.hidden = !texto;
}

function formatarTempo(segundos) {
  const s = Math.floor(segundos);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function atualizarLeitura(dados) {
  el.velocidade.textContent = String(Math.round(dados.velocidadeKmh));
  el.freio.classList.toggle("ativo", dados.freio);
  el.cargaA.textContent = String(dados.cargaA);
  el.cargaB.textContent = String(dados.cargaB);
  el.barra.style.width = `${Math.min(100, (dados.cargaA / CARGA_ESCALA) * 100)}%`;
}

function atualizarViagem() {
  const r = resumo(estado.viagem);
  el.distancia.textContent = r.distanciaKm.toFixed(2);
  el.tempo.textContent = formatarTempo(r.tempoMovS);
  el.media.textContent = r.mediaKmh.toFixed(0);
  el.maxima.textContent = r.maximaKmh.toFixed(0);
  el.freadas.textContent = String(r.freadas);
  el.cargaMax.textContent = String(r.cargaMax);
  el.frames.textContent = String(estado.frames);
  el.descartados.textContent = String(estado.descartados);
}

// Decodificação no worker: só um pedido por vez; se chegar dado novo enquanto ele trabalha,
// fica guardado apenas o mais recente (nunca exibir dado atrasado).
function enviarParaDecodificar() {
  if (estado.ocupado || !estado.pendente) return;
  estado.ocupado = true;
  estado.decodificador.postMessage({ id: estado.proximoId++, recebido: estado.pendente });
  estado.pendente = null;
}

function aoDecodificar({ data }) {
  estado.ocupado = false;
  try {
    if (!data.frame) throw new Error("sem solucao");
    const dados = interpretar(data.frame);
    estado.frames++;
    registrar(estado.viagem, dados, performance.now());
    atualizarLeitura(dados);
  } catch {
    estado.descartados++;
  }
  atualizarViagem();
  enviarParaDecodificar();
}

function aoNotificar(evento) {
  const v = evento.target.value;
  const dados = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  estado.ultimoDado = performance.now();
  for (const recebido of estado.montador.alimentar(dados)) estado.pendente = recebido;
  enviarParaDecodificar();
}

function verificarSemDados() {
  const conectado = el.painel.dataset.estado === "conectado";
  const parado = performance.now() - estado.ultimoDado > LIMITE_SEM_DADOS_MS;
  el.semdados.hidden = !(conectado && parado);
}

async function abrirGatt() {
  const servidor = await estado.dispositivo.gatt.connect();
  const servico = await servidor.getPrimaryService(SERVICO);
  const car = await servico.getCharacteristic(CARACTERISTICA);
  estado.caracteristica?.removeEventListener("characteristicvaluechanged", aoNotificar);
  car.removeEventListener("characteristicvaluechanged", aoNotificar);
  car.addEventListener("characteristicvaluechanged", aoNotificar);
  await car.startNotifications(); // só escuta: este app nunca escreve no módulo
  estado.caracteristica = car;
  estado.montador = new Montador();
  estado.ultimoDado = performance.now();
  estado.tentativa = 0;
  definirStatus("Conectado", "conectado");
  el.conectar.textContent = "Desconectar";
}

async function conectar() {
  el.conectar.disabled = true;
  mostrarAviso("");
  try {
    definirStatus("Procurando...", "conectando");
    estado.dispositivo = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "YuanQu" }],
      optionalServices: [SERVICO],
    });
    estado.desconexaoManual = false;
    estado.dispositivo.removeEventListener("gattserverdisconnected", aoDesconectar);
    estado.dispositivo.addEventListener("gattserverdisconnected", aoDesconectar);
    definirStatus("Conectando...", "conectando");
    await abrirGatt();
  } catch (erro) {
    definirStatus("Desconectado", "desconectado");
    if (erro?.name !== "NotFoundError") mostrarAviso(`Falha ao conectar: ${erro?.message ?? erro}`);
  } finally {
    el.conectar.disabled = false;
  }
}

function desconectar() {
  estado.desconexaoManual = true;
  estado.dispositivo?.gatt?.disconnect();
  definirStatus("Desconectado", "desconectado");
  el.conectar.textContent = "Conectar";
  el.semdados.hidden = true;
}

function aoDesconectar() {
  if (estado.desconexaoManual) return;
  reconectar();
}

async function reconectar() {
  while (!estado.desconexaoManual && !estado.dispositivo.gatt.connected) {
    const espera = ESPERAS_RECONEXAO_MS[Math.min(estado.tentativa, ESPERAS_RECONEXAO_MS.length - 1)];
    estado.tentativa++;
    definirStatus(`Reconectando (tentativa ${estado.tentativa})...`, "reconectando");
    await esperar(espera);
    if (estado.desconexaoManual) return;
    try {
      await abrirGatt();
      return;
    } catch {
      // tenta de novo com espera maior
    }
  }
}

function aoClicarConectar() {
  const ativo = estado.dispositivo?.gatt?.connected || el.painel.dataset.estado === "reconectando";
  if (ativo) desconectar();
  else conectar();
}

async function exportarCsv() {
  const nome = `viagem_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  const arquivo = new File([paraCsv(estado.viagem)], nome, { type: "text/csv" });
  try {
    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: nome });
      return;
    }
  } catch (erro) {
    if (erro?.name === "AbortError") return;
  }
  const url = URL.createObjectURL(arquivo);
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function zerarViagem() {
  if (!confirm("Zerar os dados desta viagem?")) return;
  estado.viagem = novaViagem();
  estado.frames = 0;
  estado.descartados = 0;
  atualizarViagem();
}

async function pedirWakeLock() {
  try {
    estado.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    estado.wakeLock = null;
  }
}

async function registrarServiceWorker() {
  try {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.register("./sw.js");
  } catch {
    // PWA é opcional
  }
}

function iniciar() {
  if (!navigator.bluetooth) {
    mostrarAviso("No iPhone abra esta página no app Bluefy; no Android use o Chrome.");
    el.conectar.disabled = true;
  }
  estado.decodificador.onmessage = aoDecodificar;
  el.conectar.addEventListener("click", aoClicarConectar);
  el.exportar.addEventListener("click", exportarCsv);
  el.zerar.addEventListener("click", zerarViagem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pedirWakeLock();
  });
  setInterval(verificarSemDados, 500);
  atualizarViagem();
  pedirWakeLock();
  registrarServiceWorker();
}

iniciar();
