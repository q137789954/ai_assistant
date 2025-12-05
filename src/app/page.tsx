import Wave from './page/compontent/Wave'


export default function Home() {
  return (
    <main className="min-h-screen w-full">
        <Wave height={100} fillColor="color-mix(in srgb, oklch(95% calc(var(--chromatic-chroma-50) * 0.5) var(--chromatic-hue)) 80%, oklch(100% 0 360))"/>
      </main>
  );
}
