import React from 'react';

import { createStream } from './client';

const App: React.FC = () => {
  const videoRef = React.useRef<HTMLVideoElement>();
  React.useEffect(() => {
    (async () => {
      const videoStream = await createStream();
            

      if (videoRef.current) {
        const stream = new MediaStream();
        stream.addTrack(videoStream.track);
        videoRef.current.srcObject = stream;
        videoRef.current.play();
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

