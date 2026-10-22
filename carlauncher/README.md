# DriveOS — central do carro (Samsung Galaxy A52 na horizontal)

Launcher Android nativo (Kotlin + Jetpack Compose + Material 3) que transforma o celular
numa central do carro: **barra lateral**, **velocímetro pelo GPS** e **YouTube Music**,
com o **Waze aberto ao lado** quando você toca nele.

## Telas

- **Painel (Waze fechado):** barra lateral + velocímetro em cima (52%) + música embaixo (48%),
  ocupando toda a tela.
- **Painel + Waze:** ao tocar no Waze, o painel se comprime para 60% à esquerda e o Waze abre
  nos 40% da direita.
- **Aplicativos:** gaveta com todos os apps (segure um app para ver os detalhes).
- **Ajustes:** modo demonstração, GPS, limite de velocidade, unidade, suavização, player padrão,
  estado do YouTube Music, como abrir o Waze, tela ligada, modo imersivo, tela automática.

## Como compilar e instalar

- O GitHub Actions compila sozinho a cada alteração em `carlauncher/` e publica o APK em
  *Releases → "Painel do Carro (APK)"* (`PainelDoCarro.apk`).
- Localmente: abra a pasta `carlauncher/` no Android Studio (JDK 17) e rode
  `./gradlew assembleDebug`. O APK fica em `app/build/outputs/apk/debug/`.
- No celular: permita "instalar apps desconhecidos", instale, abra o DriveOS e aperte *home* →
  **DriveOS → Sempre**.

## Permissões e o que depende delas

| Permissão | Para quê | Sem ela |
|---|---|---|
| Localização (GPS) | Velocímetro e limite da via | Velocímetro mostra "Aguardando GPS" |
| Acesso às notificações | Ler e controlar o YouTube Music (MediaSession) | Card de música pede o acesso |
| Acesso ao uso (opcional) | Detectar que a janela do Waze fechou e voltar à tela cheia | Volta pelo botão "Tela cheia" |
| Aparecer sobre outros apps (opcional) | Modo "Tela cheia + painel" e acender a tela sozinho | Esses dois recursos não funcionam |
| Internet | Limite de velocidade (OpenStreetMap) | Badge mostra "--" |

No Samsung / Android 13+, apps instalados fora da Play Store precisam de
*Configurações → Aplicativos → DriveOS → ⋮ → Permitir configurações restritas* antes de liberar
o acesso às notificações.

## Limitações reais do Android (Android 13/14)

- **Nenhum app comum consegue colocar a interface do Waze dentro da própria tela.**
  O DriveOS abre o Waze numa **janela pop-up do sistema** posicionada exatamente nos 40% da
  direita (`ActivityOptions.setLaunchBounds`, funciona em aparelhos com janelas, como Samsung)
  ou na **tela dividida do Android** (`FLAG_ACTIVITY_LAUNCH_ADJACENT`), quando o sistema permite.
- Como o DriveOS é a **tela inicial**, o Android não coloca a própria tela inicial em tela
  dividida; por isso o caminho principal é a janela pop-up.
- O Android não avisa outro app quando a janela do Waze é fechada. Com o **acesso ao uso**
  liberado, o DriveOS lê os eventos públicos de uso e volta à tela cheia sozinho; sem ele, use o
  botão **Tela cheia** no espaço do Waze. Se o painel estiver na tela dividida nativa, a troca é
  automática (`onMultiWindowModeChanged`).
- **Limite de velocidade:** o Waze não compartilha esse dado. O DriveOS usa o OpenStreetMap
  (colaborativo); vias sem limite cadastrado mostram "--".
- **Modo demonstração:** dados de exemplo sempre identificados com o selo "DEMONSTRAÇÃO".

## Estrutura

```
app/src/main/java/com/edson/carlauncher/
  MainActivity.kt            Compose + Navigation, abertura do Waze, janela/imersivo
  ui/theme/                  Color, Type (Inter), Shape (raios e espaçamentos), Theme
  ui/components/             AppSidebar, SpeedometerCard, MusicPlayerCard, IconButton
  ui/screens/                DashboardScreen, SettingsScreen, AppsScreen
  viewmodel/                 Speed, Music, Settings, Waze, Apps (StateFlow)
  data/location/             leitura do GPS (vinda do CarService)
  data/media/                sessão de mídia (MediaSessionManager)
  data/preferences/          configurações (DataStore)
  domain/model/              modelos
  CarService.kt              serviço em primeiro plano: GPS (FusedLocation), tela automática
  SpeedLimit.kt              limite da via (OpenStreetMap / Overpass)
  MediaHub.kt, MediaListenerService.kt   acesso às sessões de mídia
```

Fonte Inter: SIL Open Font License 1.1 (`app/src/main/assets/licenses/Inter-OFL.txt`).
