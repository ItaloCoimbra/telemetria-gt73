import { Montador, interpretar } from "./painel.js";
import { novaViagem, registrar, resumo, paraCsv } from "./viagem.js";
import { numero, porcento, tempo, bateriaInicioAtual, nivelBateria, VAZIO } from "./ui/formato.js";
import { lerAjustes, salvarAjustes, lerHistorico, adicionarViagem, apagarHistorico } from "./ui/armazenamento.js";
import { desenharSparkline, desenharGrafico } from "./ui/graficos.js";
import { iniciarAbas, renderizarHistorico } from "./ui/telas.js";
import { API_PADRAO, novoEstadoNuvem, prepararEnvio, confirmarEnvio, enviar } from "./nuvem.js";
import { fatorDosPontos, adicionarPonto, aplicarFator, mediaRecente } from "./calibracao.js";

const VERSAO_APP = "2.2";
const SERVICO = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CARACTERISTICA = "0000ffec-0000-1000-8000-00805f9b34fb";
const LIMITE_SEM_DADOS_MS = 2000;
const ESPERAS_RECONEXAO_MS = [1000, 2000, 4000, 10000];
const CARGA_ESCALA = 40; // escala estimada da barra: valores vistos até ~25 acelerando forte
const SERIE_MS = 300000; // 5 min de histórico para os gráficos
const RESUMO_INTERVALO_MS = 1000;
const NUVEM_INTERVALO_MS = 60000;
const JANELA_CALIBRACAO_MS = 2000; // média da velocidade do app nos últimos 2 s
const REGEN_MIN_KMH = 3; // freio com a roda girando: o EABS está devolvendo energia

const $ = (id) => document.getElementById(id);
const ids = [
  "app", "status", "semdados", "aviso", "velocidade", "freio", "cargaA", "cargaB", "barra", "cargaRotulo",
  "bateria", "bateriaPct", "bateriaBarra", "autonomia", "spark", "conectar", "exportar", "salvar", "zerar",
  "vDistancia", "vTempoMov", "vTempoTotal", "vMedia", "vMaxima", "vFreadas", "vCargaMax", "vCargaUn",
  "vBateria", "vConsumo", "vAutonomia", "vMelhor20", "vMelhor40", "vAmostras", "legCarga", "grafico",
  "frames", "descartados", "histLista", "histVazio", "histApagar", "ajSpark", "ajUnidade", "ajWake", "versao",
  "ajChave", "ajEnviar", "ajNuvemStatus",
  "calApp", "calReal", "calRegistrar", "calFator", "calPontos", "calZerar", "calAviso",
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
  nuvem: novoEstadoNuvem(crypto.randomUUID(), performance.timeOrigin),
  enviando: false,
  brutas: [], // velocidade sem correção, para calibrar
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
  const regen = dados.freio && dados.velocidadeKmh >= REGEN_MIN_KMH;
  el.freio.classList.toggle("ativo", dados.freio);
  el.freio.classList.toggle("regen", regen);
  el.freio.textContent = regen ? "FREIO · REGEN" : "FREIO";
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
    const t = performance.now();
    const lido = interpretar(data.frame);
    guardarBruta(lido.velocidadeKmh, t);
    const dados = aplicarFator(lido, fatorDosPontos(estado.ajustes.pontosCalibracao));
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
  if (estado.aba === "ajustes") mostrarCalibracao();
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

// ---------- Calibração da velocidade ----------
function guardarBruta(v, t) {
  estado.brutas.push({ t, v });
  while (estado.brutas.length && estado.brutas[0].t < t - 5000) estado.brutas.shift();
}

function velocidadeAppAgora() {
  return mediaRecente(estado.brutas, performance.now(), JANELA_CALIBRACAO_MS);
}

function mostrarCalibracao() {
  const app = velocidadeAppAgora();
  el.calApp.textContent = app === null ? VAZIO : numero(app, 1);
  const pontos = estado.ajustes.pontosCalibracao ?? [];
  el.calFator.textContent = `${fatorDosPontos(pontos).toFixed(3)} · ${pontos.length} ponto(s)`;
  el.calPontos.textContent = pontos.map((p) => `real ${numero(p.real, 1)} / app ${numero(p.app, 1)}`).join(" · ") || "Nenhum ponto ainda.";
}

function registrarPontoCalibracao() {
  try {
    const app = velocidadeAppAgora();
    const real = Number(String(el.calReal.value).replace(",", "."));
    const pontos = adicionarPonto(estado.ajustes.pontosCalibracao, real, app ?? 0);
    mudarAjuste({ pontosCalibracao: pontos });
    el.calReal.value = "";
    el.calAviso.textContent = "Ponto registrado.";
  } catch (erro) {
    el.calAviso.textContent = erro.message;
  }
  mostrarCalibracao();
}

function zerarCalibracao() {
  if (!confirm("Apagar os pontos de calibração e voltar ao fator 1?")) return;
  mudarAjuste({ pontosCalibracao: [] });
  el.calAviso.textContent = "";
  mostrarCalibracao();
}

// ---------- Nuvem (Railway) ----------
function statusNuvem(texto) {
  el.ajNuvemStatus.textContent = texto;
}

async function sincronizar() {
  const chave = estado.ajustes.chaveNuvem;
  if (!chave) return statusNuvem("Nuvem desligada: cole a chave acima.");
  if (estado.enviando || !estado.viagem.amostras.length) return;
  estado.enviando = true;
  const envio = prepararEnvio(estado.nuvem, estado.viagem.amostras, resumo(estado.viagem), performance.timeOrigin, VERSAO_APP);
  try {
    await enviar(API_PADRAO, chave, envio);
    confirmarEnvio(estado.nuvem, envio);
    statusNuvem(`Sincronizado às ${new Date().toLocaleTimeString("pt-BR")} (${envio.lote.length} amostras novas)`);
  } catch (erro) {
    statusNuvem(`Sem envio agora (${erro?.message ?? erro}). Tento de novo em 1 min.`);
  } finally {
    estado.enviando = false;
  }
}

function lerChaveDaUrl() {
  const m = location.hash.match(/chave=([0-9a-f]{16,128})/i);
  if (!m) return;
  estado.ajustes = { ...estado.ajustes, chaveNuvem: m[1] };
  salvarAjustes(estado.ajustes);
  history.replaceState(null, "", location.pathname + location.search);
}

async function zerarViagem() {
  if (!confirm("Zerar os dados desta viagem? O resumo será salvo no histórico.")) return;
  const r = resumo(estado.viagem);
  if (r.amostras) adicionarViagem(r);
  await sincronizar();
  estado.nuvem = novoEstadoNuvem(crypto.randomUUID(), performance.timeOrigin);
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
  el.ajChave.value = estado.ajustes.chaveNuvem;
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
  if (nome === "ajustes") mostrarCalibracao();
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
  el.ajChave.addEventListener("change", () => {
    mudarAjuste({ chaveNuvem: el.ajChave.value.trim() });
    sincronizar();
  });
  el.ajEnviar.addEventListener("click", sincronizar);
  el.calRegistrar.addEventListener("click", registrarPontoCalibracao);
  el.calZerar.addEventListener("click", zerarCalibracao);
  window.addEventListener("resize", pedirDesenho);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pedirWakeLock();
    else sincronizar(); // indo para o fundo: tenta mandar o que falta
  });
}

function iniciar() {
  if (!navigator.bluetooth) {
    mostrarAviso("No iPhone abra esta página no app Bluefy; no Android use o Chrome.");
    el.conectar.disabled = true;
  }
  estado.decodificador.onmessage = aoDecodificar;
  el.versao.textContent = VERSAO_APP;
  lerChaveDaUrl();
  iniciarAbas(aoTrocarAba);
  ligarEventos();
  aplicarAjustes();
  atualizarBateria(undefined);
  el.autonomia.textContent = VAZIO;
  setInterval(verificarSemDados, 500);
  setInterval(sincronizar, NUVEM_INTERVALO_MS);
  sincronizar();
  atualizarViagem();
  mostrarHistorico();
  pedirWakeLock();
  registrarServiceWorker();
}

iniciar();
