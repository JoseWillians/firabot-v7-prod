# Firabot v7

Bot de WhatsApp em TypeScript para atendimento acadêmico do IFMA Santa Inês. Ele usa Baileys para conexão com WhatsApp, MySQL para estado/logs/documentos e menus guiados por números.

## Requisitos

- Node.js LTS
- npm ou yarn
- MySQL
- WhatsApp para leitura do QR Code

## Instalação

```bash
npm install
```

Crie o arquivo `.env` a partir do exemplo:

```bash
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Configuração

Variáveis principais:

- `BOT_NAME`: nome exibido pelo bot.
- `BOT_CAMPUS`: campus usado nas mensagens de saudação.
- `DOCUMENTS_DIR`: pasta base dos documentos.
- `IGNORE_OLD_MESSAGES`: ativa o filtro contra backlog de mensagens antigas.
- `IGNORE_GROUPS`: evita respostas em grupos.
- `DEBUG_MODE`: ativa logs detalhados quando `true`.
- `LOG_LEVEL`: nível de log esperado. Use `debug` para detalhes adicionais.
- `MESSAGE_START_GRACE_SECONDS`: tolerância para filtro de mensagens anteriores ao início.
- `SPAM_WINDOW_MS`: janela para evitar respostas repetidas ao mesmo usuário/texto.
- `RECONNECT_DELAY_MS`: atraso antes de tentar reconectar.
- `USER_STATE_TTL_MINUTES`: tempo de expiração do estado de conversa; `0` desativa a expiração.
- `DOCUMENT_MAX_SIZE_MB`: tamanho máximo de PDF para envio automático.
- `ADMIN_NUMBERS`: números autorizados para comandos administrativos, separados por vírgula e com DDI/DDD.
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`: conexão MySQL.
- `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`: opcionais para sobrescrever o MySQL local do `docker-compose.yml`.

## Banco de Dados

Para desenvolvimento no notebook, use o MySQL local via Docker. O banco remoto do IFMA existe, mas não deve ser usado nos testes locais.

```bash
docker compose up -d mysql
```

O `docker-compose.yml` sobe:

- container: `firabot-mysql`
- banco: `firabot`
- usuário: `firabot`
- senha local: `firabot123`
- porta local: `127.0.0.1:3306`
- schema inicial: `./database/schema.sql`

Acesse o MySQL local com:

```bash
docker exec -it firabot-mysql mysql -u firabot -p firabot
```

Senha:

```text
firabot123
```

Comandos úteis dentro do MySQL:

```sql
SHOW TABLES;
SELECT * FROM docs;
DESCRIBE docs;
```

Tabelas usadas:

- `users`: usuários identificados pelo JID/número.
- `user_states`: estado atual de navegação.
- `logs`: histórico simples de eventos.
- `docs`: documentos ativos carregados no menu de documentos.
- `important_links`: links importantes administráveis pelo painel.
- `notices`: editais administráveis pelo painel enquanto não houver sincronização automática.
- `sectors`, `admin_roles`, `admin_users`, `admin_user_sectors`, `admin_audit_logs`: base inicial para o painel administrativo e RBAC por setor.

Para produção, use outro `.env` apontando para o servidor do IFMA. Não misture credenciais remotas com o `.env` local de desenvolvimento.

### Documentos

Na tabela `docs`, a coluna `name` é o rótulo exibido ao usuário no WhatsApp e deve manter acentos. A coluna `path` é apenas o caminho físico do arquivo PDF e deve evitar acentos para reduzir problemas de encoding entre Windows, Docker, MySQL e WhatsApp.

Os menus de documentos são dinâmicos por categoria. Um PDF cadastrado no painel com `category_code = cae` aparece em `Documentos > Documentos CAE`; com `category_code = drca`, aparece em `Documentos > Documentos DRCA`. O caminho salvo no banco é relativo, por exemplo `./documentos/cae/nome-do-arquivo.pdf`, e o bot resolve esse caminho dentro de `DOCUMENTS_DIR` no servidor.

Exemplo esperado:

```sql
SELECT id, name, path FROM docs ORDER BY id;
```

Arquivos esperados em `documentos/drca`:

```text
requerimento-academico.pdf
requerimento-diploma-tecnico.pdf
requerimento-superior.pdf
termo-de-desistencia.pdf
```

Para conferir no PowerShell:

```powershell
Get-ChildItem documentos\drca
```

## src/ e dist/

- `src/` é o código-fonte oficial em TypeScript.
- `dist/` é gerado automaticamente por `npm run build`.
- Não edite arquivos dentro de `dist/` manualmente.
- Toda mudança deve ser feita em `src/` e depois compilada.
- `dist/` fica fora do versionamento pelo `.gitignore`, salvo se houver uma decisão explícita de distribuir build pronto.

## Execução Local

Desenvolvimento:

```bash
npm run dev
```

Use `npm run dev` em desenvolvimento. Não use `npm restart dev`; esse comando não representa o fluxo do projeto.

Build:

```bash
npm run build
```

Produção local:

```bash
npm run build
npm start
```

Testes:

```bash
npm test
```

Teste sem recompilar, útil depois de um `npm run build` já validado:

```bash
npm run test:no-build
```

Validação local equivalente ao CI:

```bash
npm run ci:local
```

## Estratégia de Logs

O Firabot usa uma estratégia híbrida:

- logs técnicos vão para console/stdout em formato JSON simples;
- eventos importantes do atendimento vão para a tabela `logs` no MySQL;
- arquivos `.md` documentam decisões e mudanças;
- arquivos `.txt` não são usados como armazenamento principal de logs.

Os logs técnicos mascaram telefone e removem campos sensíveis como senha, token e QR Code. Eventos do banco guardam apenas preview e metadados úteis, como tipo de evento, estado anterior, estado posterior, comando, menu, documento e sucesso.

## Docker

Build da imagem:

```bash
docker build -t firabot-v7 .
```

Execução:

```bash
docker run --env-file .env -v ./auth:/app/auth -v ./documentos:/app/documentos firabot-v7
```

A imagem de produção roda como usuário `node` e não copia `.env` nem `auth/`. Mantenha `auth/` como volume persistente e restrito; em Linux, ajuste permissões do volume se o container não conseguir gravar a sessão do Baileys. O MySQL do Compose fica publicado apenas em `127.0.0.1` para evitar exposição acidental na rede.

## Comandos

- `oi`, `olá`, `bom dia`, `boa tarde`, `boa noite`, `menu`, `iniciar`, `início`, `começar`, `ajuda`, `help`, `start`: iniciam atendimento sem prefixo.
- `!help`: lista comandos técnicos disponíveis para o usuário atual.
- `!ping`: verifica se o bot está ativo. Restrito a `ADMIN_NUMBERS`.
- `!status`: mostra status de WhatsApp, banco, inicialização, ambiente, documentos ativos, documentos encontrados/ausentes e debug. Restrito a `ADMIN_NUMBERS`.
- `!ifma`: mostra informações úteis do campus.
- `encerrar`: encerra atendimento em fluxos de conversa.
- `!encerrar`: encerra atendimento como comando técnico compatível.

Menu principal atual:

- `1 - Biblioteca`
- `2 - Documentos`
- `3 - PPC do Curso`
- `4 - Links Importantes`
- `5 - Editais Abertos`
- `6 - RU`
- `7 - Suporte`

O menu principal não exibe `0 - Voltar`. A opção `0` vale apenas dentro de submenus ou telas de continuidade.

Links importantes e editais são carregados preferencialmente das tabelas `important_links` e `notices`. As listas locais continuam como fallback quando o banco está vazio ou indisponível.

## Testes e Qualidade

O comando `npm test` executa `npm run build` e depois `npm run test:no-build`, que roda testes com `node:assert` sobre serviços, menus, estados, sanitização de logs, proteção de paths de documentos e socket fake. O comando `npm run test:no-build` reaproveita o `dist/` existente e não recompila, então use-o apenas depois de gerar um build confiável. Ele ainda não substitui testes de integração com WhatsApp/Baileys real, MySQL real em fluxo completo ou envio real de mídia.

Casos manuais importantes:

- `7` abre suporte; uma matrícula ou protocolo numérico deve ser registrado como mensagem de suporte.
- Documento ausente ou caminho inválido deve orientar o usuário e não registrar `DOCUMENT_SENT`.
- `!status` deve mostrar a saúde geral dos documentos ativos, incluindo PPCs.

## Estrutura

- `src/index.ts`: entrada da aplicação.
- `src/connection.ts`: conexão com WhatsApp, QR Code e reconexão.
- `src/middlewares/messageHandler.ts`: orquestra o processamento das mensagens.
- `src/commands`: comandos com prefixo `!`.
- `src/menus`: definições declarativas de menus.
- `src/services`: regras de negócio, documentos, estado, logs e proteções.
- `src/functions/database.ts`: acesso MySQL.
- `documentos`: PDFs enviados pelo bot.
- `auth`: credenciais locais do Baileys.

## Documentação Estratégica

- `docs/RELATORIO_ESTRATEGICO.md`: visão técnica aprovada, riscos, melhorias futuras e decisão de deixar Java para uma fase bem futura.
- `docs/SUBAGENTES_FIXOS.md`: cinco frentes fixas de trabalho para organizar próximas tarefas, responsabilidades e skills.
- `docs/PLANO_PAINEL_ADMIN.md`: plano prioritário do painel administrativo antes da IA.
- `docs/PLANO_IA_INTELIGENTE.md`: plano futuro para IA em Python como serviço separado, desacoplado do core TypeScript do WhatsApp.
- `docs/REGISTRO_DE_MUDANCAS.md`: histórico consolidado de mudanças e decisões.

## Fluxo de Estado

O bot consulta o estado do usuário antes de interpretar opções numéricas. Assim, depois de escolher `2 - Documentos`, a próxima opção escolhe entre `1 - Documentos DRCA` e `2 - Documentos CAE`. Dentro de `Documentos DRCA`, a opção `3` envia `Requerimento Superior`, em vez de abrir o menu de PPC do curso.

No fluxo `3 - PPC do Curso`, o bot primeiro lista cursos e depois mostra os PPCs disponíveis daquele curso. Os PDFs ficam organizados em subpastas dentro de `documentos/ppc`.

Depois de enviar um documento, o bot mostra uma continuação contextual com as outras opções do mesmo submenu, além de `0 - Voltar ao Menu Principal` e `encerrar - Terminar conversa`.

No fluxo `7 - Suporte`, enquanto o painel administrativo e os responsáveis setoriais ainda não existem, o bot pede que o usuário envie sua dúvida em uma mensagem. Após registrar a mensagem, ele pergunta se o usuário deseja voltar ao menu principal ou encerrar.

No fluxo `5 - Editais Abertos`, o bot lista até 10 editais em andamento da página oficial de processos seletivos do IFMA e, na sequência, mostra as opções para voltar ao menu principal ou encerrar.

## Solução de Problemas

- QR Code aparece repetidamente: apague a sessão em `auth` apenas se quiser parear novamente.
- Bot não responde: confira se `IGNORE_GROUPS=true` está bloqueando mensagens de grupo e se a mensagem não é anterior ao início do bot.
- Documentos não enviam: verifique se o caminho cadastrado em `docs.path` existe dentro do projeto ou container.
- Estado parece errado: confira a tabela `user_states`, o valor de `USER_STATE_TTL_MINUTES` e os logs do console; falhas de banco agora são registradas claramente.
- Docker não encontra PDFs: monte `./documentos:/app/documentos` ou garanta que a pasta foi copiada para a imagem.
- Erro de configuração ao iniciar: confira `DB_HOST`, `DB_USER` e `DB_NAME` no `.env`.
- Banco indisponível: confirme `docker compose up -d mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306` e as credenciais locais.

## Testes Manuais Recomendados

1. Reinicie o bot e confirme que ele não manda boas-vindas sozinho.
2. Depois do restart, envie `oi` ou `menu` e confirme saudação + menu principal.
3. Envie `2` e confirme abertura do submenu `Documentos DRCA` / `Documentos CAE`.
4. Envie `1` e confirme abertura dos documentos DRCA.
5. Envie `1`, `2`, `3` e `4` dentro de DRCA e confirme o envio dos quatro PDFs.
6. Envie `3` dentro de DRCA e confirme especificamente o envio de `Requerimento Superior`.
7. Envie `0` e confirme retorno ao menu principal.
8. Envie `3`, escolha cada curso disponível e confirme abertura do submenu de PPCs.
9. Escolha um PPC e confirme envio do PDF, resumo e lista das outras opções do mesmo submenu.
10. Envie `oi` em qualquer estado e confirme reset para `main`.
11. Com um número listado em `ADMIN_NUMBERS`, envie `!ping`, `!help` e `!status`; com outro número, confirme que `!ping` e `!status` são negados.
12. Envie `4`, confirme o link direto do Login SUAP, depois `0`, e confirme retorno ao menu principal.
13. Envie `5`, confira a lista de editais do IFMA, depois `encerrar`, e confirme encerramento do atendimento.
14. Envie `7`, mande uma mensagem de suporte, depois envie `0` ou `encerrar`.

## Observações Sobre WhatsApp/Baileys

O Baileys usa arquivos de sessão na pasta `auth`. Esses arquivos mudam com frequência e devem ser tratados como credenciais locais. Em produção, prefira usar volume persistente e evitar versionar esses arquivos.
