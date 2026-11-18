import { useId } from 'react'
import { ENGLISH_DISPLAY_LOCALE } from '../preferences/preferences'
import './CalorieGlass.css'

/** A visual vessel size only; it is independent of the user's daily volume goal. */
export const GLASS_CAPACITY_ML = 500

const numberFormat = new Intl.NumberFormat(ENGLISH_DISPLAY_LOCALE, { maximumFractionDigits: 2 })

function formatNumber(value: number): string {
  return numberFormat.format(value)
}

interface CalorieGlassProps {
  /** Today's actual consumed volume from the daily reporting summary. */
  volumeMl: number
  /** Today's Coke-only calorie estimate from the saved nutrition snapshots. */
  kcal: number
}

function CalorieGlass({ volumeMl, kcal }: CalorieGlassProps) {
  const generatedId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const glassId = `sipshift-glass-${generatedId}`
  const safeVolume = Number.isFinite(volumeMl) ? Math.max(0, volumeMl) : 0
  const safeKcal = Number.isFinite(kcal) ? Math.max(0, kcal) : 0
  const fillPercent = Math.min(100, safeVolume / GLASS_CAPACITY_ML * 100)
  const liquidTravelPx = 198 * (1 - fillPercent / 100)
  const aboveCapacityMl = Math.max(0, safeVolume - GLASS_CAPACITY_ML)
  const glassDescription = aboveCapacityMl > 0
    ? `Glass visual showing ${formatNumber(safeVolume)} millilitres consumed today. It is filled to its illustrative ${formatNumber(GLASS_CAPACITY_ML)} millilitre capacity; ${formatNumber(aboveCapacityMl)} millilitres are above the visual capacity. This is not a drink limit.`
    : `Glass visual showing ${formatNumber(safeVolume)} millilitres consumed today, at ${formatNumber(fillPercent)} percent of its illustrative ${formatNumber(GLASS_CAPACITY_ML)} millilitre visual capacity. This is not a drink limit.`

  return (
    <section className="dashboard-glass" aria-labelledby={`${glassId}-heading`}>
      <div className="dashboard-glass__visual-column">
        <p className="dashboard-eyebrow">A visual of today's volume</p>
        <div className="dashboard-glass__visual" role="img" aria-label={glassDescription}>
          <svg className="dashboard-glass__svg" viewBox="0 0 240 340" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={`${glassId}-cola`} x1="0" x2="0.15" y1="0" y2="1">
                <stop offset="0" stopColor="#5b201b" />
                <stop offset="0.28" stopColor="#351613" />
                <stop offset="1" stopColor="#120f13" />
              </linearGradient>
              <linearGradient id={`${glassId}-edge`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.66" />
                <stop offset="0.16" stopColor="#ffffff" stopOpacity="0.1" />
                <stop offset="0.76" stopColor="#ffffff" stopOpacity="0.04" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.52" />
              </linearGradient>
              <linearGradient id={`${glassId}-ice`} x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.77" />
                <stop offset="0.45" stopColor="#dce7f6" stopOpacity="0.3" />
                <stop offset="1" stopColor="#9aaecb" stopOpacity="0.13" />
              </linearGradient>
              <linearGradient id={`${glassId}-shine`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.34" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${glassId}-inside`}>
                <path d="M64 51 C67 112 70 254 78 292 C82 309 158 309 162 292 C170 254 173 112 176 51 Z" />
              </clipPath>
            </defs>

            <ellipse cx="120" cy="318" rx="68" ry="10" fill="#000000" opacity="0.4" />
            <g clipPath={`url(#${glassId}-inside)`}>
              <g
                className="dashboard-glass__liquid"
                data-testid="glass-fill-level"
                data-fill-percent={fillPercent}
                style={{ transform: `translateY(${liquidTravelPx}px)`, opacity: fillPercent === 0 ? 0 : 1 }}
              >
                <path
                  className="dashboard-glass__liquid-body"
                  d="M56 94 C80 87 100 98 122 92 C145 85 165 97 184 90 L184 320 L56 320 Z"
                  fill={`url(#${glassId}-cola)`}
                />
                <path d="M58 96 C82 89 101 100 123 94 C145 88 165 99 182 92" fill="none" stroke="#e9a58a" strokeOpacity="0.44" strokeWidth="2" />

                <g className="dashboard-glass__ice" fill={`url(#${glassId}-ice)`} stroke="#ffffff" strokeOpacity="0.5">
                  <path d="M78 105 L97 100 L108 111 L105 132 L85 136 L75 124 Z" />
                  <path d="M119 97 L141 101 L146 121 L133 136 L114 130 L110 111 Z" />
                  <path d="M147 113 L164 108 L171 124 L164 142 L147 139 L141 126 Z" opacity="0.74" />
                  <path d="M80 108 L95 104 M120 101 L138 105 M149 116 L162 112" fill="none" stroke="#ffffff" strokeOpacity="0.57" strokeWidth="2" />
                </g>

                <g className="dashboard-glass__bubbles" fill="none" stroke="#f5c5a7" strokeWidth="1.4">
                  <circle className="dashboard-glass__bubble dashboard-glass__bubble--one" cx="93" cy="177" r="3.4" />
                  <circle className="dashboard-glass__bubble dashboard-glass__bubble--two" cx="143" cy="201" r="2.5" />
                  <circle className="dashboard-glass__bubble dashboard-glass__bubble--three" cx="116" cy="240" r="2" />
                  <circle className="dashboard-glass__bubble dashboard-glass__bubble--four" cx="157" cy="260" r="3" />
                </g>
              </g>
              <path d="M70 60 C75 133 76 231 83 284" fill="none" stroke={`url(#${glassId}-shine)`} strokeWidth="9" opacity="0.56" />
            </g>

            <path d="M48 38 C51 119 55 266 66 299 C72 319 168 319 174 299 C185 266 189 119 192 38" fill="#ffffff" fillOpacity="0.025" stroke={`url(#${glassId}-edge)`} strokeWidth="3" />
            <ellipse cx="120" cy="39" rx="72" ry="13" fill="#ffffff" fillOpacity="0.08" stroke="#ffffff" strokeOpacity="0.72" strokeWidth="2" />
            <ellipse cx="120" cy="42" rx="64" ry="7" fill="#111116" fillOpacity="0.44" stroke="#ffffff" strokeOpacity="0.17" />
            <path d="M53 54 C57 138 61 250 70 291" fill="none" stroke="#ffffff" strokeOpacity="0.34" strokeWidth="2" />
            <path d="M187 54 C183 142 180 244 170 290" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2" />
            <path d="M91 306 C107 312 134 312 149 306" fill="none" stroke="#ffffff" strokeOpacity="0.38" strokeWidth="2" />
            <path d="M80 72 C84 111 84 143 85 160" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeLinecap="round" strokeWidth="3" />
          </svg>
          <span className="dashboard-glass__accent" aria-hidden="true" />
        </div>
        <p className="dashboard-glass__capacity">Visual capacity: {formatNumber(GLASS_CAPACITY_ML)} ml</p>
      </div>

      <div className="dashboard-glass__details">
        <p className="dashboard-eyebrow">Coke, made visible</p>
        <h2 id={`${glassId}-heading`}>Today's Coke glass</h2>
        <dl className="dashboard-glass__metrics">
          <div>
            <dt>Consumed today</dt>
            <dd>{formatNumber(safeVolume)} <small>ml</small></dd>
          </div>
          <div>
            <dt>Estimated Coke-only calories</dt>
            <dd>{formatNumber(safeKcal)} <small>kcal</small></dd>
          </div>
        </dl>
        {aboveCapacityMl > 0 ? (
          <p className="dashboard-glass__note">
            The glass is visually full. {formatNumber(aboveCapacityMl)} ml is above its visual capacity; your full consumed volume is still shown.
          </p>
        ) : (
          <p className="dashboard-glass__note">
            Liquid height follows consumed volume. Glass capacity is only a visual reference, not a daily drink limit.
          </p>
        )}
      </div>
    </section>
  )
}

export default CalorieGlass
