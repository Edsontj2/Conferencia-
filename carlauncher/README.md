# Painel do Carro (launcher Android)

Transforma um celular antigo em central multimídia do carro:

- **Tela inicial no estilo Android Auto / CarPlay**:
  - barra lateral com hora, bateria, Waze, YouTube Music, Telefone, modo carro e gaveta de apps;
  - **mapa escuro** (OpenStreetMap) que acompanha o GPS, com a próxima manobra e
    chegada / tempo / distância lidas da notificação do Waze;
  - **velocímetro** pelo GPS com **alerta de velocidade** (toque no círculo vermelho para mudar);
  - cartão de **música** (YouTube Music) e atalhos **Buscar, Postos, Restaurantes, Mais** (abrem no Waze).
- **Waze numa janela sobre o mapa**: em celulares que aceitam janelas (pop-up da Samsung /
  "freeform"), o Waze abre exatamente em cima do cartão do mapa, com o velocímetro e a música
  ao lado. Se o celular não aceitar, abre em tela cheia com o painel de música à direita
  (dá para escolher em Ajustes → "Como abrir o Waze").
- **Tela automática**: a tela acende sozinha quando o carro começa a andar (acima de ~12 km/h)
  ou quando o celular é ligado no carregador. Enquanto anda ou carrega, a tela não apaga.

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
