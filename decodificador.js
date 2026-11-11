// Web Worker: inverte os frames recebidos fora da thread da tela.
// Mensagem de entrada: { id, recebido: Uint8Array(28) }. Saída: { id, frame: Uint8Array(14) | null }.
import { inverter } from "./painel.js";

const CACHE_MAX = 5000;
const cache = new Map(); // hex do recebido -> frame ou null (ruído também fica guardado)
let ultimoFrame;

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function decodificar(recebido) {
  const chave = hex(recebido);
  if (cache.has(chave)) return cache.get(chave);
  const frame = inverter(recebido, ultimoFrame);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(chave, frame);
  return frame;
}

self.onmessage = ({ data }) => {
  const frame = decodificar(data.recebido);
  if (frame) ultimoFrame = frame;
  self.postMessage({ id: data.id, frame });
};
