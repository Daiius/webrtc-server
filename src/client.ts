import { Device } from 'mediasoup-client';

export const createStream = async () => {
  const device = new Device();
  const routerRtpCapabilitiesResponse = await fetch(
    'http://localhost:3000/mediasoup/router-rtp-capabilities'
  );
  const routerRtpCapabilities = await routerRtpCapabilitiesResponse.json();
  console.log('routerRtpCapabilities: %o', routerRtpCapabilities);
  await device.load({ routerRtpCapabilities });
  const transportParametersResponse = await fetch(
    'http://localhost:3000/mediasoup/streamer-transport-parameters'
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
          'http://localhost:3000/mediasoup/client-connect', {
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
    'http://localhost:3000/mediasoup/consumer-parameters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device.rtpCapabilities),
  });
  const consumerParameters = await consumerParametersResponse.json();
  const videoConsumer = await transport.consume(consumerParameters.video);
  const audioConsumer = await transport.consume(consumerParameters.audio);
  

  return { videoConsumer, audioConsumer };
}

