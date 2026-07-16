-- Mensagens capturadas via webhook do Z-API (modo multi-device não guarda histórico).
-- OBS: você normalmente NÃO precisa rodar este arquivo. O Worker cria a tabela
-- sozinho na primeira escrita (função garantirSchema em src/index.js). Este SQL
-- fica como referência e pra quem quiser criar a tabela na mão pelo Console do D1.
CREATE TABLE IF NOT EXISTS messages (
  message_id   TEXT PRIMARY KEY,        -- id da mensagem no WhatsApp (evita duplicar)
  chat_id      TEXT NOT NULL,           -- telefone (DM) ou id do grupo
  chat_name    TEXT,                    -- nome do grupo/chat
  is_group     INTEGER DEFAULT 0,
  sender       TEXT,                    -- nome de quem enviou
  sender_phone TEXT,
  from_me      INTEGER DEFAULT 0,
  ts           INTEGER NOT NULL,        -- timestamp em ms (momment)
  type         TEXT,                    -- text, image, audio, ...
  text         TEXT,                    -- conteúdo legível
  created_at   INTEGER NOT NULL         -- quando o Worker gravou (ms)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, ts);
