import { Device } from 'mediasoup-client';

export const createStream = async () => {
  const device = new Device();
  const routerRtpCapabilitiesResponse = await fetch(
    `http://localhost/videmus/api/mediasoup/router-rtp-capabilities/yellow-chart`
  );
  const routerRtpCapabilities = await routerRtpCapabilitiesResponse.json();
  console.log('routerRtpCapabilities: %o', routerRtpCapabilities);
  await device.load({ routerRtpCapabilities });
  const transportParametersResponse = await fetch(
    `http://localhost/videmus/api/mediasoup/streamer-transport-parameters/yellow-chart`
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
          `http://localhost/videmus/api/mediasoup/client-connect/yellow-chart/${transportParameters.id}`, {
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
    `http://localhost/videmus/api/mediasoup/consumer-parameters/yellow-chart/${transportParameters.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device.rtpCapabilities),
  });
  const consumerParameters = await consumerParametersResponse.json();
  const videoConsumerParameter = consumerParameters.find(p => p.kind === 'video');
  const videoConsumer = videoConsumerParameter
    && await transport.consume(videoConsumerParameter);
  const audioConsumerParameter = consumerParameters.find(p => p.kind === 'audio');
  const audioConsumer = audioConsumerParameter
    && await transport.consume(audioConsumerParameter);

  return { videoConsumer, audioConsumer };
}

