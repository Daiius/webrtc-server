import { Device } from 'mediasoup-client';
import mediasoup from 'mediasoup';
import sdpTransform from 'sdp-transform';
import { 
  extractDtlsParameters, 
  //extractRtpCapabilities,
} from 'mediasoup-client/lib/handlers/sdp/commonUtils';


export const createStream = async () => {
  // WHEP リクエスト
  // sdp offerをするために、RemoteSdpクラスなど
  // 必要な情報を集める必要がある
  //
  // WHIP 処理の時には OBSからのofferと
  // router.rtpCapabilitiesを合わせてanswerをつくった
  // ので、クライアント側はまずofferを作らねばならない
  // rtpCapabilitiesからofferを作りたい
  //
  // 一旦RTPPeerConnectionを作ってofferを生成する
  // これならブラウザとの相性の良いプロトコルを選べそう
  const peerConnection = new RTCPeerConnection();
  // directionは受信専用でrecvonlyで良いと考えたが、
  // mediasoupが処理する際にa=ssrcが設定されていないとエラーになる？
  // 後でサーバ側で設定しなおすとして、いったんこれでいく
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
  peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  const offer = await peerConnection.createOffer();
  const whepResponse = await fetch(
    'http://localhost:3000/whep', {
      method: 'POST',
      body: offer.sdp, 
      headers: {
        'Content-Type': 'application/sdp'
      },
    }
  );
  // mediasoup を通さずに直接RTP関連のAPI触るのはどうかと思ったが
  // SFUという面は素のAPIにはないので変ではない...と思う
  
  // sdp answerを元にtransportを作りたい
  const whepAnswer = sdpTransform.parse(await whepResponse.text());
  //const rtpCapabilities = extractRtpCapabilities({
  //  sdpObject: whepAnswer
  //});
  const dtlsParameters = extractDtlsParameters({
    sdpObject: whepAnswer
  });
  const iceParameters: Record<'audio'|'video', { usernameFragment: string, password: string}> = 
    whepAnswer.media.map(m => ({
      [m.type]: {
        usernameFragment: m.iceUfrag,
        password: m.icePwd,
      }
    }))
    .reduce((acc, curr) => ({ ...acc, ...curr }), {}) as Record<'audio'|'video', { usernameFragment: string, password: string}>;
  const iceCandidates: mediasoup.types.IceCandidate[] = whepAnswer.media.flatMap(media =>
    media.candidates.map(candidate => ({
      foundation: candidate.foundation,
      component: candidate.component,
      priority: candidate.priority as number,
      ip: candidate.ip,
      address: candidate.ip,
      port: candidate.port,
      type: candidate.type as 'host',
      protocol: candidate.transport as 'tcp' | 'udp',
    }))
  );

  const transportId = whepAnswer
    .invalid
    ?.find(d =>
      d.value.startsWith('a=mediasoup-transport-id:')
    )
    ?.value.split(':')[1];
  const routerRtpCapabilities = JSON.parse(
    whepAnswer.invalid
      ?.find(d =>
        d.value.startsWith('a=mediasoup-router-rtp-capabilities:')
      )
      ?.value.replace('a=mediasoup-router-rtp-capabilities:', '')
  );

  const producerIds: Record<'audio'|'video',string> = whepAnswer
    .media
    .map(m => ({
      [m.type as 'audio'|'video']: 
        m.invalid.find(
          s => s.value.startsWith('a=mediasoup-producer-id:')
        )?.value?.split(':')[1]
    }))
    .reduce((acc, curr) => ({ ...acc, ...curr }), {}) as Record<'audio'|'video',string>;
  
  const rtpParameters: Record<'audio'|'video', mediasoup.types.RtpParameters> = whepAnswer
    .media
    .map(m => ({
      [m.type as 'audio'|'video']:
        JSON.parse(
          m.invalid?.find(
            s => s.value.startsWith('a=mediasoup-rtp-parameters:')
          )?.value
          .replace('a=mediasoup-rtp-parameters:','')
        )
     }))
     .reduce((acc, curr) => ({ ...acc, ...curr }), {}) as Record<'video'|'audio',mediasoup.types.RtpParameters>;
  
  const device = new Device();
  // ただのrtpCapabilitiesではなく、routerRtpCapabilities
  // という名前になっているのはきになる
  // → cannot consume エラーが出るのでrouterCapabilitiesを取得する
  await device.load({ routerRtpCapabilities });
  const recvTransportParameters = {
    id: transportId,
    dtlsParameters,
    iceParameters: iceParameters['video'],
    iceCandidates,
  };
  console.log('recvTransportParmaeters: ', recvTransportParameters);
  const transport = device.createRecvTransport(
    recvTransportParameters
  );
  transport.on('connect', () => {
    console.log('transport connect');
  });
  console.log('rtpParameters: ', rtpParameters);
  const videoStream = await transport.consume({
    id: transportId, 
    producerId: producerIds['video'],
    kind: 'video',
    rtpParameters: rtpParameters['video'],
  });

  return videoStream;
}

