export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-6 pt-24 pb-20">
        <div className="flex items-center gap-3 mb-8">
          <Logo />
        </div>

        <h1 className="text-4xl sm:text-5xl font-bold text-center max-w-2xl leading-tight tracking-tight">
          Delegate outcomes.{" "}
          <span className="text-[var(--green-accent)]">Track runs.</span>{" "}
          Approve writes.
        </h1>

        <p className="mt-6 text-lg text-[var(--text-secondary)] text-center max-w-xl">
          FlowSpace works across Gmail, Calendar, Drive, Tasks, and Sheets.
          Tell it what you want done, watch progress live, and keep control
          with explicit approval checkpoints before any write action.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <a
            href="/api/download"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white bg-[var(--green-accent)] hover:bg-[var(--green-muted)] transition-colors"
          >
            <AppleIcon />
            Download for macOS
          </a>

          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] font-mono text-sm text-[var(--text-secondary)]">
            <span>$</span>
            <code>npx flowspace-ai@latest</code>
          </div>
        </div>

        <p className="mt-4 text-xs text-[var(--text-secondary)]">
          Requires macOS. Free and open-source.
        </p>
      </section>

      {/* Features */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            title="Delegate Outcomes"
            description="Give one objective and let FlowSpace coordinate the required steps across your Google tools."
          />
          <FeatureCard
            title="Live Run Tracking"
            description="See each run move from queued to completed with progress and clear status at every step."
          />
          <FeatureCard
            title="Approval Checkpoints"
            description="All write actions stop for explicit approval before FlowSpace sends, updates, or creates anything."
          />
          <FeatureCard
            title="Smart Inbox Triage"
            description="Pre-triaged inbox shows what needs your reply, what needs input, and what can wait."
          />
          <FeatureCard
            title="Follow-up Tracker"
            description="Never drop the ball. Track follow-ups across email, calendar, and tasks with snooze and auto-complete."
          />
          <FeatureCard
            title="Native macOS App"
            description="Built with Tauri v2. Fast, lightweight, and runs natively — not another Electron app."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 pb-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold mb-6">How FlowSpace works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              title="1. Delegate"
              description="Describe the outcome, not the sequence of clicks."
            />
            <FeatureCard
              title="2. Track"
              description="Monitor run progress and tool execution in real time."
            />
            <FeatureCard
              title="3. Approve"
              description="Confirm write actions at explicit checkpoints before execution."
            />
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="px-6 pb-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Get started in seconds</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 font-mono text-left">
            <p className="text-[var(--text-secondary)] text-sm mb-2">
              # Install via npm
            </p>
            <p className="text-[var(--green-accent)]">
              npx flowspace-ai@latest
            </p>
          </div>
          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            Or{" "}
            <a
              href="/api/download"
              className="text-[var(--green-accent)] hover:underline"
            >
              download the .dmg directly
            </a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] px-6 py-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-sm text-[var(--text-secondary)]">
          <p>&copy; {new Date().getFullYear()} FlowSpace</p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/melrefaiy2018/FlowSpace"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="p-5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--green-accent)]/30 transition-colors">
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
        {description}
      </p>
    </div>
  );
}

function Logo() {
  return (
    <svg width="203" height="48" viewBox="0 0 202.89438 48" fill="none">
      <rect width="48" height="48" rx="12" fill="#0d2818" />
      <path d="M16,16H32" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
      <path d="M16,24H28" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
      <circle cx="34" cy="24" r="2" fill="#22c55e" />
      <path d="m16,32h8" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" />
      <text x="60" y="33" fill="#ededed" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="24px" letterSpacing="-0.02em">
        <tspan fill="#22c55e">FlowSpace</tspan>
      </text>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}
