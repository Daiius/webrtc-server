import { createServer } from 'http';
import express from 'express';
import mediasoup, { createWorker } from 'mediasoup';
import { 
  WebRtcTransport,
} from 'mediasoup/node/lib/types';

import { RemoteSdp } from 'mediasoup-client/lib/handlers/sdp/RemoteSdp';

import sdpTransform from 'sdp-transform';
import ortc from 'mediasoup-client/lib/ortc';
import sdpCommonUtils from 'mediasoup-client/lib/handlers/sdp/commonUtils';
import sdpUnifiedPlanUtils from 'mediasoup-client/lib/handlers/sdp/unifiedPlanUtils';


const app = express();
app.use(express.json());
app.use(express.text({
  type: ['application/sdp', 'text/plain']
}));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin?.startsWith('http://localhost')) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Expose-Headers', '*')
  }
  next();
});

const httpServer = createServer(app);

let worker: mediasoup.types.Worker | undefined;
let router: mediasoup.types.Router | undefined;
let broadcasterTransport: WebRtcTransport | undefined;
let producers: Record<'video'|'audio', mediasoup.types.Producer> = {
  'audio': undefined,
  'video': undefined,
};
let streamerTransport: WebRtcTransport | undefined;
let isStreamerTransportConnected: boolean = false;
let consumers: Record<'video'|'audio', mediasoup.types.Consumer> = {
  'audio': undefined,
  'video': undefined,
};


const startServer = async () => {
  worker = await createWorker({
    logLevel: 'warn',
    logTags: [ 'info', 'ice', 'dtls', 'rtp', 'rtcp' ],
    rtcMinPort: 50000,
    rtcMaxPort: 50100,
  });
  console.log('Worker created');

  const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2
    },{
      kind: 'video',
      mimeType: 'video/h264',
      clockRate: 90000,
      preferredPayloadType: 107,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
      }
    }, {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {},
    }
  ];

  router = await worker.createRouter({ mediaCodecs });
  console.log('Router created');

  httpServer.listen(3000, () => {
    console.log('mediasoup server running on port 3000');
  });

}

const createWebRtcTransport = async (
  router: mediasoup.types.Router
): Promise<WebRtcTransport> => {
  const transport: WebRtcTransport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.ANNOUNCED_IP}],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  console.log('WebRTC Transport created: ', transport.id);
  return transport;
}


// for OBS WHIP protocol
app.post('/whip', async (req, res) => {
  console.log('/whip post access');

  try {
    const localSdpObject = sdpTransform.parse(req.body.toString());
    const rtpCapabilities = sdpCommonUtils.extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    const dtlsParameters = sdpCommonUtils.extractDtlsParameters({
      sdpObject: localSdpObject
    });
    const extendedRtpCapabilities = ortc.getExtendedRtpCapabilities(
      rtpCapabilities, 
      router.rtpCapabilities
    );
    const sendingRtpParametersByKind: Record<
      'audio' | 'video', 
      mediasoup.types.RtpParameters
    > = {
      audio: 
        ortc.getSendingRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video: 
        ortc.getSendingRtpParameters(
          'video', extendedRtpCapabilities
        ),
    };
    const sendingRemoteRtpParametersByKind: Record<
      'audio' | 'video', 
      mediasoup.types.RtpParameters
    > = {
      audio: 
        ortc.getSendingRemoteRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video:
        ortc.getSendingRemoteRtpParameters(
          'video', extendedRtpCapabilities
        )
    };
    
    // 毎回作り直してみる
    broadcasterTransport = await createWebRtcTransport(router);

    broadcasterTransport.observer.on(
      'icestatechange', 
      (newIceState) => console.log(
        `broadcaster ICE state changed to: ${newIceState}`
      )
    );

    const remoteSdp = new RemoteSdp({
      iceParameters: broadcasterTransport.iceParameters,
      iceCandidates: broadcasterTransport.iceCandidates,
      dtlsParameters: {
        ...broadcasterTransport.dtlsParameters,
        role: 'client',
      },
      sctpParameters: broadcasterTransport.sctpParameters,
    });
    
    await broadcasterTransport.connect({ dtlsParameters });


    for (const { type, mid } of localSdpObject.media) {

      console.log('type, mid: ', { type, mid });

      const mediaSectionIdx = 
        remoteSdp.getNextMediaSectionIdx();
      const offerMediaObject = 
        localSdpObject.media[mediaSectionIdx.idx];
      console.log('offerMediaObject: ', offerMediaObject);

      const sendingRtpParameters: mediasoup.types.RtpParameters = { 
        ...sendingRtpParametersByKind[type as 'video' | 'audio']
      };
      const sendingRemoteRtpParameters: mediasoup.types.RtpParameters = {
        ...sendingRemoteRtpParametersByKind[type as 'video' | 'audio']
      };

      sendingRtpParameters.mid = 
        (mid as unknown as number).toString();
      sendingRtpParameters.rtcp!.cname =
        sdpCommonUtils.getCname({ offerMediaObject });
      sendingRtpParameters.encodings =
        sdpUnifiedPlanUtils.getRtpEncodings({ offerMediaObject });
    
      console.log('%o', sendingRtpParameters);
      console.log('%o', sendingRemoteRtpParameters);


      remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions: {},
        extmapAllowMixed: true
      });

      const producer = await broadcasterTransport.produce({
        kind: type as 'video' | 'audio',
        rtpParameters: sendingRtpParameters
      });

      console.log('producer created: ', producer);

      producers[type as 'video'|'audio'] = producer;
    }

    const answer = remoteSdp.getSdp();
    console.log('answer: ', answer);

    res
      .type('application/sdp')
      .appendHeader(
        'Location', 
        'http://localhost:3000/whip/test-broadcast'
      )
      .status(201)
      .send(answer.toString());
  } catch (error) {
    console.error('Error during WebRTC offer handling: ', error);
    res.status(500);
  }
});

app.delete('/whip/test-broadcast', async (_req, res) => {
  console.log(
    'broadcasterTransport stats: %o', 
    await broadcasterTransport?.getStats()
  );
  console.log(
    'producers.audio stats: %o', 
    await producers.audio?.getStats()
  );
  console.log(
    'producers.video stats: %o', 
    await producers.video?.getStats()
  );
  broadcasterTransport?.close();
  res.status(200)
    .send(`transport ${broadcasterTransport?.id} closed.`);
  console.log(`transport: ${broadcasterTransport?.id} closed.`);
});

app.get('/mediasoup/router-rtp-capabilities', async (_req, res) => {
  res.status(200).send(router.rtpCapabilities);
});

app.get('/mediasoup/streamer-transport-parameters', async (_req, res) => {
  if (streamerTransport == null) {
    streamerTransport = await createWebRtcTransport(router);
  }
  res.status(200).send({
    id: streamerTransport.id,
    dtlsParameters: streamerTransport.dtlsParameters,
    iceParameters: streamerTransport.iceParameters,
    iceCandidates: streamerTransport.iceCandidates,
  });
});

app.post('/mediasoup/client-connect', async (req, res) => {
  const dtlsParameters = req.body;
  if (streamerTransport != null) {
    streamerTransport.connect({ dtlsParameters });
    res.status(200).send('client connect callback handled');
  } else {
    res.status(500).send('streamer transport is not ready');
  } 
});

app.post('/mediasoup/consumer-parameters', async (req, res) => {
  const clientCapabilities = req.body;
  // なんとなく、producerはvideo/audioが一つずつあるという
  // 仮定に依存していそうなのがきになる
  // 本来ならばすべてのproducerをconsume出来るかチェックするべきかも
  const consumeParameters = (type: 'video'|'audio') => ({
    producerId: producers[type].id,
    rtpCapabilities: clientCapabilities,
    pause: true,
  });
  const canConsume = (type: 'video'|'audio') => router.canConsume(
    consumeParameters(type)
  );
  const consumeWithCheck = async (type: 'video'|'audio') => {
    if (canConsume(type)) {
      consumers[type] = await streamerTransport.consume(
        consumeParameters(type)
      );
    } else {
      console.warn('cannot consume: %o', consumeParameters(type));
    }
  }
  await consumeWithCheck('video');
  await consumeWithCheck('audio');
  const consumerParameters = (type: 'audio'|'video') => {
    const consumer = consumers[type];
    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  };
  res.status(200).send({
    video: consumerParameters('video'),
    audio: consumerParameters('audio'),
  });
});


startServer().catch(err => {
  console.error('Failed to start server: ', err);
});

