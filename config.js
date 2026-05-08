module.exports = {
  mensagemSinal: (cor) =>
    "🎲 *Bac Bo Brasil*\n\n" +
    "━━━━━━━━━━━━━━━━\n" +
    "*Jogar na cor:* " + cor + "\n" +
    "Proteger o empate",

  mensagemGale: (cor) =>
    "🔄 *Fazer 1º Gale!*\n\n" +
    "*Jogar na cor:* " + cor + "\n" +
    "Proteger o empate",

  mensagemBateu:      "🤑✅ *BATEU!* ✅🤑",
  mensagemNaoPegou:   "⭕ *Não pegamos!*",
  mensagemAnalisando: "🔍 Analisando padrões...",

  mensagemAtivado:
    "✅ *Sinais Bac Bo ativados!*\n\n" +
    "🎲 Analisando padrões em tempo real...\n" +
    "⚙️ Estratégia: Sinal + 1 Gale",

  mensagemDesativado: "⛔ *Sinais Bac Bo desativados!*",

  formatPlacar: (stats) => {
    const hoje = new Date().toLocaleDateString("pt-AO");
    return (
      "🏆 *PLACAR DO DIA*\n" +
      "📅 " + hoje + "\n" +
      "━━━━━━━━━━━━━━━━\n" +
      "✅ *Vitórias:* " + stats.vitorias + "\n" +
      "🤝 *Empates:* " + stats.empates + "\n" +
      "❌ *Loss:* " + stats.loss + "\n" +
      "━━━━━━━━━━━━━━━━\n" +
      "📊 *Rodadas:* " + (stats.vitorias + stats.loss)
    );
  },
};
