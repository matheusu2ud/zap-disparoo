# ZapFlow

Painel web para gerenciamento de campanhas WhatsApp, desenvolvido com Next.js,
React, TypeScript, Tailwind CSS e Lucide React.

## Requisitos

- Node.js 20.9 ou superior
- npm

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

## Fase atual

A Fase 1 entrega a base do projeto e a interface responsiva do painel. A Fase 2
adiciona cadastro, login, recuperação de senha e sessão com Supabase Auth. A
Fase 3 adiciona o esquema inicial PostgreSQL, isolamento por usuário com RLS e
políticas de banco para consentimento e opt-out. A Fase 4 conecta o dashboard a
contatos, campanhas, mensagens, conexões e assinatura real do usuário. A Fase 5
adiciona cadastro, edição, exclusão, pesquisa, paginação, etiquetas e importação
e exportação CSV de contatos, protegidos pela sessão e políticas RLS.
A Fase 6 adiciona gerenciamento de conexões WhatsApp pela Evolution API, com
reserva limitada pelo plano, QR Code temporário, consulta de status,
desconexão, exclusão e webhook autenticado.
A Fase 7 adiciona criação, edição, busca e exclusão de templates, além de uma
biblioteca privada de mídia com envio e remoção de arquivos.
A Fase 8 adiciona criação de rascunhos de campanha, seleção de contatos com
consentimento ativo, associação de conexão e mídia e agendamento controlado
para a fila.
A Fase 9 adiciona uma área administrativa para gerenciar planos, atribuir
assinaturas e ativar ou desativar contas de usuário.
A Fase 10 adiciona o processamento conservador da fila de campanhas, relatórios
diários dos últimos 30 dias e testes unitários dos utilitários do worker.
A Fase 11 integra a cobrança mensal via Pix pela PoseidonPay e consulta seu
status para ativar ou encerrar o plano após confirmação.
A Fase 12 mostra as vantagens dos três planos no primeiro acesso e bloqueia o
painel até o usuário escolher um; o Grátis é ativado imediatamente e os pagos
somente depois da confirmação do Pix.
A página pública `/planos` compara as assinaturas antes do cadastro e mantém
o plano escolhido durante o cadastro e a confirmação de e-mail.
A página inicial (`/`) exibe os três planos. Depois da escolha, o painel fica
disponível em `/painel`.
A etapa de pagamento solicita nome, e-mail da conta e CPF; o CPF é salvo no
perfil de forma restrita no servidor. Os pagamentos Pix exibem o QR Code gerado
localmente no navegador e também mantêm o código copia e cola.

## Configuração do Supabase Auth

1. Crie um projeto no Supabase.
2. Copie `.env.example` para `.env.local`.
3. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` com os
   valores do projeto Supabase. `SUPABASE_SERVICE_ROLE_KEY` só será necessária
   para operações confiáveis no servidor e nunca deve ser exposta no navegador.
4. No painel Supabase, habilite autenticação por e-mail e configure os URLs de
   redirecionamento para o endereço local (`http://localhost:3000/auth/callback`)
   e para os domínios usados em produção.
5. Reinicie o servidor local depois de alterar variáveis de ambiente.

O acesso ao painel exige uma sessão válida. Sem as variáveis do Supabase, as
rotas de autenticação mostram uma mensagem de configuração e não simulam login.
Somente a chave anon/public deve ser usada no navegador. A chave
`SUPABASE_SERVICE_ROLE_KEY` é usada exclusivamente no servidor pelas operações
confiáveis de conexão WhatsApp e nunca é enviada ao navegador.

## Banco de dados e permissões

A migration
[`supabase/migrations/20261106000000_initial_schema.sql`](./supabase/migrations/20261106000000_initial_schema.sql)
cria perfis, planos, assinaturas, contatos, tags, conexões, campanhas e
destinatários, logs, templates, mídia, eventos de webhook, uso, auditoria e
configurações. Ela também cria um bucket privado para mídia e habilita RLS nas
tabelas da aplicação. A migration
[`supabase/migrations/20261106010000_dashboard_failed_at.sql`](./supabase/migrations/20261106010000_dashboard_failed_at.sql)
adiciona o horário de falha usado nas estatísticas recentes.
A migration
[`supabase/migrations/20261106020000_evolution_connections.sql`](./supabase/migrations/20261106020000_evolution_connections.sql)
adiciona o nome da instância do provedor, restringe escritas diretas nas
conexões e cria uma reserva atômica que verifica o plano e o limite antes da
criação. A página de conexões exige uma assinatura vigente; configure um plano
e assinatura ativos para a conta antes de testar a criação.
A migration
[`supabase/migrations/20261106030000_templates_media.sql`](./supabase/migrations/20261106030000_templates_media.sql)
mantém privado o bucket de mídia e define o limite de 10 MB e os tipos
permitidos.
A migration
[`supabase/migrations/20261106040000_campaign_queue.sql`](./supabase/migrations/20261106040000_campaign_queue.sql)
adiciona RPCs para agendar e cancelar campanhas. O agendamento confere conexão
ativa e reconfirma o consentimento e o telefone de todos os destinatários.
A migration
[`supabase/migrations/20261106050000_admin_subscription_management.sql`](./supabase/migrations/20261106050000_admin_subscription_management.sql)
adiciona a atribuição transacional de assinaturas, disponível apenas para um
administrador ativo.
A migration
[`supabase/migrations/20261106100000_poseidonpay_pix_billing.sql`](./supabase/migrations/20261106100000_poseidonpay_pix_billing.sql)
armazena as cobranças Pix e restringe leitura ao proprietário; gravações são
feitas pelo servidor com `service_role`.
A migration
[`supabase/migrations/20261106150000_poseidonpay_subscription_status.sql`](./supabase/migrations/20261106150000_poseidonpay_subscription_status.sql)
armazena a vinculação da assinatura e aplica a confirmação/cancelamento de
forma transacional, acessível somente ao servidor confiável.
A migration
[`supabase/migrations/20261106210000_seed_broadcast_hub_plans.sql`](./supabase/migrations/20261106210000_seed_broadcast_hub_plans.sql)
cria os planos Grátis, Essencial e Profissional com preços de R$ 0, R$ 10 e
R$ 19,99 e aplica limites de contatos, campanhas mensais e armazenamento. Os planos ficam identificados com o prefixo
`BROADCAST HUB -` para não se misturarem a planos de outros sistemas no mesmo
projeto Supabase. Os planos pagos são mensais e a assinatura gratuita não gera
cobrança Pix. O usuário precisa escolher um plano para liberar o painel; contas
que já tinham recebido o plano grátis automaticamente também precisam confirmar
essa escolha.
A migration
[`supabase/migrations/20261106213500_require_plan_selection.sql`](./supabase/migrations/20261106213500_require_plan_selection.sql)
remove a atribuição automática do plano grátis, cria a ativação explícita do
Grátis e bloqueia o acesso ao painel até existir uma assinatura BROADCAST HUB
selecionada e vigente. Planos pagos só liberam o acesso após confirmação da
PoseidonPay.
A migration
[`supabase/migrations/20261106220000_billing_customer_cpf.sql`](./supabase/migrations/20261106220000_billing_customer_cpf.sql)
adiciona o CPF ao perfil e preenche o campo com o valor validado recebido no
cadastro, sem conceder permissão de escrita direta a usuários autenticados.
A migration
[`supabase/migrations/20261106222000_idempotent_free_plan_selection.sql`](./supabase/migrations/20261106222000_idempotent_free_plan_selection.sql)
torna a ativação do plano Grátis repetível para quem já o possui e evita
alterar um plano pago enquanto sua recorrência PoseidonPay ainda está ativa.

Contatos podem ser importados de CSV ou Excel (`.xlsx`) e exportados em CSV. A
primeira aba ou o CSV deve conter as colunas `nome` e `telefone`; `email` e
`observacoes` são opcionais. Cada arquivo pode ter até 500 linhas e 2 MB; linhas
duplicadas são ignoradas. Todos os contatos importados começam sem consentimento
de envio. A lista também oferece etiquetas e histórico dos destinatários de
campanha já registrados.

Para aplicar em um projeto Supabase conectado à CLI:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Para testar localmente, com Docker e Supabase CLI instalados:

```bash
npx supabase start
npx supabase db reset
npx supabase stop
```

O cadastro cria automaticamente um perfil com papel `user`. Para promover o
primeiro administrador, faça login com a conta que deverá ser administradora,
localize o UUID em **Authentication → Users** e execute no SQL Editor do
Supabase, substituindo o UUID:

```sql
update public.profiles
set role = 'admin'
where id = 'UUID-DO-USUARIO';
```

Faça essa promoção apenas por uma sessão administrativa confiável. RLS limita
usuários às próprias linhas; planos ativos são somente leitura para visitantes;
alterações de planos e permissões exigem papel de administrador. Logs,
contadores de uso, eventos de webhook e estados de mensagens são graváveis
apenas pelo backend confiável (por exemplo, usando `service_role` no servidor,
nunca no navegador). A migration não armazena chaves privadas da Evolution API
nas tabelas expostas ao cliente.

Ao inserir destinatários, a política do banco exige contato com consentimento
registrado e sem opt-out, além de campanha em rascunho. Um opt-out registrado
não pode ser removido pelo usuário comum. A escrita/alteração de consentimento
é reservada a uma ação confiável no servidor ou a um administrador; cadastro de
contato pelo cliente começa sem consentimento. O processador de filas revalida
consentimento imediatamente antes do envio. As políticas de cliente exigem que
o telefone do destinatário corresponda ao contato consentido e não permitem
alterar status de destinatário nem logs de mensagem.

## Biblioteca de templates e mídia (Fase 7)

Acesse **Templates** para criar, buscar, editar e excluir mensagens
reutilizáveis. Cada template tem nome, categoria e conteúdo de até 5.000
caracteres.

Acesse **Mídia** para enviar e remover arquivos privados. São aceitos JPG, PNG,
WebP, PDF e MP4, com até 10 MB por arquivo. O servidor verifica a assinatura
dos formatos antes do envio; SVG e outros formatos executáveis não são aceitos.
Os arquivos ficam no bucket privado `broadcast-media`, isolados por usuário
com RLS e exibidos por links assinados temporários. O limite do corpo das Server
Actions foi configurado para permitir uploads de até 10 MB.
Para usar uma foto ou vídeo numa campanha, envie o arquivo nessa biblioteca e
selecione-o no campo **Mídia** ao criar o rascunho. O worker envia a mídia pela
Evolution junto com o texto da campanha.

## Campanhas e fila (Fase 8)

Acesse `/campaigns` para criar rascunhos com uma mensagem, um template opcional,
mídia opcional, uma conexão WhatsApp e até 500 contatos autorizados. O sistema
valida novamente a autorização ao montar a fila e ao agendar. Rascunhos podem
ser excluídos; campanhas agendadas podem ser canceladas.

O envio é realizado apenas pelo worker da Fase 10 quando ele estiver
explicitamente configurado. Colocar uma campanha na fila, por si só, não envia
mensagens nem comprova entrega. O envio real também depende de as migrations
estarem aplicadas no Supabase, da Evolution API estar configurada e de um
agendador chamar periodicamente a rota do worker.

## Planos e administração (Fase 9)

Acesse `/admin` com uma conta cujo perfil tenha `role = 'admin'`. A área permite
criar e atualizar planos, definir limites e recursos ilimitados, ativar ou
desativar contas e atribuir uma assinatura a um usuário. A atribuição encerra a
assinatura anterior de forma transacional. Usuários comuns não podem acessar
essa tela nem executar suas ações; as operações também são protegidas por RLS
ou por funções SQL que verificam o papel administrativo no banco.

Para criar o primeiro administrador, faça login com a conta que deverá ser
administradora, localize o UUID em **Authentication → Users** e execute uma vez
no SQL Editor do Supabase, substituindo o UUID:

```sql
update public.profiles
set role = 'admin'
where id = 'UUID-DO-USUARIO';
```

Faça essa promoção apenas por uma sessão administrativa confiável. A própria
interface impede que o administrador desative sua conta atual. A aplicação não
processa pagamentos; planos e assinaturas são gerenciados manualmente nesta
etapa.

## Conexões WhatsApp (Fase 6)

Além das variáveis do Supabase, preencha no `.env.local`:

```env
EVOLUTION_API_URL=https://seu-servidor-evolution
EVOLUTION_API_KEY=sua-chave-do-servidor
EVOLUTION_WEBHOOK_SECRET=um-segredo-aleatorio-longo
```

`SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_KEY` e
`EVOLUTION_WEBHOOK_SECRET` são apenas para o servidor; nunca use prefixo
`NEXT_PUBLIC_` nelas. Reinicie o Next.js após alterar as variáveis. A instância
Evolution deve estar acessível pelo servidor da aplicação. Em produção, use
HTTPS para a API.

Configure no painel Evolution um webhook `POST` para
`https://SEU-DOMINIO/api/webhooks/evolution`, enviando o segredo configurado em
`EVOLUTION_WEBHOOK_SECRET` no cabeçalho `x-evolution-secret` (ou como
`Authorization: Bearer ...`). Use um segredo aleatório com pelo menos 32 bytes e
habilite eventos de atualização de conexão.
O endpoint valida o segredo, limita o corpo a 32 KB e aceita apenas eventos de
estado reconhecidos. Webhooks sem segredo válido não atualizam conexões.

O código QR é temporário e enviado ao navegador apenas para o proprietário da
conexão; ele não é salvo no banco nem em logs. A criação e cada operação remota
usam a API Evolution no servidor. Verifique a versão da Evolution API instalada
e seus endpoints/configuração de webhook: os caminhos e métodos usados pela
integração seguem o contrato comum da API e podem exigir ajuste conforme a
versão ou configuração do seu provedor. A Evolution API e a sessão WhatsApp
dependem de serviços externos; a conexão pode expirar ou ser encerrada pelo
provedor. Respeite os termos do WhatsApp e obtenha consentimento antes de
qualquer envio. O processamento de campanhas e os relatórios estão descritos na
seção seguinte. A Evolution API e a sessão WhatsApp dependem de serviços
externos; endpoints e formatos de resposta podem variar por versão.

## Comandos

- `npm run dev` — servidor local de desenvolvimento.
- `npm run lint` — análise estática com ESLint.
- `npm test` — testes unitários dos utilitários do worker.
- `npm run build` — compilação de produção.

## Worker de campanhas e relatórios (Fase 10)

Acesse `/reports` para consultar totais diários de envios, entregas, leituras,
falhas e itens ainda na fila, além das campanhas recentes. Os totais de
entregues/lidas dependem de eventos que atualizem os respectivos campos no
banco; o worker registra a confirmação de envio aceita pela Evolution, não a
entrega ao destinatário.

O envio fica desativado por padrão. Para habilitá-lo, configure no ambiente do
servidor:

```env
CAMPAIGN_WORKER_SECRET=um-segredo-aleatorio-de-pelo-menos-32-bytes
CAMPAIGN_SEND_ENABLED=true
```

Gere um segredo exclusivo e forte (por exemplo, `node -e
"console.log(require('node:crypto').randomBytes(32).toString('hex'))"`), mantenha-o
somente no servidor e nunca o exponha em código do navegador ou logs. A rota
`POST /api/workers/campaigns` deve ser acionada por um cron/worker confiável,
usando `Authorization: Bearer <CAMPAIGN_WORKER_SECRET>`. Cada chamada processa
no máximo um destinatário; após um envio aceito, há um intervalo mínimo de
cinco segundos antes da próxima reivindicação. Configure o agendador para
acionar periodicamente e monitore respostas não-2xx. A rota é pública no proxy,
mas exige o segredo antes de acessar o banco.

O processamento revalida conta, conexão e consentimento imediatamente antes da
chamada ao provedor, respeita o limite mensal do plano e permite apenas uma
tentativa por destinatário. Não há retry automático: falhas ou resultados
ambíguos exigem revisão manual, pois o provedor pode ter aceitado uma mensagem
mesmo que a resposta não tenha chegado. Um worker interrompido durante envio é
marcado como resultado desconhecido e não é reenviado.

Antes de habilitar envios, configure Supabase e Evolution, revise as permissões
e aplique todas as migrations com `npx supabase db push`. A migration da Fase
10 ainda precisa ser validada no seu projeto Supabase; o worker não foi
verificado contra uma instância Evolution real. Não ative a variável até
confirmar a configuração e as obrigações de consentimento aplicáveis.

## Cobrança Pix PoseidonPay (Fase 11)

Para habilitar a criação de cobranças, configure no `.env.local` as chaves
fornecidas pela PoseidonPay:

```env
POSEIDONPAY_PUBLIC_KEY=sua_chave_publica
POSEIDONPAY_SECRET_KEY=sua_chave_secreta
```

As duas chaves são usadas somente pelo servidor; nunca adicione `NEXT_PUBLIC_`
nem as publique. Acesse `/billing`, escolha um plano ativo com preço em BRL e
gere o Pix mensal. O telefone do cliente é opcional. O pedido usa um
identificador único da aplicação e cada usuário pode ter apenas uma cobrança em
aberto por vez; uma resposta ambígua do provedor bloqueia novas tentativas até
conferência manual para evitar cobranças duplicadas.

Depois de pagar, use **Já paguei — verificar na PoseidonPay**. O servidor
consulta o endpoint oficial de assinaturas usando o `subscriptionId`, o
identificador único do cliente; só ativa o plano se a resposta confirmar
`ACTIVE`, o produto corresponder ao plano comprado e a periodicidade for mensal
(1 mês). `INACTIVE` mantém o acesso bloqueado; `CANCELED` encerra o acesso
vinculado àquela cobrança. Respostas inválidas ou incompatíveis exigem revisão
manual. As verificações são limitadas a uma a cada 10 segundos por cobrança.

Esta é uma consulta iniciada pelo usuário, não um webhook: a confirmação e a
detecção de cancelamentos ocorrem quando alguém verifica o status na página
`/billing`. Até configurar um webhook oficial ou um agendador de sincronização,
cancelamentos no gateway não são refletidos no app em tempo real. A documentação
fornecida não descreve a autenticação de webhooks, então nenhum callback público
é criado ou confiado.

Antes de usar em produção, aplique as migrations, configure as credenciais e
teste com cobrança de baixo valor. A integração não envia `callbackUrl`, pois
ainda não há um contrato documentado de webhook.

## Segurança e envio de mensagens

As credenciais da Evolution API, PoseidonPay e worker são lidas exclusivamente
de variáveis de ambiente no servidor. O envio respeita o limite mensal do plano,
mas um plano comercial ilimitado não significa velocidade ou capacidade técnica
ilimitada. Obtenha consentimento antes de qualquer mensagem e respeite os termos
do WhatsApp e as leis aplicáveis.
