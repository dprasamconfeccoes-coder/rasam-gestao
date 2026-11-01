import { useState, type ReactNode } from 'react'
import { CalendarClock, Clock3, FileSpreadsheet, Fingerprint } from 'lucide-react'
import './point-management.css'

type PointManagementTab = 'equipe' | 'importacoes' | 'jornadas'

const tabs: Array<{ id: PointManagementTab; label: string; icon: typeof Clock3 }> = [
  { id: 'equipe', label: 'Ponto da equipe', icon: Fingerprint },
  { id: 'importacoes', label: 'Importações', icon: FileSpreadsheet },
  { id: 'jornadas', label: 'Jornadas', icon: CalendarClock },
]

export function PointManagementDashboard({ team, imports, schedules }: {
  team: (refreshSignal: number) => ReactNode
  imports: ReactNode
  schedules: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<PointManagementTab>('equipe')
  const [visited, setVisited] = useState<Set<PointManagementTab>>(() => new Set(['equipe']))
  const [teamRefreshSignal, setTeamRefreshSignal] = useState(0)
  const panels: Record<PointManagementTab, ReactNode> = { equipe: team(teamRefreshSignal), importacoes: imports, jornadas: schedules }

  function selectTab(next: PointManagementTab) {
    setActiveTab(next)
    setVisited((current) => new Set(current).add(next))
    if (next === 'equipe') setTeamRefreshSignal((current) => current + 1)
  }

  return <div className="point-management-workspace">
    <nav className="point-management-tabs" role="tablist" aria-label="Seções da gestão de ponto">
      {tabs.map(({ id, label, icon: Icon }) => <button
        key={id}
        className={`point-management-tab${activeTab === id ? ' is-active' : ''}`}
        type="button"
        role="tab"
        id={`point-tab-${id}`}
        aria-controls={`point-panel-${id}`}
        aria-selected={activeTab === id}
        tabIndex={activeTab === id ? 0 : -1}
        onClick={() => selectTab(id)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
          event.preventDefault()
          const index = tabs.findIndex((tab) => tab.id === activeTab)
          const direction = event.key === 'ArrowRight' ? 1 : -1
          const next = tabs[(index + direction + tabs.length) % tabs.length]
          selectTab(next.id)
          document.getElementById(`point-tab-${next.id}`)?.focus()
        }}
      ><Icon size={16} /><span>{label}</span></button>)}
    </nav>
    {tabs.map(({ id }) => <section
      key={id}
      className="point-management-panel"
      id={`point-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`point-tab-${id}`}
      hidden={activeTab !== id}
      tabIndex={0}
    >{visited.has(id) ? panels[id] : null}</section>)}
  </div>
}
