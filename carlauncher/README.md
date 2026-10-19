# Painel do Carro (launcher Android)

Transforma um celular antigo em central multimídia do carro:

- **Tela inicial (launcher)** em modo paisagem, tela cheia, tema escuro e botões grandes.
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
3. Abra o **Painel do Carro**, permita **localização** e o **acesso às notificações**
   (é isso que permite controlar o YouTube Music e ler as instruções do Waze).
4. Aperte o botão *home* do celular e escolha **Painel do Carro → Sempre**
   (ou em ⚙ Ajustes → "Usar como tela inicial do celular").

## Compilar

`./gradlew assembleDebug` (precisa do Android SDK). O GitHub Actions compila sozinho a cada
alteração em `carlauncher/`.
