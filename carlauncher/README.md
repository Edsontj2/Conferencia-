# Painel do Carro (launcher Android)

Transforma um celular antigo em central multimídia do carro:

- **Tela inicial (launcher)** em modo paisagem, tela cheia, tema escuro e botões grandes.
- **Modo carro (Waze + música)**: o Waze abre em tela cheia e o painel de música fica à direita,
  por cima dele, como no Android Auto. O painel pode ser recolhido numa tira fina (‹ ›) e tem
  o botão 🏠 para voltar à tela inicial.
- **Tela automática**: com o GPS rodando em segundo plano, a tela **acende sozinha quando o carro
  começa a andar** (acima de ~12 km/h) ou quando o celular é ligado no carregador, e já abre o
  Waze + música. Enquanto o carro anda ou o celular carrega, a tela não apaga.
- **Navegação pelo Waze**: botões *Casa*, *Trabalho* e *Waze*; o cartão no topo mostra a
  instrução da notificação de navegação do Waze (quando a rota está ativa).
- **Velocímetro pelo GPS** (km/h) em arco.
- **Música pelo YouTube Music**: capa, nome, artista, tempo, anterior/play/próxima e volume.
- **Modo relógio**: depois de um tempo sem toque, mostra hora grande, data, velocidade e música.
  Qualquer toque volta ao painel.
- **Gaveta de aplicativos** para abrir qualquer outro app (segure um app para ver os detalhes dele).

## Instalar

1. Baixe `PainelDoCarro.apk` na página de *Releases* do repositório (versão "Painel do Carro (APK)")
   ou nos artefatos do GitHub Actions.
2. No celular, permita "instalar apps de fontes desconhecidas" e abra o APK.
3. Abra o **Painel do Carro**, permita **localização**, **aparecer sobre outros apps** e o **acesso às notificações**
   (é isso que permite controlar o YouTube Music e ler as instruções do Waze).
   - **Samsung / Android 13 ou mais novo:** se o acesso às notificações aparecer bloqueado
     ("configuração restrita"), vá em *Configurações → Aplicativos → Painel do Carro*,
     toque no menu **⋮** (canto superior direito) → **Permitir configurações restritas**
     e depois ative o acesso às notificações. No app: ⚙ Ajustes → "Liberar configurações restritas".
   - No Samsung, vale também em *Bateria* do app marcar **Sem restrições**, para o
     Android não fechar o painel em segundo plano.
   - Para a tela acender e abrir o Waze sem pedir senha, use bloqueio de tela "Deslizar"/"Nenhum"
     ou o *Smart Lock* (desbloqueio com o Bluetooth do carro).
4. Aperte o botão *home* do celular e escolha **Painel do Carro → Sempre**
   (ou em ⚙ Ajustes → "Usar como tela inicial do celular").

## Compilar

`./gradlew assembleDebug` (precisa do Android SDK). O GitHub Actions compila sozinho a cada
alteração em `carlauncher/`.
