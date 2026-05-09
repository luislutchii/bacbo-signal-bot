const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino     = require("pino");
const qrcode   = require("qrcode-terminal");
const { Boom } = require("@hapi/boom");
const axios    = require("axios");
const path     = require("path");
const fs       = require("fs");

const OWNER  = "161899094274260";
const PREFIX = ".";
const API_URL = "https://api.signals-house.com/validate/results?tableId=1";
const DB_PATH = path.join(__dirname, "data/db.json");

let globalSock = null;
const ctrlCanal = {};

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify({ controllers: [], mensagens: {} }));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch { return { controllers: [], mensagens: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const DEFAULT_MSGS = {
  sinal:          "🎲 *Bac Bo Brasil*\n\n━━━━━━━━━━━━━━━━\n*Jogar na cor:* {cor}\nProteger o empate",
  gale:           "🔄 *Fazer 1º Gale!*\n\n*Jogar na cor:* {cor}\nProteger o empate",
  bateu:          "🤑✅ *BATEU!* ✅🤑",
  naoPegou:       "⭕ *Não pegamos!*",
  analisando:     "🔍 Analisando padrões...",
  ativado:        "✅ *Sinais Bac Bo ativados!*\n\n🎲 Analisando padrões em tempo real...\n⚙️ Estratégia: Sinal + 1 Gale",
  desativado:     "⛔ *Sinais Bac Bo desativados!*",
  greenSeguidos:  "🔥 *{n} GREENS SEGUIDOS!* 🔥\n\nSequência incrível! Continua!",
  placar:         "🏆 *PLACAR DO DIA*\n📅 {data}\n━━━━━━━━━━━━━━━━\n✅ *Vitórias:* {vitorias}\n🤝 *Empates:* {empates}\n❌ *Loss:* {loss}\n━━━━━━━━━━━━━━━━\n📊 *Rodadas:* {rodadas}",
  anuncio:        "📢 *ANÚNCIO*\n\nTexto do anúncio aqui.",
};

const CAMPOS_DESC = {
  sinal:         "Sinal de entrada (use {cor})",
  gale:          "Mensagem de gale (use {cor})",
  bateu:         "Confirmação de vitória (use {cor}, {vitorias}...)",
  naoPegou:      "Mensagem de loss (use {cor}, {loss}...)",
  analisando:    "Mensagem de análise",
  ativado:       "Mensagem ao ativar",
  desativado:    "Mensagem ao desativar",
  greenSeguidos: "Greens seguidos (use {n})",
  placar:        "Placar do dia (use {data}, {vitorias}, {empates}, {loss}, {rodadas})",
  anuncio:       "Anúncio após loss (use qualquer variável)",
};

function getMensagem(channelId, campo, vars = {}) {
  const db = loadDB();
  const template = (db.mensagens[channelId]?.[campo]) || DEFAULT_MSGS[campo] || "";
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? String(vars[k]) : "");
}

function getVars(channelId, extra) {
  const e = getEstado(channelId);
  return Object.assign({
    cor: "",
    n: e.greenSeguidos,
    data: new Date().toLocaleDateString("pt-AO"),
    vitorias: e.stats.vitorias,
    empates: e.stats.empates,
    loss: e.stats.loss,
    rodadas: e.stats.vitorias + e.stats.loss,
  }, extra || {});
}

function formatPlacar(channelId, stats) {
  const hoje = new Date().toLocaleDateString("pt-AO");
  return getMensagem(channelId, "placar", {
    data: hoje,
    vitorias: stats.vitorias,
    empates: stats.empates,
    loss: stats.loss,
    rodadas: stats.vitorias + stats.loss,
  });
}

const estado = {};

const PADROES = {
  "🔵,🔴":     "🔵",
  "🔴,🔵":     "🔴",
  "🔵,🔵,🔵": "🔴",
  "🔴,🔴,🔴": "🔵",
  "🔴,🔴,🔵": "🔵",
  "🔵,🔵,🔴": "🔴",
};

const RESULT_MAP = { Player: "🔵", Banker: "🔴", Tie: "🟡" };

function getEstado(channelId) {
  if (!estado[channelId]) {
    estado[channelId] = {
      ativo: false,
      history: [],
      processedIds: new Set(),
      waitingResult: false,
      lastSignalColor: null,
      martingaleCount: 0,
      greenSeguidos: 0,
      stats: { vitorias: 0, empates: 0, loss: 0 },
      interval: null,
      currentDate: new Date().toDateString(),
      analiseMsgId: null,
      galeMsgId: null,
      anuncioAtivo: false,
    };
  }
  return estado[channelId];
}

function checkDateReset(e) {
  const today = new Date().toDateString();
  if (e.currentDate !== today) {
    e.currentDate = today;
    e.stats = { vitorias: 0, empates: 0, loss: 0 };
    e.greenSeguidos = 0;
  }
}

function findPattern(history) {
  for (const [seq, sinal] of Object.entries(PADROES)) {
    const arr = seq.split(",");
    const n = arr.length;
    if (history.length >= n && history.slice(-n).join(",") === arr.join(","))
      return sinal;
  }
  return null;
}

function normalizeId(jid) {
  if (!jid) return "";
  return jid.replace(/:.*@/, "@").replace(/@.*/, "").trim();
}

function isAuthorized(senderNum) {
  if (senderNum === OWNER) return true;
  const db = loadDB();
  return db.controllers.includes(senderNum);
}

function isOwner(senderNum) {
  return senderNum === OWNER;
}

async function deletarMsg(sock, channelId, msgId) {
  if (!msgId) return;
  try {
    await sock.sendMessage(channelId, {
      delete: { remoteJid: channelId, fromMe: true, id: msgId }
    });
  } catch (_) {}
}

async function fetchLatestGame() {
  try {
    const res = await axios.get(API_URL, { timeout: 5000 });
    const latest = res.data?.data?.[0];
    if (!latest) return null;
    return { id: latest.id, result: latest.result };
  } catch (_) { return null; }
}

async function resolveResult(sock, channelId, emoji) {
  const e = getEstado(channelId);
  const target = e.lastSignalColor;

  await deletarMsg(sock, channelId, e.analiseMsgId);
  e.analiseMsgId = null;

  if (emoji === "🟡" || emoji === target) {
    await deletarMsg(sock, channelId, e.galeMsgId);
    e.galeMsgId = null;
    e.stats.vitorias++;
    if (emoji === "🟡") e.stats.empates++;
    e.waitingResult = false;
    e.martingaleCount = 0;
    e.greenSeguidos++;

    await sock.sendMessage(channelId, {
      text: getMensagem(channelId, "bateu", getVars(channelId, { cor: target }))
    });
    await sock.sendMessage(channelId, { text: formatPlacar(channelId, e.stats) });

    if (e.greenSeguidos >= 5) {
      await sock.sendMessage(channelId, {
        text: getMensagem(channelId, "greenSeguidos", getVars(channelId, { n: e.greenSeguidos }))
      });
    }
    return;
  }

  if (e.martingaleCount === 0) {
    e.martingaleCount = 1;
    const sent = await sock.sendMessage(channelId, {
      text: getMensagem(channelId, "gale", getVars(channelId, { cor: target }))
    });
    e.galeMsgId = sent?.key?.id || null;
    return;
  }

  await deletarMsg(sock, channelId, e.galeMsgId);
  e.galeMsgId = null;
  e.stats.loss++;
  e.waitingResult = false;
  e.martingaleCount = 0;
  e.greenSeguidos = 0;

  await sock.sendMessage(channelId, {
    text: getMensagem(channelId, "naoPegou", getVars(channelId, { cor: target }))
  });
  await sock.sendMessage(channelId, { text: formatPlacar(channelId, e.stats) });
  if (e.anuncioAtivo) {
    await sock.sendMessage(channelId, {
      text: getMensagem(channelId, "anuncio", getVars(channelId, { cor: target }))
    });
  }
}

async function checkPatterns(sock, channelId) {
  const e = getEstado(channelId);
  if (e.waitingResult || e.history.length < 2) return;

  const sinal = findPattern(e.history);
  if (!sinal) {
    await deletarMsg(sock, channelId, e.analiseMsgId);
    const sent = await sock.sendMessage(channelId, {
      text: getMensagem(channelId, "analisando", getVars(channelId))
    });
    e.analiseMsgId = sent?.key?.id || null;
    return;
  }

  await deletarMsg(sock, channelId, e.analiseMsgId);
  e.analiseMsgId = null;
  e.waitingResult = true;
  e.lastSignalColor = sinal;
  e.martingaleCount = 0;
  e.galeMsgId = null;

  await sock.sendMessage(channelId, {
    text: getMensagem(channelId, "sinal", getVars(channelId, { cor: sinal }))
  });
}

async function tick(sock, channelId) {
  const e = getEstado(channelId);
  if (!e.ativo) return;
  checkDateReset(e);

  const game = await fetchLatestGame();
  if (!game?.id || e.processedIds.has(game.id)) return;

  e.processedIds.add(game.id);
  if (e.processedIds.size > 100)
    e.processedIds = new Set([...e.processedIds].slice(-100));

  const raw = game.result || "";
  let emoji = RESULT_MAP[raw];
  if (!emoji) {
    const r = raw.toLowerCase();
    if (r.includes("player")) emoji = "🔵";
    else if (r.includes("banker")) emoji = "🔴";
    else if (r.includes("tie")) emoji = "🟡";
    else return;
  }

  e.history.push(emoji);
  if (e.history.length > 200) e.history.shift();

  if (e.waitingResult) await resolveResult(sock, channelId, emoji);
  else await checkPatterns(sock, channelId);
}

function ativarCanal(sock, channelId) {
  const e = getEstado(channelId);
  e.ativo = true;
  e.history = [];
  e.waitingResult = false;
  e.martingaleCount = 0;
  e.greenSeguidos = 0;
  e.analiseMsgId = null;
  e.galeMsgId = null;
  if (e.interval) clearInterval(e.interval);
  e.interval = setInterval(() => tick(sock, channelId), 2000);
}

async function desativarCanal(sock, channelId) {
  const e = getEstado(channelId);
  e.ativo = false;
  if (e.interval) { clearInterval(e.interval); e.interval = null; }
  await deletarMsg(sock, channelId, e.analiseMsgId);
  await deletarMsg(sock, channelId, e.galeMsgId);
  e.analiseMsgId = null;
  e.galeMsgId = null;
}

function menuPrincipal() {
  return (
    "🤖 *BAC BO BOT — MENU*\n\n" +
    "━━━━━━━━━━━━━━━━\n" +
    "🎲 *Sinais*\n" +
    "› .bacbo on — ativar neste grupo\n" +
    "› .bacbo off — desativar neste grupo\n" +
    "› .bacbo placar — ver placar\n" +
    "› .bacbo reset — resetar placar\n" +
    "› .bacbo status — ver status\n\n" +
    "📢 *Anúncio*\n" +
    "› .anuncio on/off — ativar/desativar\n" +
    "› .set anuncio <texto> — personalizar\n\n" +
    "🎨 *Personalização* _(por grupo)_\n" +
    "› .set <campo> <texto>\n" +
    "› .ver — ver mensagens deste grupo\n" +
    "› .resetmsg — restaurar mensagens padrão\n\n" +
    "👥 *Controladores* _(só dono)_\n" +
    "› .addctrl <lid>\n" +
    "› .rmctrl <lid>\n" +
    "› .ctrllist — listar controladores\n\n" +
    "🆔 *Outros*\n" +
    "› .lid — ver o teu ID\n\n" +
    "━━━━━━━━━━━━━━━━\n" +
    "_.menu — ver este menu_"
  );
}

function menuPersonalizar() {
  let texto = "🎨 *PERSONALIZAR MENSAGENS*\n\n━━━━━━━━━━━━━━━━\n";
  texto += "Use: *.set <campo> <texto>*\n\n*Campos disponíveis:*\n";
  for (const [campo, desc] of Object.entries(CAMPOS_DESC)) {
    texto += `› *${campo}* — ${desc}\n`;
  }
  texto += "\n*Variáveis disponíveis em qualquer campo:*\n";
  texto += "› *{cor}* — cor do sinal/resultado\n";
  texto += "› *{n}* — número de greens seguidos\n";
  texto += "› *{data}* — data atual\n";
  texto += "› *{vitorias}*, *{empates}*, *{loss}*, *{rodadas}*\n\n";
  texto += "*Exemplos:*\n";
  texto += "_.set bateu ✅ GREEN {cor}! Vitórias: {vitorias}_\n";
  texto += "_.set sinal 🎯 Entrar em {cor} agora!_\n";
  texto += "_.set greenSeguidos 🔥 {n} greens! Bora lucrar!_";
  return texto;
}

function verMensagens(channelId) {
  const db = loadDB();
  let texto = "📋 *MENSAGENS DESTE GRUPO*\n\n━━━━━━━━━━━━━━━━\n";
  for (const [campo, desc] of Object.entries(CAMPOS_DESC)) {
    const personalizada = db.mensagens[channelId]?.[campo];
    const valor = personalizada || DEFAULT_MSGS[campo];
    const tag = personalizada ? "✏️" : "📌";
    texto += `\n${tag} *${campo}*\n_${valor}_\n`;
  }
  texto += "\n✏️ = personalizada | 📌 = padrão";
  return texto;
}

async function handleMessage(sock, m) {
  if (!m.message) return;

  const from      = m.key.remoteJid;
  const isChannel = from.endsWith("@newsletter");
  const isGroup   = from.endsWith("@g.us");

  if (!isChannel && !isGroup) return;

  const sender    = m.key.participant || from;
  const senderNum = normalizeId(sender);

  const body =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption || "";

  if (!body.startsWith(PREFIX)) return;

  const args    = body.slice(PREFIX.length).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();
  args.shift();

  // .lid disponível para todos
  if (command === "lid") {
    return sock.sendMessage(from, {
      text: "🆔 *O teu ID:* " + senderNum + "\n\nEnvia este ID ao dono para seres adicionado como controlador:\n*.addctrl " + senderNum + "*"
    }, { quoted: m });
  }

  if (!isAuthorized(senderNum)) return;

  const reply = (text) => sock.sendMessage(from, { text }, { quoted: m });
  const e = getEstado(from);

  if (command === "menu") return reply(menuPrincipal());

  if (command === "bacbo") {
    const option = args[0]?.toLowerCase();

    if (!option || option === "status") {
      const canaisAtivos = Object.entries(estado)
        .filter(([, v]) => v.ativo)
        .map(([k]) => k)
        .join("\n› ") || "Nenhum";
      return reply(
        "🎲 *BAC BO — STATUS*\n\n" +
        "Este grupo: " + (e.ativo ? "✅ Ativo" : "❌ Inativo") + "\n\n" +
        "Grupos ativos:\n› " + canaisAtivos + "\n\n" +
        formatPlacar(from, e.stats)
      );
    }

    if (option === "on") {
      if (e.ativo) return reply("⚠️ Sinais já estão ativos neste grupo!");
      if (!isOwner(senderNum)) {
        const canalAtivo = ctrlCanal[senderNum];
        if (canalAtivo && canalAtivo !== from && estado[canalAtivo]?.ativo) {
          return reply("⚠️ Já tens sinais ativos noutro grupo!\nDesativa primeiro com *.bacbo off* nesse grupo.");
        }
        ctrlCanal[senderNum] = from;
      }
      ativarCanal(sock, from);
      return reply(getMensagem(from, "ativado", getVars(from)));
    }

    if (option === "off") {
      if (!e.ativo) return reply("⚠️ Sinais já estão inativos neste grupo!");
      await desativarCanal(sock, from);
      for (const [num, canal] of Object.entries(ctrlCanal)) {
        if (canal === from) delete ctrlCanal[num];
      }
      return reply(getMensagem(from, "desativado", getVars(from)));
    }

    if (option === "placar") return reply(formatPlacar(from, e.stats));

    if (option === "reset") {
      e.stats = { vitorias: 0, empates: 0, loss: 0 };
      e.greenSeguidos = 0;
      return reply("🔄 *Placar resetado!*");
    }

    return reply("❌ Use: .bacbo on/off/placar/reset/status");
  }

  if (command === "anuncio") {
    const option = args[0]?.toLowerCase();
    if (option === "on") {
      e.anuncioAtivo = true;
      return reply("✅ *Anúncio após loss ativado!*\nUse *.set anuncio <texto>* para personalizar.");
    }
    if (option === "off") {
      e.anuncioAtivo = false;
      return reply("⛔ *Anúncio após loss desativado!*");
    }
    return reply(
      "📢 *ANÚNCIO APÓS LOSS*\n\n" +
      "Status: " + (e.anuncioAtivo ? "✅ Ativo" : "❌ Inativo") + "\n\n" +
      "Comandos:\n" +
      "› .anuncio on — ativar\n" +
      "› .anuncio off — desativar\n" +
      "› .set anuncio <texto> — personalizar mensagem"
    );
  }

  if (command === "set") {
    if (!args.length) return reply(menuPersonalizar());
    const campo = args[0];
    const texto = args.slice(1).join(" ");

    if (!CAMPOS_DESC[campo])
      return reply("❌ Campo inválido!\n\nUse *.set* para ver os campos disponíveis.");
    if (!texto)
      return reply("❌ Informe o texto!\nEx: .set bateu ✅ GREEN {cor}!");

    const db = loadDB();
    if (!db.mensagens[from]) db.mensagens[from] = {};
    db.mensagens[from][campo] = texto;
    saveDB(db);

    const preview = texto
      .replace(/\{cor\}/g, "🔵")
      .replace(/\{n\}/g, "5")
      .replace(/\{data\}/g, new Date().toLocaleDateString("pt-AO"))
      .replace(/\{vitorias\}/g, "10")
      .replace(/\{empates\}/g, "2")
      .replace(/\{loss\}/g, "3")
      .replace(/\{rodadas\}/g, "13");

    return reply("✅ *Mensagem atualizada!*\n\n*Campo:* " + campo + "\n*Preview:*\n" + preview);
  }

  if (command === "ver") return reply(verMensagens(from));

  if (command === "resetmsg") {
    const db = loadDB();
    delete db.mensagens[from];
    saveDB(db);
    return reply("🔄 *Mensagens restauradas para o padrão!*");
  }

  if (command === "addctrl") {
    if (!isOwner(senderNum)) return reply("🔒 Apenas o *dono* pode adicionar controladores!");
    const lid = args[0];
    if (!lid) return reply("❌ Informe o LID!\nPede ao utilizador para digitar *.lid* no grupo e envia o ID aqui.\nEx: .addctrl 161899094274260");
    const db = loadDB();
    if (db.controllers.includes(lid)) return reply("⚠️ Este ID já é controlador!");
    db.controllers.push(lid);
    saveDB(db);
    return reply("✅ *Controlador adicionado:* " + lid);
  }

  if (command === "rmctrl") {
    if (!isOwner(senderNum)) return reply("🔒 Apenas o *dono* pode remover controladores!");
    const lid = args[0];
    if (!lid) return reply("❌ Informe o LID!\nEx: .rmctrl 161899094274260");
    const db = loadDB();
    if (!db.controllers.includes(lid)) return reply("⚠️ Este ID não é controlador!");
    db.controllers = db.controllers.filter(c => c !== lid);
    saveDB(db);
    return reply("✅ *Controlador removido:* " + lid);
  }

  if (command === "ctrllist") {
    if (!isOwner(senderNum)) return reply("🔒 Apenas o *dono* pode ver a lista!");
    const db = loadDB();
    if (!db.controllers.length) return reply("📋 Nenhum controlador cadastrado.");
    return reply("👥 *CONTROLADORES*\n\n" + db.controllers.map((c, i) => `${i + 1}. ${c}`).join("\n"));
  }
}

async function startBot() {
  console.log("🎲 Bac Bo Signal Bot iniciando...");

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, "data/session")
  );

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Bac Bo Bot", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n📱 Escaneie o QR Code:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("🔌 Conexão fechada. Código:", reason);
      if (reason === DisconnectReason.loggedOut) {
        console.log("🚪 Sessão encerrada. Delete data/session e reinicie.");
        process.exit(0);
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("🔄 Reiniciando...");
        setTimeout(startBot, 2000);
      } else if (
        reason === DisconnectReason.connectionClosed ||
        reason === DisconnectReason.connectionLost ||
        reason === DisconnectReason.timedOut ||
        reason === 1006 || reason === undefined
      ) {
        console.log("🔄 Reconectando em 5s...");
        setTimeout(startBot, 5000);
      } else {
        console.log("🔄 Reconectando em 10s... Código:", reason);
        setTimeout(startBot, 10000);
      }
    } else if (connection === "open") {
      console.log("✅ Bac Bo Bot conectado!");
      console.log("📌 Digite .menu num grupo para começar");
      globalSock = sock;
      for (const [channelId, e] of Object.entries(estado)) {
        if (e.ativo) {
          if (e.interval) clearInterval(e.interval);
          e.interval = setInterval(() => tick(sock, channelId), 2000);
          console.log("🔄 Sinal reconectado:", channelId);
        }
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (!m.message) continue;
      if (m.key.remoteJid === "status@broadcast") continue;
      if (m.key.fromMe) continue;
      await handleMessage(sock, m).catch(console.error);
    }
  });
}

startBot().catch(console.error);
process.on("uncaughtException",  (err) => console.error("❌", err.message));
process.on("unhandledRejection", (err) => console.error("❌", err?.message || err));
