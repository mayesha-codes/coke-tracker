import { useState } from 'react'
import AppShell from './app/AppShell'
import type { AppView } from './app/AppNavigation'
import { useSession } from './app/session/sessionContext'
import Icon from './components/ui/Icon'
import type { IconName } from './components/ui/Icon'
import DashboardPage from './features/dashboard/DashboardPage'
import LogPage from './features/logging/LogPage'
import PreferencesPage from './features/preferences/PreferencesPage'
import './App.css'

type PlaceholderDetails = {
  title: string
  icon: IconName
  introduction: string
  description: string
  planned: string[]
}

const placeholderDetails: Record<'history', PlaceholderDetails> = {
  history: {
    title: 'History',
    icon: 'history',
    introduction: 'Your habits, with a little perspective.',
    description:
      'Your drinks can now be saved for this session in Log. Browsing past days and making corrections will come later.',
    planned: ['Entries grouped by day', 'Edit or remove a drink', 'Clear, readable history'],
  },
}

function App() {
  const { state, addEntry, lastEntryResult } = useSession()
  const [activeView, setActiveView] = useState<AppView>('home')
  const [hasVisitedLog, setHasVisitedLog] = useState(false)
  const { currency, reportingTimeZone } = state.preferences
  const draftKey = JSON.stringify([currency, reportingTimeZone])
  const [draftPreferences, setDraftPreferences] = useState({ key: draftKey, wasReset: false })
  const placeholder = activeView === 'history' ? placeholderDetails.history : null

  // Track an actual change before rendering the new draft, even while Log is hidden.
  if (draftPreferences.key !== draftKey) {
    setDraftPreferences({ key: draftKey, wasReset: hasVisitedLog || draftPreferences.wasReset })
  }

  function navigate(view: AppView) {
    if (view === 'log') setHasVisitedLog(true)
    setActiveView(view)
  }

  return (
    <AppShell
      activeView={activeView}
      onNavigate={navigate}
      title={activeView === 'log' ? 'Log a drink' : activeView === 'settings' ? 'Settings' : placeholder?.title ?? 'Home'}
    >
      {/* Keep only the Log view mounted offscreen so its local draft survives navigation. */}
      <div hidden={activeView !== 'log'} inert={activeView !== 'log'}>
        {hasVisitedLog && (
          <LogPage
            key={draftKey}
            currency={currency}
            timeZone={reportingTimeZone}
            personalNutrition={state.personalNutrition}
            headingId={activeView === 'log' ? 'view-heading' : 'log-view-heading'}
            draftWasReset={draftPreferences.wasReset}
            addEntry={addEntry}
            lastEntryResult={lastEntryResult}
            isActive={activeView === 'log'}
          />
        )}
      </div>
      {activeView === 'settings' ? <PreferencesPage hasLogDraft={hasVisitedLog} /> : placeholder ? (
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
              onClick={() => navigate('home')}
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
      ) : activeView === 'home' ? (
        <DashboardPage />
      ) : null}
    </AppShell>
  )
}

export default App
