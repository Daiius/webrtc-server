# mediasoup による WebRTC Server/Client 作成
珍しく ChartGPT がそのまま動くようなプログラムを生成できないので
色々検討+メモ


## 複数の配信管理の方法検討

### 2024-10-15


#### 接続・ID検討
routerを2つ用意しておいて、空いている方を使う
使用中かどうか判断するには、undefinedを代入するか...

router使用状況は専用ページから見られるようにしておく


consumerは6-8個まで作れるようにし、
超えた分は古い順にサーバ側・クライアント側ともに順番に破棄する

意図しないクライアントに視聴されることは一応防ぎたいので、
（ホラー系の動画など？）クライアントは接続時にIDを必要とする

IDをどうやって通知するか...
配信者は専用の画面を使って操作できるようにするべきか
毎回はいらないかもだがOBSの設定画面スクショなども出しておきたいし...

```mermaid
sequenceDiagram
    actor broadcaster as 配信者
    participant obs as 配信者OBS
    participant broadcaster_page as ブラウザ<br/>配信画面
    participant server as WebRTCサーバ 
    participant streamer_page as ブラウザ<br/>視聴画面
    actor streamer as 視聴者

    Note right of broadcaster : 配信開始
    broadcaster ->> broadcaster_page : 配信画面にアクセス<br/>配信ID取得ボタン押す
    broadcaster_page ->> server : 配信用IDリクエスト
    server -->> broadcaster_page : 配信用IDを返却
    broadcaster_page ->> broadcaster_page : ?id=...へリダイレクト
    broadcaster_page -->> broadcaster : 配信ID＆視聴用URLを返す
    broadcaster ->> obs : OBS起動<br/>配信IDをURLに含める<br/>配信開始
    obs ->> server : WHIP形式 WebRTC接続
    server -->> obs : 配信IDを含めた<br/>メディア制御URLを返却
    obs ->> server : WebRTC通信
    server ->>+ server : 配信IDをキーとしてリソース生成
    broadcaster_page ->> server : 状態をポーリング
    server -->> broadcaster_page : 配信状況など更新
    Note right of broadcaster : 視聴の流れ
    broadcaster ->> streamer : 視聴用URLを共有
    streamer ->> streamer_page : 視聴用URLにアクセス
    streamer_page ->> server : WebRTC接続
    server ->> streamer_page : WebRTC通信
    streamer_page ->> streamer : 動画スタート
    Note right of broadcaster : 配信停止
    broadcaster ->> obs : 配信停止ボタン押す
    obs ->> server : メディア制御URLを用いて<br/>配信停止
    server ->>-server : リソース破棄
    server ->> streamer_page : 状態変化を検出？
    streamer_page ->> streamer : 配信停止を通知
    broadcaster_page ->> server : 状態をポーリング
    server -->> broadcaster_page : 配信状況など更新
```

- 配信停止処理を行わなければ配信用IDは有効なままなので、
  一時的な通信の問題などで接続が切れても再接続できる
  - OBSは深刻なエラーの際には自動で配信停止処理を行う？
- 仮に配信停止ボタンを押しても配信用IDを有効なままに出来れば、
  すぐに再配信したいときも対応できそう

配信用URL
`GET https://b60.faveo-systema.net/broadcast`

WHIP接続用URL
`POST https://b60.faveo-systema.net/broadcast?id=...`

視聴用URL
`GET https://b60.faveo-systema.net/stream?id=...`

### 2024-10-14
最初に動作確認を行ったバージョンは配信者1, 視聴者1 の状況にしか
対応していないので、これを実用的なレベルにしたい。

視聴側はクライアントアプリを開くと新しいconsumerを作ればよいだろうか？
古いconsumerから順番に削除するか...

https://mediasoup.org/documentation/v3/scalability/

には

> A Router holds producers and consumers that exchange 
> audio/video RTP between them. In certain common usages, 
> a router can be understood as a “multi-party conference room”.

とあるので、server側のtransportを大量生成する必要は無いのだろう

では、必要なくなったserver側のconsumerをどうやって削除するのだろうか？

→ https://mediasoup.org/documentation/v3/mediasoup/garbage-collection/ に記述がありました

- 必要なリソースはプログラム中で参照を保持し、
  gabage collectされないようにしておく
- 関連するリソース(worker, router, transport, producer, consumer)は、
  上位のものがcloseされると自動的にcloseされる
- 逆に言えば、自前できちんと生成・削除を管理する必要がある
  - ~~ということは、不要になったtransportをcloseしてしまえば
    関連するproducers/consumersはまとめてcloseできる~~
  - routerを削除した方が速そう、"room の様なもの"であるという記述も
    どこかにあったし...
    サンプルプログラムもそうなっていた気がする

## mediasoup を使うために覚えておきたい概念
https://leaysgur.github.io/posts/2020/03/24/152051/
に色々記述が有る、ありがたい

- Worker
- Router
- Transport
- Producer
- Consumer

という概念が（少なくともサーバ側だけでも）ある。

## mediasoupを使ったコードをいじり倒した上でドキュメントを再確認
結構ちゃんと書いてある、用語などピンとこなかったのであれだが、
もし最初に読んだときに理解できるならこれ以上のものはないかも

### 勘違いしていそうなポイント
~~外部のRTP通信でproducerを作るときには、PlainTransportらしい~~

素のRTP接続の時はPlainTransportとなる、WebRTC接続はICEやDTLS等も含む
より複雑なものになるらしい、だから色々種類があるのか...

https://mediasoup.org/documentation/v3/communication-between-client-and-server/

clientでconsumeするには、
- device.rtpParameters をサーバに送信
- そのパラメータを使ってrouter.canConsumeで確認
- Okならtransport.consumeする
- client側のtransport.connectで必要な処理を行う

## WHIP/WHEPとmediasoup{,-client}間の通信について
RFCより(https://datatracker.ietf.org/doc/html/draft-ietf-wish-whip)
### WHIP/WHEP
```plantuml
@startuml
participant "WHEP/WHIP Client" as client
participant "WHEP/WHIP endpoint" as server
participant "Media Server" as media
participant "WHEP/WHIP session" as session
client -> server : SDP offer
client <- server : SDP answer \n201 Created \nLocation header
client -> media : ICE request
client <- media : ICE response
client <-> media : DTLS setup
client -> session : HTTP DELETE
client <- session : 200 OK

@enduml
```

## mediasoup/ WHIP(OBS)/WHEP?(client)
```plantuml
@startuml
participant mediasoup
participant worker
participant router
participant broadcasterTransport
participant producer
participant "WHIP information" as whip
mediasoup -> worker ** : createWorker
worker -> router ** : createRouter
router -> broadcasterTransport ** : createWebRtcTransport \n(ip, announcedIp, ...)
broadcasterTransport <- whip : dtlsParameters
broadcasterTransport -> broadcasterTransport ++ : broadcasterTransport.connect({ dtlsParameters })
broadcasterTransport <- whip : sendingRtpParameters
broadcasterTransport -> producer ** : transport.produce({ kind, sendingRtpParameters })
@enduml
```

## Client-Serverの連携について
ある程度のネゴシエーション？というより情報のやりとり？は
必要になりそう。

https://github.com/NNNiNiNNN/mediasoup-socketio-test

では websocket メッセージのやりとりで、

https://github.com/versatica/mediasoup-demo

では POST API 等を用いて、
「これからクライアントが接続するから、consumeする」とか、
準備が行われているようだ。
その際に色々情報を（transport関連のオプション設定等）受け渡している

例えばクライアントが接続してくる際に consumer をサーバ側で用意するのは
なんとなくわかるとして、クライアント側の処理に必要な情報をサーバが何か
渡していたりしないだろうか？

transport 関連の parameters を渡しているみたい。
server と同じ構成のtranpsortをクライアント側でも作っている。

→ mediasoupドキュメントに色々書いてある

https://mediasoup.org/documentation/v3/communication-between-client-and-server/
# mermaidテスト
PlantUMLからmermaidに移行するためのちょっとしたテスト
```mermaid
sequenceDiagram
  participant A as 日本語 
  participant B
  Note right of B: 文法ミスは開発者ツールで見られる<br/>(Previm, mermaid.min.js)
  %% コメントは%記号2連続
  %% PlantUMLはエラーを出力画像に出していたが、
  %% それ自体ちょっと複雑すぎる（悪用できる？）感じもするから
  %% こんなもんで良いのだろう...
  Note right of B: 改行するにはbrタグ、ソース中では頑張って1行に収める必要あり<br/>(shell scriptの \ に相当するものはなし)
  Note right of B: エイリアスの設定方法はPlantUMLと順番が逆
  A ->> B : Hello!Mermaid!
```

