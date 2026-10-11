# EscalaBus — Arquitetura e modelo de dados

## Escolha da arquitetura

Um único projeto Node.js/TypeScript com três partes:

| Parte | Tecnologia | Por quê |
|---|---|---|
| `shared/` | TypeScript puro | **Regras de escala, sorteio, relatório e WhatsApp num só lugar.** O mesmo código valida no navegador (resposta imediata) e no servidor (fonte da verdade). Testável sem banco nem navegador. |
| `server/` | Express 5 + SQLite (`better-sqlite3`) | Um processo, um arquivo de banco, sem servidor de banco para instalar. SQLite é transacional (ACID) e suficiente para um administrador e alguns dispositivos. Gravações são serializadas (`BEGIN IMMEDIATE`), sem condições de corrida. |
| `src/` | React 19 + Vite + `vite-plugin-pwa` | SPA leve, PWA instalável com service worker gerado pelo Workbox. |

Em produção, o próprio Express serve o frontend compilado (`dist/`): **um processo, uma porta**. Backup = copiar a pasta `data/` (ou usar a exportação JSON da tela Configurações).

Alternativas descartadas: PostgreSQL (exige outro serviço sem ganho para este volume), Firebase/Supabase (dependência externa e dados fora do servidor da empresa), localStorage como banco (proibido pelos requisitos e não compartilha entre dispositivos).

## Fluxo de dados

```
Navegador (React)                     Servidor (Express)                 SQLite
  ├─ shared/rules  → validação local    ├─ shared/rules → revalidação      ├─ escalabus.db       (dados reais + usuários/sessões)
  ├─ cópia offline (localStorage)       ├─ transações + versão otimista   └─ escalabus-demo.db  (demonstração, fictícios)
  └─ service worker (casca do app)      └─ auth por cookie httpOnly
```

* **Fonte da verdade:** sempre o servidor. O `localStorage` guarda só uma *cópia* das últimas respostas GET (por usuário e modo), para consulta offline; é apagada ao sair.
* **Offline:** o service worker serve a casca do app; os dados vêm da cópia. Um aviso vermelho fica visível e **todas as gravações são bloqueadas** (o cliente recusa antes de enviar; nada fica "pendente").
* **Concorrência entre dispositivos:** cada escala tem `version`. Salvar/confirmar/cancelar/trocar exige a versão lida; se outro dispositivo alterou antes, o servidor responde 409 e o app recarrega — nada é sobrescrito em silêncio.

## Modelo de dados (migration `server/migrations/001_init.sql`)

```
users(id, username, password_hash[scrypt], created_at)
sessions(token_hash[sha256], user_id, mode['real'|'demo'], created_at, expires_at)
settings(key, value)                         -- companyName, maxServicesPerDay
people(id, name, role['motorista'|'cobrador'], shift_name, avail_start, avail_end, whatsapp, active)
lines(id, code UNIQUE, description, active)
buses(id, fleet_number UNIQUE, plate, active)
services(id, weekday[6=sáb|0=dom], line_id→lines, bus_id→buses, start_time, end_time, shift_name, active)
recipients(id, name, phone)
schedules(id, saturday, status['rascunho'|'confirmada'|'cancelada'], version, notes, …, cancel_reason)
   UNIQUE (saturday) WHERE status <> 'cancelada'   -- no máximo uma escala ativa por fim de semana
schedule_entries(uid, schedule_id, position, date, service_id,
   line_id, line_code, line_description,      -- snapshot da linha
   bus_id, bus_fleet, bus_plate,              -- snapshot do ônibus
   start_time, end_time, shift_name,
   driver_id, driver_name, conductor_id, conductor_name)   -- snapshot das pessoas
schedule_audit(id, schedule_id, at, username, action, reason, summary, before_json, after_json)
```

Decisões importantes:

* **Snapshot no registro da escala.** Nome, linha, carro e placa são copiados ao salvar. Se o cadastro mudar depois, relatórios antigos continuam iguais. Se a atribuição não mudou numa edição, o snapshot antigo é mantido.
* **Sem chave estrangeira de `schedule_entries` para cadastros** — o histórico não pode depender do cadastro atual. Em vez disso, a API **impede excluir** pessoa/linha/ônibus já usados em escala (deve-se inativar).
* **Uma escala = um fim de semana**, identificada pelo sábado. Cada registro tem a **data de início** do serviço (sábado ou domingo). Serviços que atravessam a meia-noite (`fim <= início`) terminam no dia seguinte.
* **Serviços (`services`) são modelos**: o sorteio copia os ativos para os registros da escala; editar a escala nunca altera o modelo.
* **Banco de demonstração separado** (`escalabus-demo.db`): mesma estrutura, dados fictícios com "(fictício)" no nome e "DEMONSTRAÇÃO" na empresa. A sessão guarda o modo; a troca é explícita em Configurações e há uma faixa roxa permanente na tela.

## Regras (shared/rules.ts)

`validateSchedule(entries, ctx)` devolve pendências com gravidade:

* `error` — viola regra obrigatória → **bloqueia salvar e confirmar**;
* `incomplete` — vaga sem pessoa/linha/ônibus → **permite rascunho, bloqueia confirmar**;
* `warning` — aviso (histórico ausente).

Regras verificadas: data dentro do fim de semana; horários válidos; função; pessoa/linha/ônibus ativos; serviço inteiro dentro da disponibilidade (inclusive janelas que atravessam a meia-noite); sobreposição de pessoa; sobreposição de ônibus; limite de serviços por pessoa/dia; alternância semanal (mesmo dia da semana na semana anterior **ou seguinte**, só escalas **confirmadas**, pela data de início, com aritmética de datas reais).

Atribuições antigas inalteradas não são reprovadas por mudanças posteriores de cadastro (ex.: pessoa inativada depois), para que escalas históricas continuem editáveis. Sobreposição e alternância **sempre** são verificadas. Na **confirmação** nada é tolerado: tudo é revalidado com o cadastro atual, dentro de uma transação.

## Sorteio (shared/generator.ts)

1. Vagas = serviços ativos com linha e ônibus ativos.
2. Para cada função (conjuntos de pessoas disjuntos), busca em profundidade com **retrocesso**:
   * escolhe a vaga com **menos candidatos** compatíveis (MRV);
   * tenta candidatos em ordem de **menos participações confirmadas** (+ vagas já recebidas neste sorteio), com desempate **aleatório**;
   * se uma escolha leva a beco sem saída, **desfaz e tenta outra**;
   * se não há solução completa, **maximiza vagas preenchidas**, com limite superior por emparelhamento bipartido máximo (Kuhn) e poda por contagem otimista; limite de 200 mil nós.
3. Vagas que ficarem vazias recebem explicação: quantas pessoas foram excluídas por turno incompatível, por trabalhar no mesmo dia da semana anterior (com a data), por sobreposição, por limite diário, ou "falta de pessoas".

O resultado é apenas uma **proposta**: nada é salvo até o usuário clicar em salvar; se já existir rascunho, o app pede confirmação para substituí-lo; escala confirmada não é substituída pelo sorteio.
