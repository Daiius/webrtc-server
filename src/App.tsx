import React from 'react';

import { createStream } from './client';

const App: React.FC = () => {
  const videoRef = React.useRef<HTMLVideoElement>();
  React.useEffect(() => {
    (async () => {
      try {
        const { videoConsumer, audioConsumer } = await createStream();
              
        if (videoRef.current) {
          const stream = new MediaStream();
          stream.addTrack(videoConsumer.track);
          stream.addTrack(audioConsumer.track);
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          console.log('video play() called!');
        }
      } catch (err) {
        console.error('error while initializing video: ', err);
      }

    })();
  }, []);

  return (
    <div>
      <div>Hello, Vite!</div>
      <video 
        className='w-full'
        ref={videoRef} 
        autoPlay playsInline controls muted
      >
      </video>
    </div>
  );
};

export default App;

