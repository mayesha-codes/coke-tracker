export type IconName =
  | 'home'
  | 'plus'
  | 'history'
  | 'settings'
  | 'arrow-up-right'
  | 'arrow-left'
  | 'sparkles'
  | 'cup'

type IconProps = {
  name: IconName
  size?: number
  className?: string
}

const paths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  plus: 'M12 5v14M5 12h14',
  history: 'M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6M12 7v5l3 2',
  settings:
    'M9 4.2 10 2h4l1 2.2 2.3 1.3 2.4-.2 2 3.4-1.4 2v2.6l1.4 2-2 3.4-2.4-.2-2.3 1.3L14 22h-4l-1-2.2-2.3-1.3-2.4.2-2-3.4 1.4-2v-2.6l-1.4-2 2-3.4 2.4.2L9 4.2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  'arrow-up-right': 'M6 18 18 6M6 6h12v12',
  'arrow-left': 'M19 12H5m7 7-7-7 7-7',
  sparkles:
    'm12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6ZM20 17l.8 2.2L23 20l-2.2.8L20 23l-.8-2.2L17 20l2.2-.8L20 17Z',
  cup: 'M6 4h12l-1.5 16h-9L6 4ZM7 9h10',
}

function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className ? `app-icon ${className}` : 'app-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}

export default Icon
