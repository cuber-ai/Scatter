import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-purple-950/20 to-gray-950">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <div className="mb-6">
          <span className="inline-block px-4 py-1 text-sm font-semibold rounded-full bg-purple-600/20 text-purple-300 border border-purple-500/30 mb-4">
            🇵🇭 Philippines #1 Slot Platform
          </span>
        </div>
        <h1 className="text-6xl md:text-8xl font-black mb-6 bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400 bg-clip-text text-transparent neon-text">
          ScatterX
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mb-8">
          Spin to win. Real jackpots. Instant payouts via GCash &amp; Maya.
          Provably fair with cryptographic verification.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/play"
            className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:from-purple-500 hover:to-pink-500 transition-all neon-glow-purple"
          >
            🎰 Play Now
          </Link>
          <Link
            href="/auth/register"
            className="px-8 py-4 glass rounded-xl font-bold text-lg hover:bg-white/10 transition-all"
          >
            Create Account
          </Link>
        </div>
      </section>

      {/* Jackpot Tickers */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10 text-amber-400 neon-text">
            🏆 Live Jackpots
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { tier: "Mini", color: "from-blue-600 to-cyan-600", icon: "💙" },
              { tier: "Major", color: "from-purple-600 to-pink-600", icon: "💜" },
              { tier: "Mega", color: "from-amber-600 to-orange-600", icon: "🧡" },
              { tier: "Progressive", color: "from-red-600 to-rose-600", icon: "❤️" },
            ].map(({ tier, color, icon }) => (
              <div key={tier} className="glass p-4 text-center">
                <div className="text-2xl mb-1">{icon}</div>
                <div className="text-sm text-gray-400 font-medium">{tier}</div>
                <div
                  className={`text-xl font-black bg-gradient-to-r ${color} bg-clip-text text-transparent`}
                >
                  ₱ Loading…
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6">
          {[
            {
              icon: "🔐",
              title: "Provably Fair",
              desc: "Cryptographic RNG with on-chain verification. Every spin auditable.",
            },
            {
              icon: "⚡",
              title: "Instant Payouts",
              desc: "GCash and Maya withdrawals processed in minutes.",
            },
            {
              icon: "🧠",
              title: "AI Rewards",
              desc: "Personalized bonuses powered by ML – free spins, cashback, VIP boosts.",
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="glass p-6 hover:bg-white/10 transition-all">
              <div className="text-4xl mb-4">{icon}</div>
              <h3 className="text-xl font-bold mb-2">{title}</h3>
              <p className="text-gray-400">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
