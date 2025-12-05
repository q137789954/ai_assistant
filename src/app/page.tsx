import Wave from './page/components/Wave'
import Live2DClient from './page/components/Live2DClient'


export default function Home() {
  return (
    <main className="h-full w-full relative flex flex-col">
        <Wave className='shrink-0' height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/>
        <div className="w-full h-full shrink grow">
          <Live2DClient />
        </div>
      </main>
  );
}
