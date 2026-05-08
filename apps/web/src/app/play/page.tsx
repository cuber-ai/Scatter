import SlotMachine from "@/components/SlotMachine";

export default function PlayPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-purple-950/20 to-gray-950 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-4xl font-black text-center mb-8 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          🎰 Scatter Classic
        </h1>
        <SlotMachine />
      </div>
    </main>
  );
}
