# WhatsApp (Z-API) · conector do OPERA

Liga o **WhatsApp (Z-API)** ao Claude. Depois de instalado, você pergunta em português e
o Claude responde olhando o dado real: envio de mensagem e leitura de conversa.

## Instalar em um clique

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/igormoraesagl/opera-z-api)

O botão publica este conector **na sua conta Cloudflare**. O código é este aqui,
aberto, e você pode ler tudo antes de clicar.

## Onde o seu dado fica

Na sua conta. Sempre.

O conector roda na SUA Cloudflare, com as SUAS chaves, cadastradas por VOCÊ.
Nem nós nem ninguém tem acesso. Não existe servidor central no meio: o Claude
fala direto com o seu Worker, e o seu Worker fala direto com o WhatsApp (Z-API).

## Depois de clicar no botão

1. Autorize a Cloudflare (ela conecta no GitHub e cria o Worker na sua conta).
2. No painel da Cloudflare, abra o Worker, vá em **Settings → Variables and Secrets**
   e cadastre as chaves listadas no `.dev.vars.example`. Cadastre cada uma como
   **Secret**, nunca como texto normal.
3. Copie a URL do Worker e acrescente `/SEU_MCP_SECRET/mcp` no fim.
4. Cole essa URL nas configurações de conectores do Claude.

O passo a passo com print está no [guia-conexao.md](guia-conexao.md).

## O MCP_SECRET

É uma senha que você inventa (32 caracteres aleatórios servem). Ela vira parte
da URL do seu conector e é o que impede um estranho de usar o seu Worker.
Trate como senha: não poste em print, não mande em grupo.

## Como saber se precisa atualizar

Abra a URL do seu Worker no navegador (a raiz, sem `/mcp`). Ela responde a versão que você está rodando e avisa se sair uma nova. A checagem lê só o número de versão aqui do GitHub. **Nada do seu dado é enviado pra ninguém.** Pra atualizar, clique de novo no botão **Deploy to Cloudflare** acima: ele republica com o código mais recente, mantendo as suas chaves.

---
*Parte do [OPERA](https://github.com/igormoraesagl), o sistema operacional da agência rodando dentro do Claude.*
*Feito por Agências Lucrativas · Método AGL*
