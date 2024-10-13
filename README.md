# mediasoup による WebRTC Server/Client 作成
珍しく ChartGPT があまり役に立たないので色々メモ

## mediasoup を使うために覚えておきたい概念
https://leaysgur.github.io/posts/2020/03/24/152051/
に色々記述が有る、ありがたい

- Worker
- Router
- Transport
- Producer
- Consumer

という概念が（少なくともサーバ側だけでも）ある。

## PlainTransport と WebRtcTransport の違い
ネゴシエーションを行う様な、client-server 間の通信にはWebRtcTransport,
ffmpegからのストリームの様なただ受け取ればよいものはPlainTransport
の気配を感じる
→違うかも

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

これを一般的なWebRTC関連の用語では SDP というらしい。
Session Description Protocol,
この辺をいい感じにラップしてくれているのかも。

## OBS の WHIP 対応について
これを使えば直接 WebRTC 通信を受け取ることができる。
ffmpegの処理を省略できるのは大きい、使い方を調べてみよう...

### WHIP対応のサーバが必要そう
https://datatracker.ietf.org/doc/html/draft-ietf-wish-whip
mediasoupのexamplesが好き勝手にやっている SDP を
決められた方法で行う仕組み


## Next.js と WebSocket (Socket.IO) との相性
よくないらしい、page router を使えば出来るとか
無理に Next.js にすると訳が分からなくなりそうなので保留...


