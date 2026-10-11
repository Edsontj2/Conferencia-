# EscalaBus

Sistema para gerar e administrar as escalas de **motoristas e cobradores aos sábados e domingos**: cadastros, sorteio equilibrado com todas as regras de alternância, edição com trocas atômicas, confirmação transacional, histórico, relatório A4 (impressão/PDF), envio pelo WhatsApp (wa.me), backup e PWA instalável com consulta offline.

* Frontend: React 19 + TypeScript (Vite), PWA (manifest, ícones, service worker).
* Backend: Node.js + Express 5 + TypeScript.
* Banco: **SQLite** persistente em arquivo, com migrations SQL.
* Regras e sorteio em `shared/`, usados **no navegador e no servidor**.

Arquitetura, modelo de dados e algoritmo: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## 1. Instalação

Requisitos: **Node.js 20 ou superior** (testado com 22) e npm. Em Linux sem binário pré-compilado do SQLite, o npm compila o `better-sqlite3` (precisa de `python3`, `make` e `g++`).

```bash
cd escalabus
npm install
cp .env.example .env
# edite .env e defina ADMIN_PASSWORD (mínimo 8 caracteres)
npm run build        # checagem de tipos + build do frontend/PWA
npm start            # http://localhost:3000
```

Na primeira execução, o servidor aplica as migrations, cria `data/escalabus.db` (dados reais), `data/escalabus-demo.db` (demonstração) e o administrador definido no `.env`. Depois de entrar, troque a senha em **Configurações** (ou rode `npm run create-admin`, que também serve para redefinir a senha ou criar outro administrador).

### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Desenvolvimento: API em :3000 (recarrega) + Vite em :5173 com proxy `/api` |
| `npm run build` | Typecheck do cliente e servidor + build de produção em `dist/` |
| `npm start` | Produção: um processo serve API e frontend na porta `PORT` |
| `npm test` | Testes automatizados (regras, sorteio, API, WhatsApp, datas) |
| `npm run migrate` | Aplica migrations pendentes nos dois bancos |
| `npm run create-admin` | Cria/redefine administrador (interativo) |
| `npm run demo:reset` | Recria os dados fictícios da demonstração |
| `npm run icons` | Regera os ícones PNG da PWA |

### Variáveis de ambiente (`.env.example`)

`PORT`, `HOST`, `DATA_DIR` (pasta dos bancos e cópias automáticas), `ADMIN_USERNAME`, `ADMIN_PASSWORD` (usado só se não houver administrador), `COOKIE_SECURE` (`true` em produção com HTTPS).

---

## 2. Uso rápido

1. **Cadastros:** Pessoas → Linhas → Ônibus → **Serviços** (cada serviço de sábado/domingo é uma vaga de motorista + cobrador e serve de modelo para todos os fins de semana).
2. **Histórico inicial:** na tela Escala, volte ao fim de semana anterior (◀), clique **"Escala em branco (histórico)"**, adicione os serviços que realmente aconteceram, salve e **confirme**. Sem isso, o sistema avisa que não consegue verificar a alternância — ausência de histórico **não** é tratada como "ninguém trabalhou".
3. **Escala do fim de semana:** escolha o sábado (o domingo é calculado), clique **"Gerar escala aleatória"**. A proposta mostra vagas abertas e as causas. Salve como rascunho, edite se necessário e **confirme** (o servidor revalida tudo numa transação).
4. **Edição:** "Editar rascunho" ou **"Editar escala confirmada"** (exige motivo, fica no Registro de alterações). Em cada vaga: editar todos os campos, **Trocar** (motoristas, cobradores, linhas ou ônibus entre duas vagas, de forma atômica), remover; e "+ Adicionar serviço".
5. **Relatório:** sábado, domingo ou ambos; versão detalhada com placa; **Imprimir**, **Baixar PDF (A4)**, **Compartilhar PDF** (quando o aparelho permite), **Enviar pelo WhatsApp** e **Envio individual**.
6. **Configurações:** nome da empresa, limite de serviços por pessoa/dia, destinatários do WhatsApp, backup (exportar/validar/importar), modo demonstração, senha, instalação do app.

---

## 3. Acesso pelo celular e instalação da PWA

**Na mesma rede (teste):** rode `npm start` num computador, descubra o IP dele (ex.: `192.168.0.10`) e abra `http://192.168.0.10:3000` no celular. Funciona para usar o sistema, mas **sem HTTPS o navegador não instala a PWA nem ativa o modo offline** (exceto em `localhost`). Para uso real, publique com HTTPS (seção 4).

**Android (Chrome/Edge):** abra o endereço HTTPS → botão **"⬇ Instalar"** no topo (ou menu ⋮ → *Instalar aplicativo*).

**iPhone/iPad:** abra no **Safari** → botão **Compartilhar** → **Adicionar à Tela de Início** → **Adicionar**. O app mostra essas instruções no botão "Instalar" e em Configurações.

**Offline:** a última escala aberta (e o relatório dela), os cadastros e o histórico já consultados ficam disponíveis sem internet. Uma faixa vermelha indica "OFFLINE" e todos os botões de alteração ficam bloqueados. Ao reconectar, o app detecta sozinho.

Todos os dispositivos que acessam o **mesmo servidor** veem os mesmos dados.

---

## 4. Hospedagem com HTTPS

Qualquer servidor Linux com Node 20+ (VPS, máquina na empresa). Exemplo com **Caddy** (certificado Let's Encrypt automático):

```caddyfile
escala.suaempresa.com.br {
    reverse_proxy 127.0.0.1:3000
}
```

`.env` em produção:

```env
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/escalabus
COOKIE_SECURE=true
```

Serviço **systemd** (`/etc/systemd/system/escalabus.service`):

```ini
[Unit]
Description=EscalaBus
After=network.target

[Service]
WorkingDirectory=/opt/escalabus
ExecStart=/usr/bin/npm start
Restart=on-failure
User=escalabus
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Com **nginx**, use `proxy_pass http://127.0.0.1:3000;` e `proxy_set_header X-Forwarded-Proto $scheme;` com certificado do certbot. O app confia em um proxy (`trust proxy = 1`).

**Backup do servidor:** copie periodicamente a pasta `DATA_DIR` (com o serviço parado, ou use `sqlite3 escalabus.db ".backup copia.db"`), além da exportação JSON em Configurações. Antes de cada importação o servidor grava automaticamente uma cópia em `DATA_DIR/backups/`.

---

## 5. Testes

```bash
npm test
```

Resultado da última execução (Vitest 5, Node 22): **5 arquivos, 53 testes, todos aprovados**; `npm run typecheck` e `npm run build` sem erros.

| Requisito | Teste |
|---|---|
| Bloqueio de dois sábados consecutivos | `rules › bloqueia dois sábados consecutivos`; `api › gera proposta, salva rascunho, confirma e bloqueia o sábado seguinte` |
| Bloqueio de dois domingos consecutivos | `rules › bloqueia dois domingos consecutivos` |
| Sábado anterior + domingo atual permitido | `rules › permite sábado anterior e domingo atual (e vice-versa)`; `generator › respeita a alternância…` |
| Sábado e domingo no mesmo fim de semana | `rules › permite sábado e domingo no mesmo fim de semana` |
| Incompatibilidade de função | `rules › rejeita função incompatível` |
| Incompatibilidade de turno | `rules › rejeita turno incompatível`; `time › serviço precisa caber inteiro na disponibilidade` |
| Sobreposição de pessoa e ônibus | `rules › sobreposição …` (4 testes); `api › valida serviço-modelo…` |
| Turnos atravessando meia-noite | `time › turnos atravessando a meia-noite` (3); `rules › usa o dia de início do serviço…`; `rules › pessoa em turno que atravessa…` |
| Falta de pessoas elegíveis | `generator › falta de pessoas: não burla regras…`; `generator › sem nenhum cobrador cadastrado`; `api › rascunho incompleto…` |
| Solução que exige reconsiderar escolha inicial | `generator › encontra solução que exige reconsiderar a escolha inicial (retrocesso)`; `… instância maior com restrições cruzadas` |
| Edição de escala antiga x seguinte confirmada | `rules › ao editar escala antiga…`; `api › edição de escala antiga em conflito…` |
| Troca atômica entre duas vagas | `api › troca atômica entre duas vagas…` |
| Histórico ausente | `rules › histórico ausente`; `api › gera proposta…` (aviso some após confirmar) |
| Canceladas e rascunhos fora da restrição | `api › rascunhos e escalas canceladas não contam…` |
| Virada de mês e de ano | `time › datas reais` (3); `rules › virada de mês e de ano` |
| Link wa.me | `whatsapp › wa.me` (3) |
| Outros | prioridade por histórico, sorteio entre equivalentes, limite diário configurável, snapshot do histórico, exclusão bloqueada, backup validado e confirmação, autenticação e anti-CSRF, modo demo separado |

Além dos testes automatizados, o fluxo completo foi exercitado num Chromium real (login, demonstração, sorteio, rascunho, confirmação, troca com motivo, registro de alterações, relatório, PDF, impressão, WhatsApp, modo offline, layout de celular, instruções do iPhone).

---

## 6. Limitações reais

* **WhatsApp (wa.me):** só abre a conversa com o texto pronto; o envio é confirmado pelo usuário. **Não anexa PDF** — use "Baixar PDF" ou "Compartilhar PDF" (Web Share API: Android/iOS recentes; em computadores costuma não existir). Textos muito longos podem não abrir completos: o app avisa e permite enviar por dia/turno ou copiar.
* **Offline é somente leitura** e só mostra o que já foi carregado nesse aparelho (última escala aberta, cadastros, consultas de histórico feitas). O primeiro login exige conexão. O iOS pode apagar dados de sites não usados por semanas.
* **PWA exige HTTPS** (fora de `localhost`). No iPhone não existe botão nativo de instalação; só pelo Safari, pelo menu Compartilhar.
* **Um servidor, um arquivo SQLite:** ideal para uma garagem/empresa; não é para várias instâncias do servidor em paralelo. Faça backup da pasta de dados.
* **Disponibilidade por pessoa** é uma janela diária fixa (início–fim). Folgas, férias ou ausências em datas específicas não são modeladas: inative a pessoa ou edite a escala.
* **Rascunhos não bloqueiam uns aos outros**: dois rascunhos consecutivos podem usar a mesma pessoa; o conflito é barrado na **confirmação** da segunda escala (a regra conta apenas escalas confirmadas, como pedido).
* **Atribuições antigas toleradas:** numa escala já salva, uma pessoa inativada ou com turno alterado depois não impede salvar edições de outras vagas; porém a **confirmação** de rascunho revalida tudo com o cadastro atual e pode ser recusada (o servidor lista o motivo).
* **Sorteio** tem limite de 200 mil passos de busca por função. Em cadastros muito grandes e muito restritos, se o limite for atingido o app avisa que pode existir distribuição melhor (basta sortear de novo).
* **Usuários:** apenas administradores (sem perfis/permissões diferentes). O bloqueio de tentativas de login é em memória (reinicia com o servidor).
* **Imagem de referência:** a foto citada no pedido não estava na pasta do projeto; o relatório segue a estrutura descrita (título, colunas SEQ | CARRO | HORA | LINHA | REND. | MOTORISTA | COBRADOR, seções por turno).
* Datas são dias de calendário (sem fuso); "hoje" usa o relógio do aparelho.
