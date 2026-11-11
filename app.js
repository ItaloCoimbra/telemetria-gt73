import { Montador, interpretar } from "./painel.js";
import { novaViagem, registrar, resumo, paraCsv } from "./viagem.js";
import { numero, porcento, tempo, bateriaInicioAtual, nivelBateria, VAZIO } from "./ui/formato.js";
import { lerAjustes, salvarAjustes, lerHistorico, adicionarViagem, apagarHistorico } from "./ui/armazenamento.js";
import { desenharSparkline, desenharGrafico } from "./ui/graficos.js";
import { iniciarAbas, renderizarHistorico } from "./ui/telas.js";

const VERSAO_APP = "2.0";
const SERVICO = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CARACTERISTICA = "0000ffec-0000-1000-8000-00805f9b34fb";
const LIMITE_SEM_DADOS_MS = 2000;
const ESPERAS_RECONEXAO_MS = [1000, 2000, 4000, 10000];
const CARGA_ESCALA = 40; // escala estimada da barra: valores vistos até ~25 acelerando forte
const SERIE_MS = 300000; // 5 min de histórico para os gráficos
const RESUMO_INTERVALO_MS = 1000;

const $ = (id) => document.getElementById(id);
const ids = [
  "app", "status", "semdados", "aviso", "velocidade", "freio", "cargaA", "cargaB", "barra", "cargaRotulo",
  "bateria", "bateriaPct", "bateriaBarra", "autonomia", "spark", "conectar", "exportar", "salvar", "zerar",
  "vDistancia", "vTempoMov", "vTempoTotal", "vMedia", "vMaxima", "vFreadas", "vCargaMax", "vCargaUn",
  "vBateria", "vConsumo", "vAutonomia", "vMelhor20", "vMelhor40", "vAmostras", "legCarga", "grafico",
  "frames", "descartados", "histLista", "histVazio", "histApagar", "ajSpark", "ajUnidade", "ajWake", "versao",
];
const el = Object.fromEntries(ids.map((id) => [id, $(id)]));

const estado = {
  dispositivo: null,
  caracteristica: null,
  montador: new Montador(),
  decodificador: new Worker("./decodificador.js", { type: "module" }),
  ocupado: false,
  pendente: null,
  proximoId: 0,
  viagem: novaViagem(),
  serie: [],
  frames: 0,
  descartados: 0,
  ultimoDado: 0,
  ultimoResumo: 0,
  tentativa: 0,
  desconexaoManual: false,
  wakeLock: null,
  aba: "painel",
  ajustes: lerAjustes(),
  desenhoPendente: false,
};

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function definirStatus(texto, fase) {
  el.status.textContent = texto;
  el.app.dataset.estado = fase;
}

function mostrarAviso(texto) {
  el.aviso.textContent = texto;
  el.aviso.hidden = !texto;
}

// ---------- Painel ----------
function atualizarBateria(pct) {
  const valido = typeof pct === "number" && Number.isFinite(pct);
  el.bateriaPct.textContent = porcento(pct);
  el.bateria.dataset.nivel = nivelBateria(pct);
  el.bateriaBarra.style.width = valido ? `${Math.max(0, Math.min(100, pct))}%` : "0%";
}

function atualizarLeitura(dados) {
  el.velocidade.textContent = String(Math.round(dados.velocidadeKmh));
  el.freio.classList.toggle("ativo", dados.freio);
  el.cargaA.textContent = String(dados.cargaA);
  el.cargaB.textContent = String(dados.cargaB);
  el.barra.style.width = `${Math.min(100, (dados.cargaA / CARGA_ESCALA) * 100)}%`;
  atualizarBateria(dados.bateriaPct);
}

function guardarSerie(dados, t) {
  estado.serie.push({ t, v: dados.velocidadeKmh, c: dados.cargaA });
  const limite = t - SERIE_MS;
  let corte = 0;
  while (corte < estado.serie.length && estado.serie[corte].t < limite) corte++;
  if (corte > 0) estado.serie.splice(0, corte);
}

// ---------- Viagem ----------
function atualizarViagem() {
  const r = resumo(estado.viagem);
  el.autonomia.textContent = numero(r.autonomiaKm, 0);
  el.vDistancia.textContent = numero(r.distanciaKm, 2);
  el.vTempoMov.textContent = tempo(r.tempoMovS);
  el.vTempoTotal.textContent = tempo(r.tempoTotalS);
  el.vMedia.textContent = numero(r.mediaKmh, 0);
  el.vMaxima.textContent = numero(r.maximaKmh, 0);
  el.vFreadas.textContent = numero(r.freadas, 0);
  el.vCargaMax.textContent = numero(r.cargaMax, 0);
  el.vBateria.textContent = bateriaInicioAtual(r);
  el.vConsumo.textContent = numero(r.consumoPctKm, 2);
  el.vAutonomia.textContent = numero(r.autonomiaKm, 0);
  el.vMelhor20.textContent = numero(r.melhor0a20S, 1);
  el.vMelhor40.textContent = numero(r.melhor0a40S, 1);
  el.vAmostras.textContent = numero(r.amostras, 0);
  el.frames.textContent = String(estado.frames);
  el.descartados.textContent = String(estado.descartados);
  estado.ultimoResumo = performance.now();
}

function atualizarViagemLimitado() {
  if (performance.now() - estado.ultimoResumo >= RESUMO_INTERVALO_MS) atualizarViagem();
}

// ---------- Gráficos ----------
function desenhar() {
  estado.desenhoPendente = false;
  const agora = performance.now();
  if (estado.aba === "painel" && estado.ajustes.sparkline) desenharSparkline(el.spark, estado.serie, agora);
  if (estado.aba === "viagem") desenharGrafico(el.grafico, estado.serie, agora);
}

function pedirDesenho() {
  if (estado.desenhoPendente) return;
  estado.desenhoPendente = true;
  requestAnimationFrame(desenhar);
}

// ---------- Decodificação (Worker) ----------
// Só um pedido por vez; se chegar dado novo enquanto ele trabalha,
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
    const t = performance.now();
    estado.frames++;
    registrar(estado.viagem, dados, t);
    guardarSerie(dados, t);
    atualizarLeitura(dados);
    atualizarViagemLimitado();
    pedirDesenho();
  } catch {
    estado.descartados++;
  }
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
  const conectado = el.app.dataset.estado === "conectado";
  const parado = performance.now() - estado.ultimoDado > LIMITE_SEM_DADOS_MS;
  el.semdados.hidden = !(conectado && parado);
  atualizarViagemLimitado();
  pedirDesenho(); // faz o gráfico "andar" mesmo sem dados novos
}

// ---------- Bluetooth (somente escuta: nunca escrevemos no módulo) ----------
async function abrirGatt() {
  const servidor = await estado.dispositivo.gatt.connect();
  const servico = await servidor.getPrimaryService(SERVICO);
  const car = await servico.getCharacteristic(CARACTERISTICA);
  estado.caracteristica?.removeEventListener("characteristicvaluechanged", aoNotificar);
  car.removeEventListener("characteristicvaluechanged", aoNotificar);
  car.addEventListener("characteristicvaluechanged", aoNotificar);
  await car.startNotifications();
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
  const ativo = estado.dispositivo?.gatt?.connected || el.app.dataset.estado === "reconectando";
  if (ativo) desconectar();
  else conectar();
}

// ---------- Ações da viagem ----------
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

function mostrarHistorico() {
  renderizarHistorico(lerHistorico(), el.histLista, el.histVazio, el.histApagar);
}

function salvarViagem() {
  const r = resumo(estado.viagem);
  if (!r.amostras) {
    mostrarAviso("Nada para salvar: ainda não há dados desta viagem.");
    return false;
  }
  adicionarViagem(r);
  mostrarAviso("");
  mostrarHistorico();
  return true;
}

function zerarViagem() {
  if (!confirm("Zerar os dados desta viagem? O resumo será salvo no histórico.")) return;
  const r = resumo(estado.viagem);
  if (r.amostras) adicionarViagem(r);
  estado.viagem = novaViagem();
  estado.serie = [];
  estado.frames = 0;
  estado.descartados = 0;
  mostrarHistorico();
  atualizarViagem();
  pedirDesenho();
}

function aoApagarHistorico() {
  if (!confirm("Apagar todo o histórico de viagens?")) return;
  apagarHistorico();
  mostrarHistorico();
}

// ---------- Ajustes ----------
async function pedirWakeLock() {
  if (!estado.ajustes.telaAcesa) return;
  try {
    estado.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    estado.wakeLock = null;
  }
}

async function liberarWakeLock() {
  try {
    await estado.wakeLock?.release();
  } catch {
    // já liberado
  }
  estado.wakeLock = null;
}

function pintarChave(botao, ligado) {
  botao.setAttribute("aria-checked", String(ligado));
  botao.textContent = ligado ? "Ligado" : "Desligado";
}

function aplicarAjustes() {
  const { sparkline, unidadeCarga, telaAcesa } = estado.ajustes;
  el.spark.hidden = !sparkline;
  el.cargaRotulo.textContent = unidadeCarga;
  el.legCarga.textContent = unidadeCarga;
  el.vCargaUn.textContent = unidadeCarga;
  el.ajUnidade.value = unidadeCarga;
  pintarChave(el.ajSpark, sparkline);
  pintarChave(el.ajWake, telaAcesa);
  pedirDesenho();
}

function mudarAjuste(parte) {
  estado.ajustes = { ...estado.ajustes, ...parte };
  salvarAjustes(estado.ajustes);
  aplicarAjustes();
}

function alternarWake() {
  const ligar = !estado.ajustes.telaAcesa;
  mudarAjuste({ telaAcesa: ligar });
  if (ligar) pedirWakeLock();
  else liberarWakeLock();
}

function aoMudarUnidade() {
  mudarAjuste({ unidadeCarga: el.ajUnidade.value.trim() || "carga" });
}

function aoTrocarAba(nome) {
  estado.aba = nome;
  if (nome === "viagem") atualizarViagem();
  if (nome === "historico") mostrarHistorico();
  pedirDesenho();
}

async function registrarServiceWorker() {
  try {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.register("./sw.js");
  } catch {
    // PWA é opcional
  }
}

function ligarEventos() {
  el.conectar.addEventListener("click", aoClicarConectar);
  el.exportar.addEventListener("click", exportarCsv);
  el.salvar.addEventListener("click", salvarViagem);
  el.zerar.addEventListener("click", zerarViagem);
  el.histApagar.addEventListener("click", aoApagarHistorico);
  el.ajSpark.addEventListener("click", () => mudarAjuste({ sparkline: !estado.ajustes.sparkline }));
  el.ajWake.addEventListener("click", alternarWake);
  el.ajUnidade.addEventListener("change", aoMudarUnidade);
  window.addEventListener("resize", pedirDesenho);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pedirWakeLock();
  });
}

function iniciar() {
  if (!navigator.bluetooth) {
    mostrarAviso("No iPhone abra esta página no app Bluefy; no Android use o Chrome.");
    el.conectar.disabled = true;
  }
  estado.decodificador.onmessage = aoDecodificar;
  el.versao.textContent = VERSAO_APP;
  iniciarAbas(aoTrocarAba);
  ligarEventos();
  aplicarAjustes();
  atualizarBateria(undefined);
  el.autonomia.textContent = VAZIO;
  setInterval(verificarSemDados, 500);
  atualizarViagem();
  mostrarHistorico();
  pedirWakeLock();
  registrarServiceWorker();
}

iniciar();
