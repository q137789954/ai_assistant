import Chatbot from './page/components/Chatbot'
// import Wave from './page/components/Wave'


export default function Home() {
  return (
    <main className="h-full w-full relative flex flex-col relative">
        {/* <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/> */}
        <div className="w-full h-full shrink grow">
          {/* <Live2DClient /> */}
        </div>
        <div className='absolute bottom-4 right-4 w-120 h-dvh py-16  pointer-events-auto'>
          <Chatbot />
        </div>
      </main>
  );
}
