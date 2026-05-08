# 🎲 Bac Bo Signal Bot

Bot de sinais para o jogo **Bac Bo** via WhatsApp, construído com [Baileys](https://github.com/WhiskeySockets/Baileys). Funciona no **Termux** (Android) ou em qualquer servidor Linux.

---

## ✨ Funcionalidades

- Conecta ao WhatsApp via QR Code
- Envia sinais em tempo real com base em padrões históricos
- Estratégia com **1 Gale** automático
- Placar diário com vitórias, empates e losses
- Reset automático do placar à meia-noite
- Funciona em múltiplos grupos simultaneamente

---

## 📋 Comandos

| Comando | Descrição |
|---|---|
| `.bacbo on` | Ativa os sinais no grupo |
| `.bacbo off` | Desativa os sinais no grupo |
| `.bacbo placar` | Mostra o placar do dia |
| `.bacbo reset` | Reseta o placar |
| `.bacbo` | Mostra status e ajuda |

> Apenas o **dono** (número configurado) pode usar os comandos.

---

## 🚀 Instalação

### Pré-requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
- npm
- Git

---

### 📱 Termux (Android)

```bash
# 1. Atualizar pacotes
pkg update && pkg upgrade -y

# 2. Instalar dependências do sistema
pkg install nodejs git -y

# 3. Clonar o repositório
https://github.com/luislutchii/bacbo-signal-bot.git
cd bacbo-signal-bot

# 4. Instalar dependências do projeto
npm install

# 5. Iniciar o bot
node index.js
```

---

### 🖥️ Linux / VPS

```bash
# 1. Instalar Node.js (se necessário)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs git -y

# 2. Clonar o repositório
https://github.com/luislutchii/bacbo-signal-bot.git

# 3. Instalar dependências
npm install

# 4. Iniciar
node index.js
```

---

## 🔗 Conectar ao WhatsApp

Após iniciar o bot, um QR Code aparecerá no terminal:

```
📱 Escaneie o QR Code:

[QR CODE AQUI]
```

No WhatsApp do número do bot:
1. Abrir WhatsApp
2. Tocar nos **3 pontos** → **Aparelhos conectados**
3. Tocar em **Conectar aparelho**
4. Escanear o QR Code

---

## ⚙️ Configuração

No topo do arquivo `index.js`:

```js
const OWNER  = "244924319522"; // Seu número sem + (ex: Angola: 244...)
const PREFIX = ".";            // Prefixo dos comandos
```

---

## 🔄 Manter rodando em segundo plano (Termux)

```bash
# Instalar tmux
pkg install tmux -y

# Criar sessão
tmux new -s bacbo

# Iniciar o bot dentro do tmux
node index.js

# Sair sem fechar: Ctrl+B → D
# Voltar: tmux attach -t bacbo
```

---

## 📊 Como funciona

O bot consulta a API de resultados a cada **2 segundos** e analisa os últimos resultados:

| Padrão | Sinal |
|---|---|
| 🔵🔴 | Apostar 🔵 |
| 🔴🔵 | Apostar 🔴 |
| 🔵🔵🔵 | Apostar 🔴 |
| 🔴🔴🔴 | Apostar 🔵 |
| 🔴🔴🔵 | Apostar 🔵 |
| 🔵🔵🔴 | Apostar 🔴 |

**Estratégia:** Sinal direto + 1 Gale em caso de erro. Empate (🟡) conta como vitória.

---

## ⚠️ Aviso

Este bot é apenas para fins educacionais. Jogos de azar envolvem riscos financeiros. Use com responsabilidade.

---

## 👤 Autor

**Luís Lutchi** — [@luislutchii](https://instagram.com/luislutchii)
