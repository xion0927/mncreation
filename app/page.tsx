import ScorePlayer from "@/components/score-player";

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <p className="text-sm font-semibold tracking-wide text-emerald-700">
            MUSIC WORKSPACE
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            楽譜プレイヤー
          </h1>
          <p className="mt-3 max-w-2xl text-stone-600">
            MusicXMLを読み込み、楽譜を見ながらピアノ音で再生できます。
          </p>
        </header>
        <ScorePlayer />
      </div>
    </main>
  );
}
