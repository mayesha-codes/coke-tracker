import './App.css'

const plannedFeatures = [
  {
    id: 'logging',
    title: 'Log your drinks',
    description:
      'Record each drink with its quantity, serving size, and date and time.',
  },
  {
    id: 'statistics',
    title: 'Understand your habits',
    description:
      'Explore daily, weekly, and monthly totals for Coke, spending, sugar, and calories.',
  },
  {
    id: 'goals',
    title: 'Follow your daily goal',
    description:
      'Set a personal daily limit and see a reminder when you go beyond it.',
  },
]

function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <p className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          Coke Tracker
        </p>
        <span className="status-badge">In development</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Small steps. Clear progress.</p>
          <h1 id="page-title">
            Make every sip <span>count.</span>
          </h1>
          <p className="hero-description">
            Track your Coca-Cola consumption and build habits that work for you.
          </p>
        </section>

        <section className="setup-panel" aria-labelledby="setup-title">
          <p className="eyebrow">Welcome to Coke Tracker</p>
          <h2 id="setup-title">Your tracking journey starts here.</h2>
          <p>
            The app is taking shape. Drink logging and your personal dashboard
            are coming next.
          </p>
        </section>

        <section className="planned-features" aria-labelledby="features-title">
          <h2 id="features-title">Planned features</h2>
          <div className="feature-grid">
            {plannedFeatures.map((feature) => (
              <article className="feature-card" key={feature.id}>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>Coke Tracker</p>
        <p>A personal portfolio project.</p>
      </footer>
    </div>
  )
}

export default App
