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

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const app = express();
app.use(express.json());
app.use(express.text({
  type: ['application/sdp', 'text/plain']
}));

const httpServer = createServer(app);

let worker: mediasoup.types.Worker;
let router: mediasoup.types.Router;
let broadcasterTransport: WebRtcTransport;
let audioProducer: mediasoup.types.Producer;
let videoProducer: mediasoup.types.Producer;
let streamerTransport: WebRtcTransport;


const startServer = async () => {
  worker = await createWorker();
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
    console.log('body: ', req.body.toString());
    const rtcpCapabilities = sdpCommonUtils.extractRtpCapabilities({
      sdpObject: localSdpObject
    });
    const dtlsParameters = sdpCommonUtils.extractDtlsParameters({
      sdpObject: localSdpObject
    });
    const extendedRtpCapabilities = ortc.getExtendedRtpCapabilities(
      rtcpCapabilities, 
      router.rtpCapabilities
    );
    const sendingRtpParametersByKind: Record<'audio' | 'video', mediasoup.types.RtpParameters> = {
      audio: 
        ortc.getSendingRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video: 
        ortc.getSendingRtpParameters(
          'video', extendedRtpCapabilities
        ),
    };
    const sendingRemoteRtpParametersByKind: Record<'audio' | 'video', mediasoup.types.RtpParameters> = {
      audio: 
        ortc.getSendingRemoteRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video:
        ortc.getSendingRemoteRtpParameters(
          'video', extendedRtpCapabilities
        )
    };
    
    broadcasterTransport = await createWebRtcTransport(router);

    await broadcasterTransport.setMaxIncomingBitrate(1500000);

    const remoteSdp = new RemoteSdp({
      iceParameters: broadcasterTransport.iceParameters/*{
        ...broadcasterTransport.iceParameters,
        usernameFragment: localSdpObject.iceUfrag ?? '',
      }*/,
      iceCandidates: broadcasterTransport.iceCandidates,
      dtlsParameters: {
        ...broadcasterTransport.dtlsParameters,
        role: 'client',
      },
      sctpParameters: broadcasterTransport.sctpParameters,
    });


    for (const { type, mid } of localSdpObject.media) {

      console.log('type, mid: ', { type, mid });

      const mediaSectionIdx = remoteSdp.getNextMediaSectionIdx();
      const offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      const sendingRtpParameters: mediasoup.types.RtpParameters = { 
        ...sendingRtpParametersByKind[type as 'video' | 'audio']
      };
      const sendingRemoteRtpParameters: mediasoup.types.RtpParameters = {
        ...sendingRemoteRtpParametersByKind[type as 'video' | 'audio']
      };

      sendingRtpParameters.mid = mid?.toString();
      sendingRtpParameters.rtcp!.cname =
        sdpCommonUtils.getCname({ offerMediaObject });
      sendingRtpParameters.encodings =
        sdpUnifiedPlanUtils.getRtpEncodings({ offerMediaObject });


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

      type === 'video'
        ? videoProducer = producer
        : audioProducer = producer;
    }

    await broadcasterTransport.connect({ dtlsParameters });

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
  broadcasterTransport?.close();
  res.status(200)
    .send(`transport ${broadcasterTransport?.id} closed.`);
  console.log(`transport: ${broadcasterTransport?.id} closed.`);
});

app.post('/whep', async (req, res) => {
  try {
    const localSdpObject = sdpTransform.parse(req.body.toString());
    console.log('body: ', req.body.toString());
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
    const sendingRtpParametersByKind: Record<'audio' | 'video', mediasoup.types.RtpParameters> = {
      audio: 
        ortc.getSendingRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video: 
        ortc.getSendingRtpParameters(
          'video', extendedRtpCapabilities
        ),
    };
    const sendingRemoteRtpParametersByKind: Record<'audio' | 'video', mediasoup.types.RtpParameters> = {
      audio: 
        ortc.getSendingRemoteRtpParameters(
          'audio', extendedRtpCapabilities
        ),
      video:
        ortc.getSendingRemoteRtpParameters(
          'video', extendedRtpCapabilities
        )
    };
    
    streamerTransport = await createWebRtcTransport(router);

    await streamerTransport.setMaxIncomingBitrate(1500000);

    const remoteSdp = new RemoteSdp({
      iceParameters: broadcasterTransport.iceParameters/*{
        ...broadcasterTransport.iceParameters,
        usernameFragment: localSdpObject.iceUfrag ?? '',
      }*/,
      iceCandidates: broadcasterTransport.iceCandidates,
      dtlsParameters: {
        ...broadcasterTransport.dtlsParameters,
        role: 'client',
      },
      sctpParameters: broadcasterTransport.sctpParameters,
    });


    for (const { type, mid } of localSdpObject.media) {

      console.log('type, mid: ', { type, mid });

      const mediaSectionIdx = remoteSdp.getNextMediaSectionIdx();
      const offerMediaObject = localSdpObject.media[mediaSectionIdx.idx];
      const sendingRtpParameters: mediasoup.types.RtpParameters = { 
        ...sendingRtpParametersByKind[type as 'video' | 'audio']
      };
      const sendingRemoteRtpParameters: mediasoup.types.RtpParameters = {
        ...sendingRemoteRtpParametersByKind[type as 'video' | 'audio']
      };

      sendingRtpParameters.mid = mid?.toString();
      sendingRtpParameters.rtcp!.cname =
        sdpCommonUtils.getCname({ offerMediaObject });
      sendingRtpParameters.encodings =
        sdpUnifiedPlanUtils.getRtpEncodings({ offerMediaObject });

      remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions: {},
        extmapAllowMixed: true
      });

      const consumer = await streamerTransport.consume({
        producerId: 
          type === 'video' 
            ? videoProducer.id
            : audioProducer.id,
        rtpCapabilities: rtpCapabilities,
      });

  
      console.log('consumer created: ', consumer);

      //type === 'video'
      //  ? videoProducer = producer
      //  : audioProducer = producer;
    }
    await streamerTransport.connect({ dtlsParameters });

    const answer = remoteSdp.getSdp();
    console.log('answer: ', answer);

    res
      .type('application/sdp')
      .appendHeader(
        'Location', 
        'http://localhost:3000/whep/test-stream'
      )
      .status(201)
      .send(answer.toString());
  } catch (error) {
    console.error('Error during WebRTC offer handling: ', error);
    res.status(500);
  }
});

app.delete('/whep/test-stream', async (_req, res) => {
  streamerTransport?.close();
  console.log('streamerTransport closed');
  res.status(200); 
});

app.get('/whep/router-capabilities', async (_req, res) => {
  res.status(200).send(router.rtpCapabilities);
});

app.get('/whep/transport', async (_req, res) => {
  console.log('streamerTransport parameter');
  res.status(200).send({
    id: streamerTransport?.id,
    iceParameters: streamerTransport?.iceParameters,
    iceCandidates: streamerTransport?.iceCandidates,
    dtlsParameters: streamerTransport?.dtlsParameters,
    sctpParameters: streamerTransport?.sctpParameters,
  });
})

app.get('/whep/video-producer-id', async (_req, res) => {
  console.log('videoProducer id');
  res.status(200).send(videoProducer?.id);
});

app.get('/', async (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.get('/client.js', async (req, res) => {
  res.sendFile(join(__dirname, 'client.js'));
});

startServer().catch(err => {
  console.error('Failed to start server: ', err);
});

