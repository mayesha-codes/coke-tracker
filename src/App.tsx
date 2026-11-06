import { useState } from 'react'
import AppShell from './app/AppShell'
import type { AppView } from './app/AppNavigation'
import Icon from './components/ui/Icon'
import type { IconName } from './components/ui/Icon'
import DashboardPage from './features/dashboard/DashboardPage'
import './App.css'

type PlaceholderDetails = {
  title: string
  icon: IconName
  introduction: string
  description: string
  planned: string[]
}

const placeholderDetails: Record<Exclude<AppView, 'home'>, PlaceholderDetails> = {
  log: {
    title: 'Log a drink',
    icon: 'plus',
    introduction: 'A little awareness starts with one entry.',
    description:
      'Your drink log is coming next. This will be your place to record a serving, its quantity, and when you had it.',
    planned: ['Serving size and quantity', 'Date and time', 'Price per entry'],
  },
  history: {
    title: 'History',
    icon: 'history',
    introduction: 'Your habits, with a little perspective.',
    description:
      'Once logging is available, your entries will live here. You will be able to browse your days and make corrections.',
    planned: ['Entries grouped by day', 'Edit or remove a drink', 'Clear, readable history'],
  },
  settings: {
    title: 'Settings',
    icon: 'settings',
    introduction: 'A goal that fits your day.',
    description:
      'Your personal preferences are coming next. You will be able to choose a daily limit and how your information is displayed.',
    planned: ['Your display name', 'Daily goal preferences', 'Currency and reporting preferences'],
  },
}

function App() {
  const [activeView, setActiveView] = useState<AppView>('home')
  const placeholder = activeView === 'home' ? null : placeholderDetails[activeView]

  return (
    <AppShell
      activeView={activeView}
      onNavigate={setActiveView}
      title={placeholder?.title ?? 'Home'}
    >
      {placeholder ? (
        <section className="view-placeholder" aria-labelledby="view-heading">
          <div className="view-placeholder__content">
            <span className="view-placeholder__icon">
              <Icon name={placeholder.icon} size={28} />
            </span>
            <p className="view-placeholder__eyebrow">Coming next</p>
            <h1 id="view-heading">{placeholder.title}</h1>
            <p className="view-placeholder__introduction">{placeholder.introduction}</p>
            <p className="view-placeholder__description">{placeholder.description}</p>
            <p className="view-placeholder__status">
              <Icon name="sparkles" size={16} />
              This feature is not implemented yet.
            </p>
            <button
              className="app-action"
              type="button"
              onClick={() => setActiveView('home')}
            >
              <Icon name="arrow-left" size={18} />
              Back to Home
            </button>
          </div>
          <div className="view-placeholder__roadmap">
            <p>On the roadmap</p>
            <ul>
              {placeholder.planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <DashboardPage />
      )}
    </AppShell>
  )
}

export default App
