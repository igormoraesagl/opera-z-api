// Conector MCP do WhatsApp (Z-API) rodando em Cloudflare Workers.
// Implementa o transporte MCP "Streamable HTTP" de forma simples (JSON-RPC).

const PROTOCOL_VERSION = "2024-11-05";

function zapiBase(env) {
  return `https://api.z-api.io/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_INSTANCE_TOKEN}`;
}

async function zapi(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`${zapiBase(env)}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Client-Token": env.ZAPI_CLIENT_TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!res.ok) {
    throw new Error(`Z-API ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

const onlyDigits = (s) => String(s).replace(/\D/g, "");

// Cria a tabela de mensagens na primeira escrita/leitura, sem depender de rodar
// schema.sql pela mão. Deixa o fluxo do botão "Deploy to Cloudflare" funcionar
// ponta a ponta: o botão provisiona o D1 e o Worker cria a tabela sozinho aqui.
// Idempotente (IF NOT EXISTS) e cacheado por isolate para não repetir a cada request.
let schemaPronto = false;
async function garantirSchema(env) {
  if (schemaPronto || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS messages (
       message_id   TEXT PRIMARY KEY,
       chat_id      TEXT NOT NULL,
       chat_name    TEXT,
       is_group     INTEGER DEFAULT 0,
       sender       TEXT,
       sender_phone TEXT,
       from_me      INTEGER DEFAULT 0,
       ts           INTEGER NOT NULL,
       type         TEXT,
       text         TEXT,
       created_at   INTEGER NOT NULL
     )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, ts)`
  ).run();
  schemaPronto = true;
}

// Destino de envio: número comum vira só dígitos; id de grupo (tem '-' ou letras) é preservado.
function phoneParaEnvio(x) {
  const s = String(x).trim();
  if (/[^\d]/.test(s)) return s.replace(/@.*/, ""); // grupo: mantém, remove sufixo @g.us se houver
  return onlyDigits(s);
}

// Descobre o tipo de uma mensagem Z-API a partir das chaves presentes.
function tipoMensagem(m) {
  for (const t of ["text", "image", "video", "audio", "document", "sticker", "contact", "location", "poll", "reaction"]) {
    if (m[t]) return t;
  }
  return "outro";
}

async function buscarContatos(env, nome) {
  const alvo = nome.trim().toLowerCase();
  const contatos = await zapi(env, `/contacts?page=1&pageSize=2000`);
  const lista = Array.isArray(contatos) ? contatos : [];
  return lista
    .filter((c) => (c.name || c.short || "").toLowerCase().includes(alvo))
    .map((c) => ({ name: c.name || c.short || "(sem nome)", phone: c.phone }));
}

// Lista chats (conversas e grupos) da instância, opcionalmente filtrando por nome.
async function listarChats(env, { nome, apenasGrupos } = {}) {
  const resp = await zapi(env, `/chats?page=1&pageSize=1000`);
  let lista = Array.isArray(resp) ? resp : resp?.chats || [];
  if (apenasGrupos) lista = lista.filter((c) => c.isGroup);
  if (nome) {
    const alvo = nome.trim().toLowerCase();
    lista = lista.filter((c) => (c.name || "").toLowerCase().includes(alvo));
  }
  return lista.map((c) => ({
    name: c.name || "(sem nome)",
    id: c.phone,
    isGroup: !!c.isGroup,
    unread: Number(c.unread || c.messagesUnread || 0),
    lastTime: c.lastMessageTime ? Number(c.lastMessageTime) : null,
  }));
}

const fmtHora = (ms) =>
  ms
    ? new Date(ms).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

// Extrai um texto legível de uma mensagem Z-API de qualquer tipo.
function conteudoMensagem(m) {
  if (m.text?.message) return m.text.message;
  if (typeof m.text === "string" && m.text) return m.text;
  if (m.image) return `🖼️ [imagem]${m.image.caption ? " " + m.image.caption : ""}`;
  if (m.video) return `🎬 [vídeo]${m.video.caption ? " " + m.video.caption : ""}`;
  if (m.audio) return "🎧 [áudio]";
  if (m.document) return `📎 [documento] ${m.document.fileName || m.document.title || ""}`.trim();
  if (m.sticker) return "🩹 [figurinha]";
  if (m.contact) return `👤 [contato] ${m.contact.displayName || ""}`.trim();
  if (m.location) return "📍 [localização]";
  if (m.poll) return `📊 [enquete] ${m.poll.name || ""}`.trim();
  if (m.reaction) return `↩️ [reação ${m.reaction.value || ""}]`.trim();
  if (m.buttonsResponseMessage) return m.buttonsResponseMessage.message || "[resposta]";
  if (m.listResponseMessage) return m.listResponseMessage.message || "[resposta lista]";
  return "[mensagem sem texto]";
}

// Grava no D1 uma mensagem vinda do webhook do Z-API (idempotente por message_id).
async function salvarMensagem(env, m, agoraMs) {
  if (!env.DB || !m?.messageId || !m?.phone) return;
  await garantirSchema(env);
  const texto = conteudoMensagem(m);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO messages
       (message_id, chat_id, chat_name, is_group, sender, sender_phone, from_me, ts, type, text, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      m.messageId,
      String(m.phone),
      m.chatName || null,
      m.isGroup ? 1 : 0,
      m.fromMe ? "Eu" : m.senderName || m.participantPhone || m.phone || null,
      m.participantPhone || m.phone || null,
      m.fromMe ? 1 : 0,
      Number(m.momment || m.moment || agoraMs),
      tipoMensagem(m),
      texto,
      agoraMs
    )
    .run();
}

// Lê mensagens de uma conversa/grupo a partir do D1 (capturadas via webhook).
// Filtra por dia (YYYY-MM-DD em America/Sao_Paulo) OU retorna as últimas N.
async function lerMensagens(env, { id, quantidade = 40, data }) {
  if (!env.DB) throw new Error("Banco D1 não configurado.");
  await garantirSchema(env);
  const chat = phoneParaEnvio(id);
  let rows;
  if (data) {
    const inicio = Date.parse(`${data}T00:00:00-03:00`);
    const fim = inicio + 86400000;
    rows = (
      await env.DB.prepare(
        `SELECT ts, sender, from_me, text FROM messages
           WHERE chat_id = ? AND ts >= ? AND ts < ? ORDER BY ts ASC`
      )
        .bind(chat, inicio, fim)
        .all()
    ).results;
  } else {
    const amount = Math.min(Math.max(Number(quantidade) || 40, 1), 500);
    rows = (
      await env.DB.prepare(
        `SELECT ts, sender, from_me, text FROM messages
           WHERE chat_id = ? ORDER BY ts DESC LIMIT ?`
      )
        .bind(chat, amount)
        .all()
    ).results;
    rows = rows.reverse(); // volta para ordem cronológica
  }
  return rows.map((r) => ({
    hora: fmtHora(r.ts),
    autor: r.from_me ? "Eu" : r.sender || "?",
    fromMe: !!r.from_me,
    texto: r.text,
  }));
}

// ---- Definição das ferramentas ----
const TOOLS = [
  {
    name: "status_instancia",
    description: "Verifica se o WhatsApp está conectado e pareado na instância Z-API.",
    inputSchema: { type: "object", properties: {} },
    handler: async (env) => {
      const s = await zapi(env, `/status`);
      return JSON.stringify(s);
    },
  },
  {
    name: "buscar_contato",
    description:
      "Busca contatos do WhatsApp pelo nome (parcial, sem diferenciar maiúsculas). Retorna nome e telefone.",
    inputSchema: {
      type: "object",
      properties: { nome: { type: "string", description: "Parte do nome, ex: 'Hosana'" } },
      required: ["nome"],
    },
    handler: async (env, { nome }) => {
      const achados = await buscarContatos(env, nome);
      if (!achados.length) return `Nenhum contato encontrado para "${nome}".`;
      return achados.map((c) => `${c.name} | ${c.phone}`).join("\n");
    },
  },
  {
    name: "listar_chats",
    description:
      "Lista as conversas e grupos do WhatsApp (as mais recentes primeiro). Filtra por nome e/ou só grupos. Retorna nome, id (use em ler_mensagens), tipo e nº de não lidas. Use para achar o id de um grupo, ex: 'BLACK BOX'.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Parte do nome do chat/grupo para filtrar (opcional)" },
        apenas_grupos: { type: "boolean", description: "Se true, retorna só grupos" },
      },
    },
    handler: async (env, { nome, apenas_grupos }) => {
      const chats = await listarChats(env, { nome, apenasGrupos: apenas_grupos });
      if (!chats.length) return `Nenhum chat encontrado${nome ? ` para "${nome}"` : ""}.`;
      chats.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
      return chats
        .slice(0, 60)
        .map(
          (c) =>
            `${c.isGroup ? "👥" : "👤"} ${c.name} | id: ${c.id}${c.unread ? ` | ${c.unread} não lidas` : ""}`
        )
        .join("\n");
    },
  },
  {
    name: "ler_mensagens",
    description:
      "Lê mensagens de uma conversa/grupo a partir do histórico capturado (via webhook, armazenado no banco). " +
      "Informe o id (de listar_chats). Use 'data' (YYYY-MM-DD) para pegar um dia inteiro, ou 'quantidade' para as últimas N. " +
      "Retorna hora, autor e conteúdo — base para resumir o dia de um grupo. Só há mensagens a partir de quando a captura foi ativada.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Telefone (só dígitos) ou id do grupo obtido em listar_chats" },
        data: { type: "string", description: "Dia a resumir no formato YYYY-MM-DD (fuso de São Paulo). Opcional." },
        quantidade: { type: "number", description: "Se não usar 'data': últimas N mensagens (padrão 40, máx 500)" },
      },
      required: ["id"],
    },
    handler: async (env, { id, quantidade, data }) => {
      const msgs = await lerMensagens(env, { id, quantidade, data });
      if (!msgs.length)
        return data
          ? `Nenhuma mensagem capturada para esse chat em ${data}. (A captura só guarda mensagens a partir de quando foi ativada.)`
          : "Nenhuma mensagem capturada para esse chat ainda.";
      return msgs.map((m) => `[${m.hora}] ${m.autor}: ${m.texto}`).join("\n");
    },
  },
  {
    name: "enviar_texto",
    description:
      "Envia mensagem de texto no WhatsApp para um número (formato internacional só com dígitos, ex: 5511999998888).",
    inputSchema: {
      type: "object",
      properties: {
        telefone: { type: "string", description: "DDI+DDD+número, só dígitos" },
        mensagem: { type: "string", description: "Texto da mensagem" },
      },
      required: ["telefone", "mensagem"],
    },
    handler: async (env, { telefone, mensagem }) => {
      const r = await zapi(env, `/send-text`, {
        method: "POST",
        body: { phone: phoneParaEnvio(telefone), message: mensagem },
      });
      return `Enviado ✅ (messageId: ${r.messageId || r.id || "?"})`;
    },
  },
  {
    name: "enviar_texto_para_contato",
    description:
      "Busca um contato pelo nome e envia texto. Se houver mais de um, retorna a lista para escolher em vez de enviar.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome (ou parte) do contato" },
        mensagem: { type: "string", description: "Texto da mensagem" },
      },
      required: ["nome", "mensagem"],
    },
    handler: async (env, { nome, mensagem }) => {
      const achados = await buscarContatos(env, nome);
      if (!achados.length) return `Nenhum contato encontrado para "${nome}". Nada enviado.`;
      if (achados.length > 1)
        return (
          `Vários contatos para "${nome}" — nada enviado. Escolha e use enviar_texto:\n` +
          achados.map((c) => `${c.name} | ${c.phone}`).join("\n")
        );
      const c = achados[0];
      const r = await zapi(env, `/send-text`, {
        method: "POST",
        body: { phone: phoneParaEnvio(c.phone), message: mensagem },
      });
      return `Enviado para ${c.name} (${c.phone}) ✅ (messageId: ${r.messageId || r.id || "?"})`;
    },
  },
  {
    name: "enviar_imagem",
    description: "Envia uma imagem (por URL pública) no WhatsApp, com legenda opcional.",
    inputSchema: {
      type: "object",
      properties: {
        telefone: { type: "string" },
        url_imagem: { type: "string", description: "URL pública da imagem" },
        legenda: { type: "string", description: "Legenda opcional" },
      },
      required: ["telefone", "url_imagem"],
    },
    handler: async (env, { telefone, url_imagem, legenda }) => {
      const r = await zapi(env, `/send-image`, {
        method: "POST",
        body: { phone: phoneParaEnvio(telefone), image: url_imagem, caption: legenda || "" },
      });
      return `Imagem enviada ✅ (messageId: ${r.messageId || r.id || "?"})`;
    },
  },
  {
    name: "enviar_documento",
    description: "Envia um documento/PDF (por URL pública) no WhatsApp.",
    inputSchema: {
      type: "object",
      properties: {
        telefone: { type: "string" },
        url_documento: { type: "string", description: "URL pública do arquivo" },
        nome_arquivo: { type: "string", description: "Nome exibido, ex: relatorio.pdf" },
        extensao: { type: "string", description: "Extensão (pdf, docx, xlsx). Padrão pdf" },
      },
      required: ["telefone", "url_documento", "nome_arquivo"],
    },
    handler: async (env, { telefone, url_documento, nome_arquivo, extensao }) => {
      const ext = extensao || "pdf";
      const r = await zapi(env, `/send-document/${ext}`, {
        method: "POST",
        body: { phone: phoneParaEnvio(telefone), document: url_documento, fileName: nome_arquivo },
      });
      return `Documento enviado ✅ (messageId: ${r.messageId || r.id || "?"})`;
    },
  },
];

// ---- Tratamento JSON-RPC do MCP ----
async function handleRpc(env, msg) {
  const { id, method, params } = msg;

  // Notificações (sem id) não retornam resposta.
  if (id === undefined || id === null) return null;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "zapi-whatsapp", version: "1.0.0" },
        },
      };
    }

    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: `Ferramenta desconhecida: ${params?.name}` } };
      }
      try {
        const out = await tool.handler(env, params.arguments || {});
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out }] } };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `Erro: ${e.message}` }], isError: true },
        };
      }
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método não suportado: ${method}` } };
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
  }
}

// Consciencia de versao (puxada). O Worker checa o GitHub e avisa o DONO se
// estiver desatualizado. NAO manda nada pra ninguem: le so o arquivo VERSION do
// repo publico. E de proposito: mandar dado pra um servidor central contradiz a
// promessa de que o dado fica na conta do cliente.
const OPERA_VERSAO = "1.0.0";
async function statusVersao() {
  const repo = "opera-z-api";
  let ultima = null, atualizado = null, aviso;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/igormoraesagl/${repo}/main/VERSION`, { cf: { cacheTtl: 3600 } });
    if (r.ok) { ultima = (await r.text()).trim(); atualizado = ultima === OPERA_VERSAO; }
  } catch (_) {}
  if (atualizado === false) {
    aviso = `Sua versao (${OPERA_VERSAO}) esta atras da ${ultima}. Reinstale pelo botao Deploy to Cloudflare do README para atualizar. Esta checagem le so o GitHub, nada e enviado a ninguem.`;
  }
  return { conector: repo, versao: OPERA_VERSAO, ultima, atualizado, aviso };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Healthcheck público
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify(await statusVersao(), null, 1), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Webhook do Z-API (on-message-received): grava mensagens no D1. Protegido pelo segredo no caminho.
    const webhookPath = `/${env.MCP_SECRET}/webhook`;
    if (url.pathname === webhookPath) {
      if (request.method !== "POST") return new Response("ok", { status: 200 });
      const agora = Date.now();
      try {
        const payload = await request.json();
        const itens = Array.isArray(payload) ? payload : [payload];
        for (const m of itens) {
          // Só grava callbacks de mensagem que tenham id e algum conteúdo.
          if (m && m.messageId && m.phone && m.type !== "DeliveryCallback" && m.type !== "MessageStatusCallback") {
            await salvarMensagem(env, m, agora);
          }
        }
      } catch (e) {
        // Nunca falha o webhook (evita reentrega infinita do Z-API); só loga.
        console.log("webhook erro:", e.message);
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Endpoint SIMPLES pra enviar WhatsApp (para Pluga/Zapier/qualquer webhook).
    // Aceita POST JSON {telefone, mensagem} ou query params ?telefone=..&mensagem=..
    if (url.pathname === `/${env.MCP_SECRET}/enviar`) {
      // SÓ POST. Enviar WhatsApp é acao destrutiva: por GET, um prefetch do
      // navegador, um crawler ou um link clicado sem querer dispararia a
      // mensagem. Params so pelo corpo, nunca pela query.
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, erro: "use POST" }), { status: 405, headers: { "Content-Type": "application/json" } });
      }
      let telefone, mensagem;
      try {
        const b = await request.json();
        telefone = b.telefone || b.phone;
        mensagem = b.mensagem || b.message || b.texto;
      } catch {}
      if (!telefone || !mensagem) {
        return new Response(JSON.stringify({ ok: false, erro: "informe telefone e mensagem" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      try {
        const r = await zapi(env, `/send-text`, { method: "POST", body: { phone: phoneParaEnvio(telefone), message: mensagem } });
        return new Response(JSON.stringify({ ok: true, messageId: r.messageId || r.id || null }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, erro: e.message }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    // Endpoint MCP protegido por segredo no caminho: /<MCP_SECRET>/mcp
    const expected = `/${env.MCP_SECRET}/mcp`;
    if (url.pathname !== expected) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Suporta requisição única ou batch.
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean);
      return new Response(JSON.stringify(responses), { headers: { "Content-Type": "application/json" } });
    }

    const response = await handleRpc(env, body);
    if (response === null) {
      return new Response(null, { status: 202 }); // notificação
    }
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  },
};
