import sipshiftMark from '../../assets/sipshift-mark.svg'
import Icon from '../../components/ui/Icon'
import './DashboardPage.css'

const plannedFeatures = [
  {
    id: 'logging',
    title: 'Log your drinks',
    description:
      'Record each drink with its quantity, serving size, and date and time.',
    icon: 'plus',
  },
  {
    id: 'statistics',
    title: 'Understand your habits',
    description:
      'Explore daily, weekly, and monthly totals for Coke, spending, sugar, and calories.',
    icon: 'history',
  },
  {
    id: 'goals',
    title: 'Follow your daily goal',
    description:
      'Set a personal daily limit and see a reminder when you go beyond it.',
    icon: 'settings',
  },
] as const

function DashboardPage() {
  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome" aria-labelledby="view-heading">
        <div className="dashboard-welcome__copy">
          <p className="dashboard-eyebrow dashboard-welcome__eyebrow">
            A little less. A little better.
          </p>
          <h1 id="view-heading">
            Small sips.
            <br />
            <span>Big shifts.</span>
          </h1>
          <p className="dashboard-welcome__description">
            Track your Coca-Cola consumption and build habits that work for you.
          </p>
          <a className="dashboard-welcome__link" href="#features-title">
            See what’s coming
            <Icon name="arrow-up-right" size={18} />
          </a>
        </div>

        <div className="dashboard-fizz" aria-hidden="true">
          <span className="dashboard-fizz__orbit" />
          <span className="dashboard-fizz__orbit dashboard-fizz__orbit--inner" />
          <div className="dashboard-fizz__disc">
            <img src={sipshiftMark} alt="" width="144" height="144" />
          </div>
          <span className="dashboard-fizz__bubble dashboard-fizz__bubble--one" />
          <span className="dashboard-fizz__bubble dashboard-fizz__bubble--two" />
          <span className="dashboard-fizz__bubble dashboard-fizz__bubble--three" />
          <span className="dashboard-fizz__caption">Room for a new rhythm.</span>
        </div>
      </section>

      <section className="dashboard-setup" aria-labelledby="setup-title">
        <span className="dashboard-setup__icon" aria-hidden="true">
          <Icon name="sparkles" size={24} />
        </span>
        <div>
          <p className="dashboard-eyebrow">Welcome to SipShift</p>
          <h2 id="setup-title">Your tracking journey starts here.</h2>
          <p className="dashboard-setup__description">
            Drink logging is available for this session. Your personal dashboard
            is coming next.
          </p>
        </div>
      </section>

      <section className="dashboard-features" aria-labelledby="features-title">
        <div className="dashboard-features__heading">
          <div>
            <p className="dashboard-eyebrow">A look ahead</p>
            <h2 id="features-title">Planned features</h2>
          </div>
          <span className="dashboard-features__label">Coming next</span>
        </div>

        <div className="dashboard-features__grid">
          {plannedFeatures.map((feature, index) => (
            <article className="dashboard-feature" key={feature.id}>
              <div className="dashboard-feature__top">
                <span className="dashboard-feature__icon">
                  <Icon name={feature.icon} size={20} />
                </span>
                <span className="dashboard-feature__number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default DashboardPage
