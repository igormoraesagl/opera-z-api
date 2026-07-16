# AGENTS.md · Conector WhatsApp (Z-API)

## O que é
CONECTOR: WhatsApp via Z-API.
Deixa o Claude operar o WhatsApp por comando: checar se a instância está
conectada, buscar contato, listar conversas e grupos, ler o histórico de um
chat (capturado por webhook) e enviar texto, imagem e documento.

## Credenciais que precisa
| Variável | O que é | Onde conseguir |
|---|---|---|
| MCP_SECRET | Segredo do caminho da URL | No fluxo do botão, você inventa um texto longo e aleatório (32+ caracteres) e cola em Settings. No fluxo do `deploy.sh`, o script gera sozinho. O mesmo segredo vale pra URL do MCP e pra URL do webhook. |
| ZAPI_INSTANCE_ID | ID da instância Z-API | No painel da Z-API: abra sua instância, aba "Segurança"/dados da instância. É o "ID da instância". |
| ZAPI_INSTANCE_TOKEN | Token da instância | No mesmo lugar do ID, campo "Token da instância". É o token que vai na URL da API. |
| ZAPI_CLIENT_TOKEN | Token de segurança da conta (Client-Token) | Painel Z-API, menu "Segurança" da conta (nível conta, não da instância). Vai no header `Client-Token` de toda chamada. |

## Bindings
Este conector usa um banco **D1** (binding `DB`) para guardar o histórico de
mensagens que chegam pelo webhook. O WhatsApp multi-device não devolve
histórico pela API, então a leitura (`ler_mensagens`) só enxerga o que foi
capturado a partir de quando o webhook começou a apontar pra cá.

O banco NÃO é um segredo, é um binding declarado no `wrangler.toml`. A tabela
`messages` (e o índice) nasce sozinha na primeira escrita: o `src/index.js` tem
a função `garantirSchema`, chamada antes de gravar e de ler, com
`CREATE TABLE IF NOT EXISTS`. Ninguém precisa rodar `schema.sql` na mão
no fluxo do botão. O `template/schema.sql` fica como referência e pra quem quiser
criar a tabela na mão pelo Console do D1.

- **Fluxo do botão (recomendado):** o botão "Deploy to Cloudflare" lê o
  `wrangler.toml`, cria o banco D1 na conta do cliente e escreve o `database_id`
  sozinho no deploy. Zero terminal, zero schema na mão.
- **Fluxo por terminal (deploy.sh):** aí sim você cria o banco antes e cola o id:
  1. `npx wrangler d1 create zapi-whatsapp-db`
  2. Acrescente o `database_id` que ele imprime no bloco `[[d1_databases]]` do `template/wrangler.toml`. (Pelo botão isso é automático e o `database_id` fica de fora, de propósito: com placeholder o deploy quebraria.)
  3. (Opcional) `npx wrangler d1 execute zapi-whatsapp-db --remote --file=./schema.sql` cria a tabela já de cara. Se pular, o Worker cria na primeira mensagem.

## Como fazer deploy (um por cliente)

### Caminho principal: botão "Deploy to Cloudflare" (sem terminal)
1. Abra o `README.md` deste conector e clique no botão "Deploy to Cloudflare".
2. Autorize GitHub e Cloudflare. O botão cria o Worker e provisiona o D1 sozinho.
3. No painel da Cloudflare, abra o Worker, vá em Settings, Variables and Secrets, e cole as 4 chaves como Secret: `MCP_SECRET` (você inventa), `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`.
4. Aponte o webhook da Z-API para `https://<worker>.<subdominio>.workers.dev/<MCP_SECRET>/webhook` (seção Webhook abaixo).
5. Copie a URL do MCP (`/<MCP_SECRET>/mcp`) e cole no Claude.
6. Passo a passo detalhado no `guia-conexao.md`.

### Caminho alternativo: deploy.sh (linha de comando)
1. Entre em `mcps/z-api/template/`.
2. Crie o D1 e cole o `database_id` no `wrangler.toml` (seção Bindings, fluxo por terminal).
3. Rode `./deploy.sh <slug-do-cliente>` (ex.: `./deploy.sh agencia-do-joao`).
4. Cole `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN` e `ZAPI_CLIENT_TOKEN` quando pedir.
5. Copie a URL final que termina em `/<segredo>/mcp` (e guarde o `MCP_SECRET`).

## Webhook (para ler mensagens)
Enviar funciona sem webhook. Mas `listar_chats` traz os chats e `ler_mensagens`
só devolve o que o Worker capturou. Para capturar, aponte o webhook da Z-API
para esta URL (o mesmo `MCP_SECRET` do deploy):

```
https://<worker>.<subdominio>.workers.dev/<MCP_SECRET>/webhook
```

No painel da Z-API, abra a instância, menu "Webhooks", e cole essa URL no
evento **"Ao receber"** (on-message-received). O Worker grava cada mensagem no
D1, idempotente por `messageId` (não duplica em reentrega).

Há ainda um endpoint simples de disparo por HTTP (para Pluga/Zapier):
`POST /<MCP_SECRET>/enviar` com JSON `{telefone, mensagem}`.

## Como conectar no Claude
1. Abra as configurações de conectores do Claude.
2. Adicione um conector por URL e cole a URL do MCP (`/<segredo>/mcp`).
3. Teste pedindo "veja se meu WhatsApp está conectado" (chama `status_instancia`).

## Ferramentas (8)
- `status_instancia`: checa se o WhatsApp está conectado e pareado na instância.
- `buscar_contato`: acha contatos pelo nome (parcial). Retorna nome e telefone.
- `listar_chats`: lista conversas e grupos (mais recentes primeiro), filtra por nome e/ou só grupos. Devolve o `id` do chat para usar em `ler_mensagens`.
- `ler_mensagens`: lê o histórico de um chat/grupo pelo `id`, por dia (`data` YYYY-MM-DD) ou últimas N (`quantidade`). Só enxerga o que o webhook capturou.
- `enviar_texto`: envia texto para um número (DDI+DDD+número, só dígitos).
- `enviar_texto_para_contato`: busca contato pelo nome e envia; se houver mais de um, lista pra escolher em vez de enviar.
- `enviar_imagem`: envia imagem por URL pública, com legenda opcional.
- `enviar_documento`: envia documento/PDF por URL pública.

## Endpoints do Worker
- `GET /`: healthcheck público.
- `POST /<MCP_SECRET>/mcp`: endpoint MCP (é o que vai no Claude).
- `POST /<MCP_SECRET>/webhook`: recebe mensagens da Z-API e grava no D1.
- `POST|GET /<MCP_SECRET>/enviar`: disparo simples de texto por HTTP.

## Se der erro
- 404 ao conectar: a URL ou o segredo estão errados. Confira o `/<segredo>/mcp`.
- `ler_mensagens` volta vazio: o webhook não está apontado (ou só há mensagens a partir de quando foi ativado). Confira o passo do webhook.
- Erro "Banco D1 não configurado": o binding `DB` não subiu. Pelo botão é raro (ele provisiona sozinho); confira em Settings, Bindings, se existe um D1 chamado `DB`. No fluxo por terminal, faltou criar o D1 ou colar o `database_id` no wrangler.toml. A tabela em si o Worker cria sozinho na primeira escrita.
- Erro Z-API 401/403: `ZAPI_CLIENT_TOKEN` errado ou faltando (é o header `Client-Token`).
- Erro Z-API sobre instância: `ZAPI_INSTANCE_ID`/`ZAPI_INSTANCE_TOKEN` errados, ou a instância desconectou do celular (rode `status_instancia`).
- Logs: painel da Cloudflare, o Worker tem observability ligada.
