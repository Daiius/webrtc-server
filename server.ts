import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import expressWs from 'express-ws';
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
app.use(async (req, res, next) => {
  console.log('req: ', req);
  next();
});

const appWs = expressWs(app);

const httpServer = createServer(app);
const io = new Server(httpServer, { 
  transports: ['polling', 'websocket'],
  path: '/whip/test-broadcast',
});

let worker: mediasoup.types.Worker;
let router: mediasoup.types.Router;
let broadcasterTransport: WebRtcTransport;


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

  io.on('connection', (socket) => {
    console.log('Client (broadcaster) connected.');

    socket.on('join', async () => {
      console.log('websocket join');
    });

    socket.on('error', (err) => {
      console.error('Socket.IO error: ', err);
    });

    socket.on('disconnect', (reason) => {
      console.log('Client disconnected: ', reason);
    });
  });

  httpServer.listen(3000, () => {
    console.log('mediasoup server running on port 3000');
  });

}

const createWebRtcTransport = async (
  router: mediasoup.types.Router
): Promise<WebRtcTransport> => {
  const transport: WebRtcTransport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: 'localhost:3000'}],
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
  const offer = req.body.sdp;
  
  // OBS sends empty offer...
  //console.log('offer: ', offer);

  //if (!offer) {
  //  res.status(400).send('Missing SDP offer');
  //}
  

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

      if (broadcasterTransport.closed) {
        await broadcasterTransport.connect({ dtlsParameters });
      }

      remoteSdp.send({
        offerMediaObject,
        reuseMid: mediaSectionIdx.reuseMid,
        offerRtpParameters: sendingRtpParameters,
        answerRtpParameters: sendingRemoteRtpParameters,
        codecOptions: {},
        extmapAllowMixed: true
      });

      //console.log('router capability: ', router.rtpCapabilities);
      //console.log('creating producer...: ', sendingRtpParameters);
      const producer = await broadcasterTransport.produce({
        kind: type as 'video' | 'audio',
        rtpParameters: sendingRtpParameters
      });

  
      //console.log('producer created: ', producer);

      //type === 'video'
      //  ? videoProducer = producer
      //  : audioProducer = producer;
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
  broadcasterTransport?.close();
  res.status(200)
    .send(`transport ${broadcasterTransport?.id} closed.`);
  console.log(`transport: ${broadcasterTransport?.id} closed.`);
});

app.get('/whip/test-broadcast', async (req, res) => {
  console.log('GET /whip/test-broadcast');
  res.status(200).send('GET request to /whip/test-broadcast');
})

app.post('/whip/test-broadcast', async (req, res) => {
  console.log('POST /whip/test-broadcast');
  res.status(200).send('POST request to /whip/test-broadcast');
});

app.patch('/whip/test-broadcast', async (req, res) => {
  console.log('PATCH /whip/test-broadcast');
  res.status(200).send('PATCH request to /whip/test-broadcast');
});


appWs.app.ws('/whip/test-broadcast', async (ws, req) => {
  console.log('websocket recieved');
  ws.on('open', () => {
    console.log('websocket opened!');
  });
  ws.on('upgrade', () => {
    console.log('websocket upgrade');
  });
  ws.on('unexpected-response', () => {
    console.log('websocket unexpecetd-response');
  });
  ws.on('message', msg => {
    console.log('message recieved: length ', msg.toString().length);
  });
});

startServer().catch(err => {
  console.error('Failed to start server: ', err);
});

