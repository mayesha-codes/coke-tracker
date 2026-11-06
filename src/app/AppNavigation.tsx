import Icon from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'

export type AppView = 'home' | 'log' | 'history' | 'settings'

type AppNavigationProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
}

const navigationItems: { id: AppView; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'log', label: 'Log', icon: 'plus' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function AppNavigation({ activeView, onNavigate }: AppNavigationProps) {
  return (
    <nav className="app-navigation" aria-label="Primary navigation">
      {navigationItems.map((item) => (
        <button
          className="app-navigation__button"
          key={item.id}
          type="button"
          aria-current={activeView === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <Icon name={item.icon} size={22} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

export default AppNavigation
