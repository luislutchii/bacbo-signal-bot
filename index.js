const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino    = require("pino");
const qrcode  = require("qrcode-terminal");
const { Boom } = require("@hapi/boom");
const axios   = require("axios");
const path    = require("path");

const OWNER   = "244924319522";
const PREFIX  = ".";
const API_URL = "https://api.signals-house.com/validate/results?tableId=1";

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

function getEstado(groupId) {
  if (!estado[groupId]) {
    estado[groupId] = {
      ativo: false, history: [], processedIds: new Set(),
      waitingResult: false, lastSignalColor: null,
      martingaleCount: 0, stats: { vitorias: 0, empates: 0, loss: 0 },
      interval: null, currentDate: new Date().toDateString(),
      analiseMsgId: null, galeMsgId: null,
    };
  }
  return estado[groupId];
}

function checkDateReset(e) {
  const today = new Date().toDateString();
  if (e.currentDate !== today) {
    e.currentDate = today;
    e.stats = { vitorias: 0, empates: 0, loss: 0 };
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

function formatPlacar(e) {
  const hoje = new Date().toLocaleDateString("pt-AO");
  return (
    "🏆 *PLACAR DO DIA*\n📅 " + hoje + "\n━━━━━━━━━━━━━━━━\n" +
    "✅ *Vitórias:* " + e.stats.vitorias + "\n" +
    "🤝 *Empates:* " + e.stats.empates + "\n" +
    "❌ *Loss:* " + e.stats.loss + "\n━━━━━━━━━━━━━━━━\n" +
    "📊 *Rodadas:* " + (e.stats.vitorias + e.stats.loss)
  );
}

async function deletarMsg(sock, groupId, msgId) {
  if (!msgId) return;
  try {
    await sock.sendMessage(groupId, {
      delete: { remoteJid: groupId, fromMe: true, id: msgId }
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

async function resolveResult(sock, groupId, emoji) {
  const e = getEstado(groupId);
  const target = e.lastSignalColor;

  await deletarMsg(sock, groupId, e.analiseMsgId);
  e.analiseMsgId = null;

  if (emoji === "🟡" || emoji === target) {
    await deletarMsg(sock, groupId, e.galeMsgId);
    e.galeMsgId = null;
    e.stats.vitorias++;
    if (emoji === "🟡") e.stats.empates++;
    e.waitingResult = false;
    e.martingaleCount = 0;
    await sock.sendMessage(groupId, { text: "🤑✅ *BATEU!* ✅🤑" });
    await sock.sendMessage(groupId, { text: formatPlacar(e) });
    return;
  }

  if (e.martingaleCount === 0) {
    e.martingaleCount = 1;
    const sent = await sock.sendMessage(groupId, {
      text: "🔄 *Fazer 1º Gale!*\n\n*Jogar na cor:* " + target + "\nProteger o empate"
    });
    e.galeMsgId = sent?.key?.id || null;
    return;
  }

  await deletarMsg(sock, groupId, e.galeMsgId);
  e.galeMsgId = null;
  e.stats.loss++;
  e.waitingResult = false;
  e.martingaleCount = 0;
  await sock.sendMessage(groupId, { text: "⭕ *Não pegamos!*" });
  await sock.sendMessage(groupId, { text: formatPlacar(e) });
}

async function checkPatterns(sock, groupId) {
  const e = getEstado(groupId);
  if (e.waitingResult || e.history.length < 2) return;

  const sinal = findPattern(e.history);
  if (!sinal) {
    await deletarMsg(sock, groupId, e.analiseMsgId);
    const sent = await sock.sendMessage(groupId, { text: "🔍 Analisando padrões..." });
    e.analiseMsgId = sent?.key?.id || null;
    return;
  }

  await deletarMsg(sock, groupId, e.analiseMsgId);
  e.analiseMsgId = null;
  e.waitingResult = true;
  e.lastSignalColor = sinal;
  e.martingaleCount = 0;
  e.galeMsgId = null;

  await sock.sendMessage(groupId, {
    text:
      "🎲 *Bac Bo Brasil*\n\n━━━━━━━━━━━━━━━━\n" +
      "*Jogar na cor:* " + sinal + "\nProteger o empate",
  });
}

async function tick(sock, groupId) {
  const e = getEstado(groupId);
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

  if (e.waitingResult) await resolveResult(sock, groupId, emoji);
  else await checkPatterns(sock, groupId);
}

async function handleMessage(sock, msg) {
  if (!msg.message) return;
  const isGroup = msg.key.remoteJid.endsWith("@g.us");
  const from    = msg.key.remoteJid;
  const sender  = isGroup ? msg.key.participant || from : from;
  const senderNum = sender.replace(/:.*@/, "@").replace(/@.*/, "");

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption || "";

  if (!body.startsWith(PREFIX)) return;

  const args    = body.slice(PREFIX.length).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();
  args.shift();

  const isOwner = senderNum === OWNER;
  const reply   = (text) => sock.sendMessage(from, { text }, { quoted: msg });

  if (command !== "bacbo") return;
  if (!isOwner) return reply("🔒 Apenas o *dono* pode usar este comando!");
  if (!isGroup) return reply("❌ Apenas em grupos!");

  const option = args[0]?.toLowerCase();
  const e = getEstado(from);

  if (!option || option === "status") {
    return reply(
      "🎲 *BAC BO - SINAIS*\n\nStatus: " + (e.ativo ? "✅ Ativo" : "❌ Inativo") +
      "\n\n" + formatPlacar(e) +
      "\n\nComandos:\n• .bacbo on\n• .bacbo off\n• .bacbo placar\n• .bacbo reset"
    );
  }

  if (option === "on") {
    if (e.ativo) return reply("⚠️ Sinais já estão ativos!");
    e.ativo = true;
    e.history = [];
    e.waitingResult = false;
    e.martingaleCount = 0;
    e.analiseMsgId = null;
    e.galeMsgId = null;
    if (e.interval) clearInterval(e.interval);
    e.interval = setInterval(() => tick(sock, from), 2000);
    return reply("✅ *Sinais Bac Bo ativados!*\n\n🎲 Analisando padrões em tempo real...\n⚙️ Estratégia: Sinal + 1 Gale");
  }

  if (option === "off") {
    e.ativo = false;
    if (e.interval) { clearInterval(e.interval); e.interval = null; }
    await deletarMsg(sock, from, e.analiseMsgId);
    await deletarMsg(sock, from, e.galeMsgId);
    e.analiseMsgId = null;
    e.galeMsgId = null;
    return reply("⛔ *Sinais Bac Bo desativados!*");
  }

  if (option === "placar") return reply(formatPlacar(e));

  if (option === "reset") {
    e.stats = { vitorias: 0, empates: 0, loss: 0 };
    return reply("🔄 *Placar resetado!*");
  }

  return reply("❌ Use: .bacbo on/off/placar/reset");
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
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconectando...");
        setTimeout(startBot, 5000);
      } else {
        console.log("🚪 Sessão encerrada. Delete data/session e reinicie.");
        process.exit(0);
      }
    } else if (connection === "open") {
      console.log("✅ Bac Bo Bot conectado!");
      console.log("📌 Comando: .bacbo on/off/placar/reset");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      if (msg.key.fromMe) continue;
      await handleMessage(sock, msg).catch(console.error);
    }
  });
}

startBot().catch(console.error);
process.on("uncaughtException",  (err) => console.error("❌", err.message));
process.on("unhandledRejection", (err) => console.error("❌", err?.message || err));
