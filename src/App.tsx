import { useState } from 'react'
import AppShell from './app/AppShell'
import type { AppView } from './app/AppNavigation'
import { useSession } from './app/session/sessionContext'
import DashboardPage from './features/dashboard/DashboardPage'
import HistoryPage from './features/history/HistoryPage'
import LogPage from './features/logging/LogPage'
import PreferencesPage from './features/preferences/PreferencesPage'
import './App.css'

function App() {
  const { state, addEntry, lastEntryResult } = useSession()
  const [activeView, setActiveView] = useState<AppView>('home')
  const [hasVisitedLog, setHasVisitedLog] = useState(false)
  const { currency, reportingTimeZone } = state.preferences
  const draftKey = JSON.stringify([currency, reportingTimeZone])
  const [draftPreferences, setDraftPreferences] = useState({ key: draftKey, wasReset: false })

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
      title={activeView === 'log' ? 'Log a drink' : activeView === 'settings' ? 'Settings' : activeView === 'history' ? 'History' : 'Home'}
    >
      {/* Keep only the Log view mounted offscreen so its local draft survives navigation. */}
      <div hidden={activeView !== 'log'} inert={activeView !== 'log'}>
        {hasVisitedLog && (
          <LogPage
            key={draftKey}
            currency={currency}
            timeZone={reportingTimeZone}
            personalNutrition={state.personalNutrition}
            entries={state.entries}
            headingId={activeView === 'log' ? 'view-heading' : 'log-view-heading'}
            draftWasReset={draftPreferences.wasReset}
            addEntry={addEntry}
            lastEntryResult={lastEntryResult}
            isActive={activeView === 'log'}
          />
        )}
      </div>
      {activeView === 'settings' ? <PreferencesPage hasLogDraft={hasVisitedLog} /> : activeView === 'history' ? (
        <HistoryPage entries={state.entries} timeZone={reportingTimeZone} />
      ) : activeView === 'home' ? (
        <DashboardPage />
      ) : null}
    </AppShell>
  )
}

export default App
