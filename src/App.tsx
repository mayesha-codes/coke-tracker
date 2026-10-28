import sipshiftMark from './assets/sipshift-mark.svg'
import Brand from './components/Brand'
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="site-header">
        <Brand />
        <span className="status-badge">In development</span>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero__copy">
            <p className="eyebrow hero__eyebrow">A little less. A little better.</p>
            <h1 id="page-title">
              Small sips.
              <br />
              <span>Big shifts.</span>
            </h1>
            <p className="hero-description">
              Track your Coca-Cola consumption and build habits that work for you.
            </p>
            <a className="primary-link" href="#features-title">
              See what’s coming <span aria-hidden="true">↗</span>
            </a>
          </div>

          <div className="hero-art" aria-hidden="true">
            <span className="hero-art__ring" />
            <span className="hero-art__ring hero-art__ring--inner" />
            <div className="hero-art__disc">
              <img src={sipshiftMark} alt="" width="160" height="160" />
            </div>
            <span className="fizz-bubble fizz-bubble--one" />
            <span className="fizz-bubble fizz-bubble--two" />
            <span className="fizz-bubble fizz-bubble--three" />
            <span className="hero-art__caption">Room for a new rhythm.</span>
          </div>
        </section>

        <section className="setup-panel" aria-labelledby="setup-title">
          <span className="setup-panel__icon" aria-hidden="true">↗</span>
          <div>
            <p className="eyebrow">Welcome to SipShift</p>
            <h2 id="setup-title">Your tracking journey starts here.</h2>
            <p className="setup-panel__description">
              The app is taking shape. Drink logging and your personal dashboard
              are coming next.
            </p>
          </div>
        </section>

        <section className="planned-features" aria-labelledby="features-title">
          <div className="section-heading">
            <p className="eyebrow">A look ahead</p>
            <h2 id="features-title">Planned features</h2>
          </div>
          <div className="feature-grid">
            {plannedFeatures.map((feature, index) => (
              <article className="feature-card" key={feature.id}>
                <span className="feature-card__number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <Brand className="brand--footer" />
        <p>A personal portfolio project.</p>
      </footer>
    </div>
  )
}

export default App
