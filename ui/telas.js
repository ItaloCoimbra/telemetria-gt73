// Navegação por abas e renderização da lista do histórico.
import { dataHora, numero, tempo } from "./formato.js";

export function iniciarAbas(aoTrocar) {
  const botoes = [...document.querySelectorAll(".nav__item")];
  const trocar = (nome) => {
    for (const b of botoes) b.setAttribute("aria-selected", String(b.dataset.aba === nome));
    for (const s of document.querySelectorAll(".aba")) s.hidden = s.id !== `aba-${nome}`;
    aoTrocar(nome);
  };
  for (const b of botoes) b.addEventListener("click", () => trocar(b.dataset.aba));
  return trocar;
}

function itemHistorico(v) {
  const li = document.createElement("li");
  li.className = "viagem";
  const cab = document.createElement("div");
  cab.className = "viagem__data";
  cab.textContent = dataHora(v.data);
  const linha = document.createElement("div");
  linha.className = "viagem__dados";
  const campos = [
    [numero(v.distanciaKm, 2), "km"],
    [numero(v.mediaKmh, 0), "km/h média"],
    [numero(v.maximaKmh, 0), "km/h máx"],
    [numero(v.consumoPctKm, 1), "%/km"],
  ];
  for (const [valor, un] of campos) {
    const c = document.createElement("span");
    const forte = document.createElement("strong");
    forte.textContent = valor;
    c.append(forte, ` ${un}`);
    linha.append(c);
  }
  const extra = document.createElement("div");
  extra.className = "viagem__extra";
  extra.textContent = `${tempo(v.tempoMovS)} andando`;
  li.append(cab, linha, extra);
  return li;
}

export function renderizarHistorico(lista, ul, vazio, botaoApagar) {
  ul.replaceChildren(...lista.map(itemHistorico));
  vazio.hidden = lista.length > 0;
  botaoApagar.hidden = lista.length === 0;
}
