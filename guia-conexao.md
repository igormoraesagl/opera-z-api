# Guia rápido · conectar o WhatsApp (Z-API) no seu Claude (sem terminal)

Objetivo: ter o Claude enviando e lendo seu WhatsApp em menos de 20 minutos,
clicando, sem linha de comando. O conector sobe na SUA conta Cloudflare, então
suas conversas ficam com você, não passam por ninguém.

## Antes de começar
- Uma conta na Cloudflare (o plano grátis serve). Se não tem, crie em cloudflare.com, leva 2 minutos.
- Uma conta no GitHub (grátis). O botão guarda uma cópia do conector na sua mão.
- Uma instância da Z-API já criada e com o WhatsApp pareado (QR code lido).

## Passo 1 · Pegue suas credenciais da Z-API
No painel da Z-API, abra a sua instância:
1. `ZAPI_INSTANCE_ID`: o "ID da instância".
2. `ZAPI_INSTANCE_TOKEN`: o "Token da instância" (fica junto do ID).
3. `ZAPI_CLIENT_TOKEN`: o token de segurança da conta, no menu "Segurança" (nível conta, não da instância). É o header `Client-Token`.
4. Crie um segredo pra URL: invente um texto longo e aleatório, com 32 caracteres ou mais, sem espaços. O gerador de senha do seu navegador serve. Esse é o seu `MCP_SECRET`, a senha do conector. Guarde ele.

Guarde os quatro.

## Passo 2 · Clique no botão e deixe a Cloudflare montar
1. Abra o README do conector Z-API e clique no botão "Deploy to Cloudflare".
2. Autorize: o botão conecta sua conta GitHub e sua conta Cloudflare, guarda uma cópia do código na sua conta e cria o Worker na sua Cloudflare.
3. O botão também cria sozinho o banco de mensagens (D1) na sua conta. Você não cria banco nem cola id nenhum. A tabela das mensagens o próprio Worker cria na primeira mensagem que chegar.
4. Confirme o nome do Worker (pode deixar o sugerido) e siga. A Cloudflare publica sozinha, sem você digitar comando nenhum.

## Passo 3 · Cole as chaves no painel
1. No painel da Cloudflare, abra o Worker que subiu.
2. Vá em Settings, depois Variables and Secrets.
3. Adicione as 4 variáveis, cada uma como Secret: `MCP_SECRET`, `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN` e `ZAPI_CLIENT_TOKEN`, com os valores do Passo 1.
4. Salve. A Cloudflare republica o Worker com as chaves.

## Passo 4 · Aponte o webhook (pra conseguir ler mensagens)
Enviar já funciona. Pra o Claude LER conversas e resumir grupos, a Z-API
precisa mandar as mensagens novas pro seu Worker:
1. Ainda no painel da Cloudflare, copie a URL pública do Worker (algo como `https://zapi-whatsapp.seu-usuario.workers.dev`).
2. Monte a URL do webhook: essa base mais `/<seu MCP_SECRET>/webhook`. Fica: `https://zapi-whatsapp.seu-usuario.workers.dev/SEU_SEGREDO/webhook`.
3. No painel da Z-API, abra a instância, menu "Webhooks".
4. No evento "Ao receber" (on-message-received), cole a URL do webhook e salve.
5. A partir daí o Worker guarda as mensagens novas. Ele não recupera o que passou antes disso.

## Passo 5 · Conecte no Claude
1. Copie de novo a URL pública do Worker.
2. Acrescente no fim `/<seu MCP_SECRET>/mcp`. Fica: `https://zapi-whatsapp.seu-usuario.workers.dev/SEU_SEGREDO/mcp`.
3. Nas configurações de conectores do Claude, adicione um conector por URL e cole essa URL.
4. Peça "veja se meu WhatsApp está conectado" pra confirmar que está no ar.

## Se der erro
- Conector não responde: confira se colou a URL inteira, com o `/<segredo>/mcp` no fim, e se o segredo bate com o que você pôs em Settings.
- "Não autorizado" da Z-API: `ZAPI_CLIENT_TOKEN` errado ou faltando (é o header `Client-Token`). Confira e salve de novo em Settings, Variables.
- Erro sobre instância: `ZAPI_INSTANCE_ID` ou `ZAPI_INSTANCE_TOKEN` errados, ou a instância desconectou do celular. Peça "veja se meu WhatsApp está conectado".
- Ler mensagens volta vazio: o webhook não está apontado, ou você está pedindo um período anterior à captura. Confira o Passo 4.
- Erro "Banco D1 não configurado": o binding do banco não subiu. Pelo botão isso é raro. Abra o Worker em Settings, Bindings, e confira se existe um D1 chamado `DB`. Se não existir, reprovisione pelo botão ou crie um D1 no painel e ligue o binding `DB` a ele.
- A tabela não aparece no painel do D1: ela só nasce na primeira mensagem capturada. Mande uma mensagem de teste no WhatsApp com o webhook já apontado. Se quiser criar na mão, o `template/schema.sql` tem o SQL: no painel da Cloudflare, abra o banco D1, aba Console, cole o conteúdo do arquivo e rode.
- Prefere terminal? Existe um `template/deploy.sh` que faz o mesmo por linha de comando.

---
*Feito por Agências Lucrativas · Método AGL*
