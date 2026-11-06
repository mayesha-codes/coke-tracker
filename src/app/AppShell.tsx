import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import Brand from '../components/Brand'
import Icon from '../components/ui/Icon'
import AppNavigation from './AppNavigation'
import type { AppView } from './AppNavigation'
import './AppShell.css'

type AppShellProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
  title: string
  children: ReactNode
}

function AppShell({ activeView, onNavigate, title, children }: AppShellProps) {
  const mainRef = useRef<HTMLElement>(null)
  const previousView = useRef(activeView)

  useEffect(() => {
    if (previousView.current !== activeView) {
      previousView.current = activeView
      mainRef.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
  }, [activeView])

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="workspace-sidebar" aria-label="SipShift workspace">
        <div className="workspace-sidebar__identity">
          <Brand />
          <p>Small sips. Big shifts.</p>
        </div>
        <p className="workspace-sidebar__section">Your space</p>
        <AppNavigation activeView={activeView} onNavigate={onNavigate} />
        <div className="workspace-sidebar__note">
          <Icon name="sparkles" size={22} />
          <p>One small shift<br />at a time.</p>
          <span>New tools for mindful habits are on the way.</span>
        </div>
        <p className="workspace-sidebar__footer">A fresh perspective, every day.</p>
      </aside>

      <div className="workspace-content">
        <header className="workspace-topbar">
          <div className="workspace-topbar__mobile-brand">
            <Brand />
          </div>
          <div className="workspace-topbar__location">
            <span>Your daily reset</span>
            <p>{title}</p>
          </div>
          <span className="workspace-status">In development</span>
        </header>

        <main
          className="workspace-main"
          id="main-content"
          aria-labelledby="view-heading"
          tabIndex={-1}
          ref={mainRef}
        >
          {children}
        </main>

        <footer className="workspace-footer">
          <span>Small sips. Big shifts.</span>
          <span>A personal portfolio project.</span>
        </footer>
      </div>
    </div>
  )
}

export default AppShell
