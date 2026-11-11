// Decodificador do protocolo controladora -> painel da FarDriver GT73 Pro (porta de bikectl/painel.py).
//
// A controladora envia frames de 14 bytes a 9600 baud. O módulo BLE lê a linha a 19200, então cada frame
// chega distorcido como 28 bytes (notificações de 20 + 8). Simulamos essa leitura e a invertemos.
//
// Frame real: 02 0e 01 00 <status> 40 <cargaA> <cargaB> <periodoHi> <periodoLo> 50 00 00 <xor>

// Modelo do UART do módulo: amostras por bit a 19200, fase de amostragem e avanço após cada byte.
const OS = 16;
const OFF = 30;
const STOP = 144;

const TAMANHO_FRAME = 14;
const TAMANHO_RECEBIDO = 28;
const PERIODO_PARADO = 20000;
const K_VELOCIDADE = 5600; // 224 de período = 25 km/h, medido no painel
const BITS_FREIO = 0x28; // status c2 -> ea quando o freio é acionado
const ORDEM = [8, 9, 6, 7, 4, 13, 0, 1, 2, 3, 5, 10, 11, 12];
const MAX_PASSADAS = 4;
const FOLGA_DESISTENCIA = 4;

export const PARADO = Uint8Array.of(0x02, 0x0e, 0x01, 0x00, 0xc2, 0x40, 0x00, 0x00, 0x4e, 0x20, 0x50, 0x00, 0x00, 0xb1);

function linha(frame) {
  const total = OS * 4 + frame.length * 10 * 2 * OS + OS * 40;
  const w = new Uint8Array(total).fill(1);
  let p = OS * 4;
  for (const b of frame) {
    const bits = [0, ...Array.from({ length: 8 }, (_, i) => (b >> i) & 1), 1];
    for (const bit of bits) {
      w.fill(bit, p, p + 2 * OS);
      p += 2 * OS;
    }
  }
  return w;
}

/** Bytes que o UART do módulo (19200) entrega ao receber `frame` enviado a 9600. */
export function simularRecepcao(frame) {
  const w = linha(frame);
  const out = [];
  const limite = w.length - 10 * OS;
  let i = 0;
  while (i < limite) {
    if (w[i] === 0) {
      let byte = 0;
      for (let k = 0; k < 8; k++) byte |= w[i + OFF + k * OS] << k;
      out.push(byte);
      i += STOP;
    } else {
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

const xorDe = (frame, fim) => frame.subarray(0, fim).reduce((a, b) => a ^ b, 0);

export function xorOk(frame) {
  return frame.length >= 2 && xorDe(frame, frame.length - 1) === frame[frame.length - 1];
}

function nota(frame, alvo) {
  const r = simularRecepcao(frame);
  let iguais = 0;
  const n = Math.min(r.length, alvo.length);
  for (let i = 0; i < n; i++) if (r[i] === alvo[i]) iguais++;
  return iguais - 2 * Math.abs(r.length - alvo.length);
}

function melhorValor(f, pos, alvo, melhor) {
  let escolhido = f[pos];
  for (let b = 0; b < 256; b++) {
    f[pos] = b;
    const n = nota(f, alvo);
    if (n > melhor) {
      melhor = n;
      escolhido = b;
      if (melhor === alvo.length) break;
    }
  }
  f[pos] = escolhido;
  return melhor;
}

function buscar(alvo, inicio) {
  const f = Uint8Array.from(inicio);
  let melhor = nota(f, alvo);
  for (let passada = 0; passada < MAX_PASSADAS; passada++) {
    const antes = melhor;
    for (const pos of ORDEM) {
      if (melhor === alvo.length) return { f, melhor };
      melhor = melhorValor(f, pos, alvo, melhor);
    }
    if (melhor === antes || melhor < alvo.length - FOLGA_DESISTENCIA) break;
  }
  return { f, melhor };
}

function alternativas(f, alvo, n) {
  return Array.from(f, (_, pos) => {
    const g = Uint8Array.from(f);
    const alts = [];
    for (let b = 0; b < 256; b++) {
      g[pos] = b;
      if (nota(g, alvo) === n) alts.push(b);
    }
    return alts;
  });
}

function com(f, trocas) {
  const g = Uint8Array.from(f);
  for (const [pos, valor] of trocas) g[pos] = valor;
  return g;
}

const valida = (g, alvo, n) => xorOk(g) && nota(g, alvo) === n;

function* candidatos(opcoes) {
  const amb = opcoes.flatMap((a, i) => (a.length > 1 ? [i] : []));
  for (const i of amb) for (const b of opcoes[i]) yield [[i, b]];
  for (let x = 0; x < amb.length; x++) {
    for (const j of amb.slice(x + 1)) {
      for (const b1 of opcoes[amb[x]]) for (const b2 of opcoes[j]) yield [[amb[x], b1], [j, b2]];
    }
  }
}

function fecharXor(f, alvo, n) {
  const rapido = com(f, [[f.length - 1, xorDe(f, f.length - 1)]]);
  if (valida(rapido, alvo, n)) return rapido;
  for (const trocas of candidatos(alternativas(f, alvo, n))) {
    const g = com(f, trocas);
    if (valida(g, alvo, n)) return g;
  }
  return null;
}

/** Frame real de 14 bytes que gera `recebido` e fecha o XOR, ou null. */
export function inverter(recebido, palpite) {
  if (recebido.length !== TAMANHO_RECEBIDO) return null;
  const partidas = palpite && palpite.length === TAMANHO_FRAME && !iguais(palpite, PARADO) ? [palpite, PARADO] : [PARADO];
  for (const inicio of partidas) {
    const { f, melhor } = buscar(recebido, inicio);
    if (melhor === recebido.length) return xorOk(f) ? f : fecharXor(f, recebido, melhor);
  }
  return null;
}

function iguais(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const velocidade = (periodo) => (periodo <= 0 || periodo >= PERIODO_PARADO ? 0 : K_VELOCIDADE / periodo);

export function interpretar(frame) {
  if (frame.length !== TAMANHO_FRAME) throw new Error(`frame com ${frame.length} bytes`);
  if (frame[0] !== 0x02 || frame[1] !== 0x0e) throw new Error("cabecalho invalido");
  if (!xorOk(frame)) throw new Error("checksum XOR invalido");
  const periodo = (frame[8] << 8) | frame[9];
  return {
    periodo,
    velocidadeKmh: velocidade(periodo),
    cargaA: frame[6],
    cargaB: frame[7],
    status: frame[4],
    freio: (frame[4] & BITS_FREIO) !== 0,
    bateriaPct: frame[10], // bateu com o SOC da controladora (80 % = 0x50)
    bruto: Uint8Array.from(frame),
  };
}

/** Junta as notificações BLE de 20 + 8 bytes num recebido de 28 bytes. */
export class Montador {
  #pendente = null;

  alimentar(dados) {
    const d = Uint8Array.from(dados);
    if (d.length === 20) {
      this.#pendente = d;
      return [];
    }
    if (d.length === 8 && this.#pendente) {
      const junto = new Uint8Array(28);
      junto.set(this.#pendente);
      junto.set(d, 20);
      this.#pendente = null;
      return [junto];
    }
    this.#pendente = null;
    return [];
  }
}
