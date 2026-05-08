const fs = require("fs");
let code = fs.readFileSync("index.js", "utf8");

// Substituir todas as chamadas getMensagem simples por versão com todas as variáveis
// Adicionar função getAllVars
const oldFn = `function getMensagem(channelId, campo, vars = {}) {
  const db = loadDB();
  const template = (db.mensagens[channelId]?.[campo]) || DEFAULT_MSGS[campo] || "";
  return template.replace(/\\{(\\w+)\\}/g, (_, k) => vars[k] !== undefined ? vars[k] : \`{${k}}\`);
}`;

const newFn = `function getMensagem(channelId, campo, vars = {}) {
  const db = loadDB();
  const template = (db.mensagens[channelId]?.[campo]) || DEFAULT_MSGS[campo] || "";
  return template.replace(/\\{(\\w+)\\}/g, (_, k) => vars[k] !== undefined ? vars[k] : "");
}

function getVars(channelId, extra = {}) {
  const e = getEstado(channelId);
  return {
    cor: "",
    n: e.greenSeguidos,
    data: new Date().toLocaleDateString("pt-AO"),
    vitorias: e.stats.vitorias,
    empates: e.stats.empates,
    loss: e.stats.loss,
    rodadas: e.stats.vitorias + e.stats.loss,
    ...extra,
  };
}`;

code = code.replace(oldFn, newFn);

// Substituir chamadas getMensagem na resolveResult e checkPatterns
code = code.replace(
  `getMensagem(channelId, "bateu")`,
  `getMensagem(channelId, "bateu", getVars(channelId, { cor: target }))`
);
code = code.replace(
  `getMensagem(channelId, "naoPegou")`,
  `getMensagem(channelId, "naoPegou", getVars(channelId, { cor: target }))`
);
code = code.replace(
  `getMensagem(channelId, "analisando")`,
  `getMensagem(channelId, "analisando", getVars(channelId))`
);
code = code.replace(
  `getMensagem(channelId, "gale", { cor: target })`,
  `getMensagem(channelId, "gale", getVars(channelId, { cor: target }))`
);
code = code.replace(
  `getMensagem(channelId, "sinal", { cor: sinal })`,
  `getMensagem(channelId, "sinal", getVars(channelId, { cor: sinal }))`
);
code = code.replace(
  `getMensagem(channelId, "greenSeguidos", { n: e.greenSeguidos })`,
  `getMensagem(channelId, "greenSeguidos", getVars(channelId))`
);
code = code.replace(
  `getMensagem(from, "ativado")`,
  `getMensagem(from, "ativado", getVars(from))`
);
code = code.replace(
  `getMensagem(from, "desativado")`,
  `getMensagem(from, "desativado", getVars(from))`
);

fs.writeFileSync("index.js", code);
console.log("OK");
