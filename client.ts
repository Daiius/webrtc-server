import { Device } from 'mediasoup-client';
import mediasoup from 'mediasoup';
//import sdpTransform from 'sdp-transform';
//import ortc from 'mediasoup-client/lib/ortc';
//import sdpCommonUtils from 'mediasoup-client/lib/handlers/sdp/commonUtils';
//import sdpUnifiedPlanUtils from 'mediasoup-client/lib/handlers/sdp/unifiedPlanUtils';
//import { IceCandidate } from 'mediasoup/node/lib/fbs/web-rtc-transport';

export const createTransport = async () => {

  // 試験的に routerRtpCapabilities を元にしてみる
  // 実際にはコーデックなど幾つか記述するべきか？
  const routerCapabilityResponse =
    await fetch('http://localhost:3000/whep/router-capabilities');
  const routerRtpCapabilities: mediasoup.types.RtpCapabilities =
    await routerCapabilityResponse.json();

  // WHEP リクエスト
  const whepResponse = await fetch(
    'http://localhost:3000/whep', {
      method: 'POST',
      body: JSON.stringify(routerRtpCapabilities), 
    }
  );
  const offer = await whepResponse.text();
  
  const transportResponse = 
    await fetch('http://localhost:3000/whep/transport');
  const transportParameters = await transportResponse.json();
  

  const device = new Device();
  device.load({ routerRtpCapabilities });
  const transport = device.createRecvTransport(transportParameters);
  return transport;
}

