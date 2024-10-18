import { Device } from 'mediasoup-client';

const baseUrl = 'https://faveo-systema.net/webrtc';
//const baseUrl = 'http://localhost/videmus/api';
//const baseUrl = 'http://localhost:3000'
//const idUrl = '/yellow-chart';
const idUrl = '';

export const createStream = async () => {
  const device = new Device();
  const routerRtpCapabilitiesResponse = await fetch(
    `${baseUrl}/mediasoup/router-rtp-capabilities${idUrl}`
  );
  const routerRtpCapabilities = await routerRtpCapabilitiesResponse.json();
  console.log('routerRtpCapabilities: %o', routerRtpCapabilities);
  await device.load({ routerRtpCapabilities });
  const transportParametersResponse = await fetch(
    `${baseUrl}/mediasoup/streamer-transport-parameters${idUrl}`
  );
  const transportParameters = await transportParametersResponse.json();
  console.log('transportParmaeters: %o', transportParameters);
  const transport = device.createRecvTransport(transportParameters);
  transport.on(
    'connect', 
    async ({ dtlsParameters }, callback, errback) => {
      console.log('transport connect');
      try {
        await fetch(
          `${baseUrl}/mediasoup/client-connect${idUrl}${idUrl ? '/'+transportParameters.id : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dtlsParameters),
        })
        callback();
      } catch (error) {
        errback(error);
      }
    }
  );
  transport.on('connectionstatechange', (newConnectionState) => {
    console.log('connection stage: ', newConnectionState);
  });

  const consumerParametersResponse = await fetch(
    `${baseUrl}/mediasoup/consumer-parameters${idUrl}${idUrl ? '/'+transportParameters.id : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device.rtpCapabilities),
  });
  const consumerParameters = await consumerParametersResponse.json();
  console.log('consumerParameters: %o', consumerParameters);
  let videoConsumer;
  let audioConsumer;
  if (idUrl) {
    const videoConsumerParameter = consumerParameters.find(p => p.kind === 'video');
    videoConsumer = videoConsumerParameter
      && await transport.consume(videoConsumerParameter);
    const audioConsumerParameter = consumerParameters.find(p => p.kind === 'audio');
    audioConsumer = audioConsumerParameter
      && await transport.consume(audioConsumerParameter);
  } else {
    videoConsumer = await transport.consume(consumerParameters.video);
    audioConsumer = await transport.consume(consumerParameters.audio);
  }
  return { videoConsumer, audioConsumer };
}

