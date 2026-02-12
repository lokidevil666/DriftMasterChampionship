import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

const TABS = [
  { id: 'classifications', label: 'Classifications' },
  { id: 'competitions', label: 'Competitions' },
  { id: 'participants', label: 'Drivers and Judges' },
  { id: 'qualifying', label: 'Qualifying' },
  { id: 'battles', label: 'Battles' },
  { id: 'judge', label: 'Judge Scoring (Mobile)' },
  { id: 'standings', label: 'Standings' },
  { id: 'live', label: 'Live Feed' },
]

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const payload = await response.json()
      message = payload?.detail || JSON.stringify(payload)
    } catch {
      // keep fallback message
    }
    throw new Error(message)
  }
  return response.json()
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function statusClass(status) {
  if (status === 'completed') return 'tag tag-green'
  if (status === 'tournament') return 'tag tag-orange'
  return 'tag tag-blue'
}

function formatScore(value) {
  if (value === null || value === undefined || value === '') return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  return num.toFixed(2)
}

function battleStageLabel(stage) {
  if (stage === 'group') return 'Group Stage'
  if (stage === 'semifinal') return 'Semi-final'
  if (stage === 'third_place') return '3rd Place'
  if (stage === 'final') return 'Final'
  return stage
}

function App() {
  const wsRef = useRef(null)
  const [activeTab, setActiveTab] = useState('classifications')

  const [error, setError] = useState('')
  const [message, setMessage] = useState('Ready.')

  const [classifications, setClassifications] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [drivers, setDrivers] = useState([])
  const [judges, setJudges] = useState([])
  const [competitionDrivers, setCompetitionDrivers] = useState([])
  const [competitionJudges, setCompetitionJudges] = useState([])

  const [selectedClassificationId, setSelectedClassificationId] = useState('')
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('')

  const [classificationName, setClassificationName] = useState('')
  const [competitionName, setCompetitionName] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverNumber, setDriverNumber] = useState('')
  const [judgeName, setJudgeName] = useState('')

  const [assignDriverSelection, setAssignDriverSelection] = useState([])
  const [assignJudgeSelection, setAssignJudgeSelection] = useState([])

  const [qualDriverId, setQualDriverId] = useState('')
  const [qualJudgeId, setQualJudgeId] = useState('')
  const [qualRun, setQualRun] = useState(1)
  const [qualScore, setQualScore] = useState('')

  const [battleId, setBattleId] = useState('')
  const [battleJudgeId, setBattleJudgeId] = useState('')
  const [battleOmtRound, setBattleOmtRound] = useState(0)
  const [battleRun, setBattleRun] = useState(1)
  const [battleDriver1Points, setBattleDriver1Points] = useState(5)
  const [battleDriver2Points, setBattleDriver2Points] = useState(5)

  const [judgeScreenMode, setJudgeScreenMode] = useState('qualifying')
  const [judgeScreenJudgeId, setJudgeScreenJudgeId] = useState('')
  const [judgeScreenDriverId, setJudgeScreenDriverId] = useState('')
  const [judgeScreenRun, setJudgeScreenRun] = useState(1)
  const [judgeScreenQualScore, setJudgeScreenQualScore] = useState('')
  const [judgeScreenBattleId, setJudgeScreenBattleId] = useState('')
  const [judgeScreenBattleRun, setJudgeScreenBattleRun] = useState(1)
  const [judgeScreenBattleOmtRound, setJudgeScreenBattleOmtRound] = useState(0)
  const [judgeScreenDriver1Points, setJudgeScreenDriver1Points] = useState(5)
  const [judgeScreenDriver2Points, setJudgeScreenDriver2Points] = useState(5)

  const [qualifyingLeaderboard, setQualifyingLeaderboard] = useState([])
  const [battles, setBattles] = useState([])
  const [competitionStandings, setCompetitionStandings] = useState([])
  const [classificationStandings, setClassificationStandings] = useState([])

  const [lastRealtimeEvent, setLastRealtimeEvent] = useState('No events yet.')
  const [wsStatus, setWsStatus] = useState('disconnected')

  const selectedClassification = useMemo(
    () =>
      classifications.find(
        (item) => String(item.id) === String(selectedClassificationId),
      ),
    [classifications, selectedClassificationId],
  )

  const selectedCompetition = useMemo(
    () =>
      competitions.find((item) => String(item.id) === String(selectedCompetitionId)),
    [competitions, selectedCompetitionId],
  )

  const visibleCompetitions = useMemo(() => {
    if (!selectedClassificationId) return competitions
    return competitions.filter(
      (item) => String(item.classification_id) === String(selectedClassificationId),
    )
  }, [competitions, selectedClassificationId])

  const competitionDriverMap = useMemo(() => {
    const map = new Map()
    competitionDrivers.forEach((item) => {
      map.set(item.id, item)
    })
    return map
  }, [competitionDrivers])

  const pendingBattles = useMemo(
    () => battles.filter((item) => item.status === 'pending'),
    [battles],
  )

  async function loadLookups() {
    const [cls, comps, allDrivers, allJudges] = await Promise.all([
      apiRequest('/classifications'),
      apiRequest('/competitions'),
      apiRequest('/drivers'),
      apiRequest('/judges'),
    ])
    setClassifications(cls)
    setCompetitions(comps)
    setDrivers(allDrivers)
    setJudges(allJudges)
  }

  async function loadCompetitionData(competitionId) {
    if (!competitionId) {
      return
    }
    const [lb, allBattles, standings, compDrivers, compJudges] = await Promise.all([
      apiRequest(`/competitions/${competitionId}/qualifying/leaderboard`),
      apiRequest(`/competitions/${competitionId}/battles`),
      apiRequest(`/competitions/${competitionId}/standings`),
      apiRequest(`/competitions/${competitionId}/drivers`),
      apiRequest(`/competitions/${competitionId}/judges`),
    ])
    setQualifyingLeaderboard(lb.leaderboard || [])
    setBattles(allBattles.battles || [])
    setCompetitionStandings(standings.standings || [])
    setCompetitionDrivers(compDrivers || [])
    setCompetitionJudges(compJudges || [])
  }

  async function loadClassificationStandings(classificationId) {
    if (!classificationId) {
      return
    }
    const payload = await apiRequest(`/classifications/${classificationId}/standings`)
    setClassificationStandings(payload.standings || [])
  }

  async function refreshAllData() {
    await loadLookups()
    if (selectedCompetitionId) {
      await loadCompetitionData(selectedCompetitionId)
    }
    if (selectedClassificationId) {
      await loadClassificationStandings(selectedClassificationId)
    }
  }

  function handleError(err) {
    setError(err.message || String(err))
  }

  async function withAction(fn, okMessage) {
    try {
      setError('')
      await fn()
      setMessage(okMessage)
    } catch (err) {
      handleError(err)
    }
  }

  function closeSocket() {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }

  function buildWsUrl(competitionId) {
    if (API_BASE) {
      const wsBase = API_BASE.replace(/^http/, 'ws')
      return `${wsBase}/ws/competitions/${competitionId}/leaderboard`
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/ws/competitions/${competitionId}/leaderboard`
  }

  function connectSocket() {
    if (!selectedCompetitionId) {
      setError('Select a competition first.')
      return
    }

    closeSocket()
    setWsStatus('connecting')

    const socket = new WebSocket(buildWsUrl(selectedCompetitionId))
    wsRef.current = socket

    socket.onopen = () => {
      setWsStatus('connected')
      socket.send('subscribe')
    }
    socket.onclose = () => {
      setWsStatus('disconnected')
    }
    socket.onerror = () => {
      setWsStatus('error')
    }
    socket.onmessage = (event) => {
      let payload = event.data
      try {
        payload = JSON.parse(event.data)
      } catch {
        // keep raw text
      }

      if (payload?.qualifying_leaderboard) {
        setQualifyingLeaderboard(payload.qualifying_leaderboard)
      }
      if (payload?.leaderboard) {
        setQualifyingLeaderboard(payload.leaderboard)
      }
      if (payload?.battles) {
        setBattles(payload.battles)
      }
      if (payload?.competition_standings) {
        setCompetitionStandings(payload.competition_standings)
      }

      setLastRealtimeEvent(
        typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      )
    }
  }

  useEffect(() => {
    withAction(loadLookups, 'Loaded initial data.')
    return () => closeSocket()
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.pathname === '/judge') {
      setActiveTab('judge')
      return
    }
    const tabFromUrl = url.searchParams.get('tab')
    if (tabFromUrl && TABS.some((tab) => tab.id === tabFromUrl)) {
      setActiveTab(tabFromUrl)
    }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeTab)
    window.history.replaceState({}, '', url.toString())
  }, [activeTab])

  useEffect(() => {
    if (selectedCompetitionId) {
      withAction(
        () => loadCompetitionData(selectedCompetitionId),
        `Loaded competition ${selectedCompetitionId} data.`,
      )
    } else {
      setQualifyingLeaderboard([])
      setBattles([])
      setCompetitionStandings([])
      setCompetitionDrivers([])
      setCompetitionJudges([])
    }
  }, [selectedCompetitionId])

  useEffect(() => {
    if (selectedClassificationId) {
      withAction(
        () => loadClassificationStandings(selectedClassificationId),
        `Loaded classification ${selectedClassificationId} standings.`,
      )
    } else {
      setClassificationStandings([])
    }
  }, [selectedClassificationId])

  useEffect(() => {
    const p1 = toNumber(battleDriver1Points, 5)
    const clamped = Math.max(0, Math.min(10, p1))
    setBattleDriver2Points(Number((10 - clamped).toFixed(2)))
  }, [battleDriver1Points])

  useEffect(() => {
    const p1 = toNumber(judgeScreenDriver1Points, 5)
    const clamped = Math.max(0, Math.min(10, p1))
    setJudgeScreenDriver2Points(Number((10 - clamped).toFixed(2)))
  }, [judgeScreenDriver1Points])

  useEffect(() => {
    const selected = battles.find(
      (item) => String(item.id) === String(judgeScreenBattleId),
    )
    if (!selected) {
      return
    }
    setJudgeScreenBattleOmtRound(selected.next_required_omt_round ?? 0)
  }, [judgeScreenBattleId, battles])

  useEffect(() => {
    if (!qualDriverId && competitionDrivers.length > 0) {
      setQualDriverId(String(competitionDrivers[0].id))
    }
    if (!qualJudgeId && competitionJudges.length > 0) {
      setQualJudgeId(String(competitionJudges[0].id))
    }
    if (!battleJudgeId && competitionJudges.length > 0) {
      setBattleJudgeId(String(competitionJudges[0].id))
    }
    if (!judgeScreenJudgeId && competitionJudges.length > 0) {
      setJudgeScreenJudgeId(String(competitionJudges[0].id))
    }
    if (!judgeScreenDriverId && competitionDrivers.length > 0) {
      setJudgeScreenDriverId(String(competitionDrivers[0].id))
    }
    if (!judgeScreenBattleId && pendingBattles.length > 0) {
      setJudgeScreenBattleId(String(pendingBattles[0].id))
    }
  }, [
    competitionDrivers,
    competitionJudges,
    pendingBattles,
    qualDriverId,
    qualJudgeId,
    battleJudgeId,
    judgeScreenJudgeId,
    judgeScreenDriverId,
    judgeScreenBattleId,
  ])

  async function createClassification(event) {
    event.preventDefault()
    if (!classificationName.trim()) return

    await withAction(async () => {
      const created = await apiRequest('/classifications', {
        method: 'POST',
        body: { name: classificationName.trim() },
      })
      setClassificationName('')
      await loadLookups()
      setSelectedClassificationId(String(created.id))
      setActiveTab('competitions')
    }, 'Classification created.')
  }

  async function closeClassification(event) {
    event.preventDefault()
    if (!selectedClassificationId) return
    await withAction(async () => {
      await apiRequest(`/classifications/${selectedClassificationId}/close`, {
        method: 'POST',
      })
      await loadLookups()
      await loadClassificationStandings(selectedClassificationId)
    }, 'Classification closed and drop-lowest rule activated.')
  }

  async function createCompetition(event) {
    event.preventDefault()
    if (!competitionName.trim() || !selectedClassificationId) return

    await withAction(async () => {
      const created = await apiRequest('/competitions', {
        method: 'POST',
        body: {
          name: competitionName.trim(),
          classification_id: Number(selectedClassificationId),
        },
      })
      setCompetitionName('')
      await loadLookups()
      setSelectedCompetitionId(String(created.id))
      setActiveTab('participants')
    }, 'Competition created.')
  }

  function handleMultiSelect(event, setter) {
    const values = [...event.target.selectedOptions].map((option) =>
      Number(option.value),
    )
    setter(values)
  }

  async function assignDrivers(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    if (assignDriverSelection.length === 0) {
      setError('Select at least one driver to assign.')
      return
    }
    await withAction(async () => {
      await apiRequest(`/competitions/${selectedCompetitionId}/drivers`, {
        method: 'POST',
        body: { driver_ids: assignDriverSelection },
      })
      setAssignDriverSelection([])
      await refreshAllData()
    }, 'Drivers assigned to competition.')
  }

  async function assignJudges(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    if (assignJudgeSelection.length === 0) {
      setError('Select at least one judge to assign.')
      return
    }
    await withAction(async () => {
      await apiRequest(`/competitions/${selectedCompetitionId}/judges`, {
        method: 'POST',
        body: { judge_ids: assignJudgeSelection },
      })
      setAssignJudgeSelection([])
      await refreshAllData()
    }, 'Judges assigned to competition.')
  }

  async function startTournament(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    await withAction(async () => {
      await apiRequest(`/competitions/${selectedCompetitionId}/tournament/start`, {
        method: 'POST',
      })
      await refreshAllData()
      setActiveTab('battles')
    }, 'Tournament started.')
  }

  async function createDriver(event) {
    event.preventDefault()
    if (!driverName.trim() || !driverNumber) return
    await withAction(async () => {
      await apiRequest('/drivers', {
        method: 'POST',
        body: {
          name: driverName.trim(),
          number: Number(driverNumber),
        },
      })
      setDriverName('')
      setDriverNumber('')
      await loadLookups()
    }, 'Driver created.')
  }

  async function createJudge(event) {
    event.preventDefault()
    if (!judgeName.trim()) return
    await withAction(async () => {
      await apiRequest('/judges', {
        method: 'POST',
        body: { name: judgeName.trim() },
      })
      setJudgeName('')
      await loadLookups()
    }, 'Judge created.')
  }

  async function submitQualifyingScore(event) {
    event.preventDefault()
    if (!selectedCompetitionId || !qualDriverId || !qualJudgeId || qualScore === '') return
    await withAction(async () => {
      const payload = await apiRequest(
        `/competitions/${selectedCompetitionId}/qualifying/scores`,
        {
          method: 'POST',
          body: {
            driver_id: Number(qualDriverId),
            judge_id: Number(qualJudgeId),
            run_number: Number(qualRun),
            score: Number(qualScore),
          },
        },
      )
      setQualifyingLeaderboard(payload.leaderboard || [])
      setQualScore('')
    }, 'Qualifying score submitted.')
  }

  function prefillBattle(item) {
    setBattleId(String(item.id))
    setBattleOmtRound(item.next_required_omt_round ?? 0)
    setActiveTab('battles')
  }

  async function submitBattleScore(event) {
    event.preventDefault()
    if (!battleId || !battleJudgeId) return
    await withAction(async () => {
      await apiRequest(`/battles/${battleId}/scores`, {
        method: 'POST',
        body: {
          judge_id: Number(battleJudgeId),
          omt_round: Number(battleOmtRound),
          run_number: Number(battleRun),
          driver1_points: Number(battleDriver1Points),
          driver2_points: Number(battleDriver2Points),
        },
      })
      if (selectedCompetitionId) {
        await loadCompetitionData(selectedCompetitionId)
      }
    }, 'Battle score submitted.')
  }

  function driverDisplay(driverId) {
    const driver = competitionDriverMap.get(driverId)
    if (!driver) return `Driver ${driverId}`
    return `#${driver.number} - ${driver.name}`
  }

  async function submitJudgeQualifyingScore(event) {
    event.preventDefault()
    if (
      !selectedCompetitionId ||
      !judgeScreenJudgeId ||
      !judgeScreenDriverId ||
      judgeScreenQualScore === ''
    ) {
      setError('Select competition, judge, driver and score before submitting.')
      return
    }
    await withAction(async () => {
      const payload = await apiRequest(
        `/competitions/${selectedCompetitionId}/qualifying/scores`,
        {
          method: 'POST',
          body: {
            driver_id: Number(judgeScreenDriverId),
            judge_id: Number(judgeScreenJudgeId),
            run_number: Number(judgeScreenRun),
            score: Number(judgeScreenQualScore),
          },
        },
      )
      setQualifyingLeaderboard(payload.leaderboard || [])
      setJudgeScreenQualScore('')
      await loadCompetitionData(selectedCompetitionId)
    }, 'Judge score submitted for qualifying.')
  }

  async function submitJudgeBattleScore(event) {
    event.preventDefault()
    if (!judgeScreenBattleId || !judgeScreenJudgeId) {
      setError('Select battle and judge before submitting.')
      return
    }
    await withAction(async () => {
      await apiRequest(`/battles/${judgeScreenBattleId}/scores`, {
        method: 'POST',
        body: {
          judge_id: Number(judgeScreenJudgeId),
          omt_round: Number(judgeScreenBattleOmtRound),
          run_number: Number(judgeScreenBattleRun),
          driver1_points: Number(judgeScreenDriver1Points),
          driver2_points: Number(judgeScreenDriver2Points),
        },
      })
      if (selectedCompetitionId) {
        await loadCompetitionData(selectedCompetitionId)
      }
    }, 'Judge score submitted for battle.')
  }

  function renderGlobalSelectors() {
    return (
      <section className="context-panel card">
        <div className="context-grid">
          <label className="field">
            Active classification
            <select
              value={selectedClassificationId}
              onChange={(event) => setSelectedClassificationId(event.target.value)}
            >
              <option value="">Select classification</option>
              {classifications.map((item) => (
                <option key={item.id} value={item.id}>
                  #{item.id} - {item.name} {item.is_closed ? '(closed)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Active competition
            <select
              value={selectedCompetitionId}
              onChange={(event) => setSelectedCompetitionId(event.target.value)}
            >
              <option value="">Select competition</option>
              {visibleCompetitions.map((item) => (
                <option key={item.id} value={item.id}>
                  #{item.id} - {item.name} [{item.status}]
                </option>
              ))}
            </select>
          </label>

          <div className="field summary-chip">
            <span>WebSocket: {wsStatus}</span>
            <span>
              {selectedCompetition
                ? `${selectedCompetition.driver_count} drivers / ${selectedCompetition.judge_count} judges`
                : 'No competition selected'}
            </span>
          </div>
        </div>

        <div className="row">
          <button
            type="button"
            onClick={connectSocket}
            disabled={!selectedCompetitionId}
          >
            Connect live
          </button>
          <button type="button" onClick={closeSocket}>
            Disconnect live
          </button>
          <button
            type="button"
            onClick={() => withAction(refreshAllData, 'All data refreshed.')}
          >
            Refresh all data
          </button>
          <a className="docs-link" href="/docs" target="_blank" rel="noreferrer">
            API docs
          </a>
        </div>
      </section>
    )
  }

  function renderClassificationsTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Create classification</h2>
          <form onSubmit={createClassification} className="row">
            <input
              value={classificationName}
              onChange={(event) => setClassificationName(event.target.value)}
              placeholder="Classification name (example RMDS_2026)"
            />
            <button type="submit">Create</button>
          </form>
          <form onSubmit={closeClassification} className="row">
            <button type="submit" disabled={!selectedClassificationId}>
              Close active classification
            </button>
            <button
              type="button"
              disabled={!selectedClassificationId}
              onClick={() =>
                withAction(
                  () => loadClassificationStandings(selectedClassificationId),
                  'Classification standings refreshed.',
                )
              }
            >
              Refresh standings
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Classification list</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {classifications.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.name}</td>
                    <td>
                      <span className={item.is_closed ? 'tag tag-red' : 'tag tag-green'}>
                        {item.is_closed ? 'closed' : 'open'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setSelectedClassificationId(String(item.id))
                          setActiveTab('competitions')
                        }}
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    )
  }

  function renderCompetitionsTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Create competition</h2>
          <p className="hint">
            Create competition inside the selected classification.
          </p>
          <form onSubmit={createCompetition} className="row">
            <input
              value={competitionName}
              onChange={(event) => setCompetitionName(event.target.value)}
              placeholder="Competition name"
            />
            <button type="submit" disabled={!selectedClassificationId}>
              Create
            </button>
          </form>
          {!selectedClassificationId ? (
            <div className="notice">Select a classification first.</div>
          ) : null}
        </article>

        <article className="card">
          <h2>Competition list</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Classification</th>
                  <th>Status</th>
                  <th>Drivers</th>
                  <th>Judges</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleCompetitions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.name}</td>
                    <td>{item.classification_id}</td>
                    <td>
                      <span className={statusClass(item.status)}>{item.status}</span>
                    </td>
                    <td>{item.driver_count}</td>
                    <td>{item.judge_count}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setSelectedCompetitionId(String(item.id))
                          setActiveTab('participants')
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    )
  }

  function renderParticipantsTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Create drivers and judges</h2>
          <div className="split-grid">
            <form onSubmit={createDriver} className="stack">
              <h3>Add driver</h3>
              <input
                value={driverName}
                onChange={(event) => setDriverName(event.target.value)}
                placeholder="Driver name"
              />
              <input
                type="number"
                value={driverNumber}
                onChange={(event) => setDriverNumber(event.target.value)}
                placeholder="Unique number"
              />
              <button type="submit">Create driver</button>
            </form>

            <form onSubmit={createJudge} className="stack">
              <h3>Add judge</h3>
              <input
                value={judgeName}
                onChange={(event) => setJudgeName(event.target.value)}
                placeholder="Judge name"
              />
              <button type="submit">Create judge</button>
            </form>
          </div>

          <div className="split-grid">
            <div>
              <h3>Drivers ({drivers.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Number</th>
                      <th>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.number}</td>
                        <td>{item.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3>Judges ({judges.length})</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {judges.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>Assign to active competition</h2>
          {!selectedCompetitionId ? (
            <div className="notice">
              Select an active competition to assign drivers and judges.
            </div>
          ) : (
            <div className="split-grid">
              <form onSubmit={assignDrivers} className="stack">
                <h3>Select drivers</h3>
                <select
                  multiple
                  size={Math.min(10, Math.max(4, drivers.length))}
                  value={assignDriverSelection.map((item) => String(item))}
                  onChange={(event) => handleMultiSelect(event, setAssignDriverSelection)}
                >
                  {drivers.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.number} - {item.name} (ID {item.id})
                    </option>
                  ))}
                </select>
                <button type="submit">Assign selected drivers</button>
              </form>

              <form onSubmit={assignJudges} className="stack">
                <h3>Select judges</h3>
                <select
                  multiple
                  size={Math.min(10, Math.max(4, judges.length))}
                  value={assignJudgeSelection.map((item) => String(item))}
                  onChange={(event) => handleMultiSelect(event, setAssignJudgeSelection)}
                >
                  {judges.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (ID {item.id})
                    </option>
                  ))}
                </select>
                <button type="submit">Assign selected judges</button>
              </form>
            </div>
          )}

          <div className="row">
            <button
              type="button"
              onClick={() => setActiveTab('qualifying')}
              disabled={!selectedCompetitionId}
            >
              Go to qualifying tab
            </button>
          </div>
        </article>
      </section>
    )
  }

  function renderQualifyingTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Qualifying score entry</h2>
          <p className="hint">Qualifying result uses the best run out of 2 runs.</p>
          {!selectedCompetitionId ? (
            <div className="notice">Select an active competition first.</div>
          ) : (
            <form onSubmit={submitQualifyingScore} className="row">
              <label className="field-inline">
                Driver
                <select
                  value={qualDriverId}
                  onChange={(event) => setQualDriverId(event.target.value)}
                >
                  {competitionDrivers.map((item) => (
                    <option key={item.id} value={item.id}>
                      #{item.number} - {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-inline">
                Judge
                <select
                  value={qualJudgeId}
                  onChange={(event) => setQualJudgeId(event.target.value)}
                >
                  {competitionJudges.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-inline">
                Run
                <select
                  value={qualRun}
                  onChange={(event) => setQualRun(Number(event.target.value))}
                >
                  <option value={1}>Run 1</option>
                  <option value={2}>Run 2</option>
                </select>
              </label>

              <label className="field-inline">
                Score
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={qualScore}
                  onChange={(event) => setQualScore(event.target.value)}
                  placeholder="0 - 100"
                />
              </label>
              <button type="submit">Submit score</button>
            </form>
          )}
        </article>

        <article className="card">
          <h2>Qualifying leaderboard</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Driver</th>
                  <th>Run 1 avg</th>
                  <th>Run 2 avg</th>
                  <th>Best run (counts)</th>
                  <th>Complete</th>
                </tr>
              </thead>
              <tbody>
                {qualifyingLeaderboard.map((item) => (
                  <tr key={item.driver_id}>
                    <td>{item.rank}</td>
                    <td>
                      #{item.driver_number} - {item.driver_name}
                    </td>
                    <td>{formatScore(item.run1_avg)}</td>
                    <td>{formatScore(item.run2_avg)}</td>
                    <td>{formatScore(item.qualifying_score)}</td>
                    <td>{item.is_complete ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={startTournament}
              disabled={!selectedCompetitionId}
            >
              Start tournament
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('battles')}
              disabled={!selectedCompetitionId}
            >
              Go to battles tab
            </button>
          </div>
        </article>
      </section>
    )
  }

  function renderBattlesTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Battle scoring</h2>
          {!selectedCompetitionId ? (
            <div className="notice">Select an active competition first.</div>
          ) : (
            <form onSubmit={submitBattleScore} className="row">
              <label className="field-inline">
                Battle ID
                <input
                  type="number"
                  value={battleId}
                  onChange={(event) => setBattleId(event.target.value)}
                  placeholder="Battle ID"
                />
              </label>

              <label className="field-inline">
                Judge
                <select
                  value={battleJudgeId}
                  onChange={(event) => setBattleJudgeId(event.target.value)}
                >
                  {competitionJudges.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-inline">
                OMT round
                <input
                  type="number"
                  min="0"
                  value={battleOmtRound}
                  onChange={(event) => setBattleOmtRound(event.target.value)}
                />
              </label>

              <label className="field-inline">
                Run
                <select
                  value={battleRun}
                  onChange={(event) => setBattleRun(Number(event.target.value))}
                >
                  <option value={1}>Run 1</option>
                  <option value={2}>Run 2</option>
                </select>
              </label>

              <label className="field-inline">
                Driver 1 points
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.01"
                  value={battleDriver1Points}
                  onChange={(event) => setBattleDriver1Points(event.target.value)}
                />
              </label>

              <label className="field-inline">
                Driver 2 points
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.01"
                  value={battleDriver2Points}
                  onChange={(event) => setBattleDriver2Points(event.target.value)}
                />
              </label>

              <button type="submit">Submit battle score</button>
            </form>
          )}
        </article>

        <article className="card">
          <h2>Battle list</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Stage</th>
                  <th>Group</th>
                  <th>Pair</th>
                  <th>Status</th>
                  <th>Winner</th>
                  <th>Next OMT</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {battles.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.stage}</td>
                    <td>{item.group_name || '-'}</td>
                    <td>
                      {item.driver1_id} vs {item.driver2_id}
                    </td>
                    <td>
                      <span className={statusClass(item.status)}>{item.status}</span>
                    </td>
                    <td>{item.winner_id || '-'}</td>
                    <td>{item.next_required_omt_round}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => prefillBattle(item)}
                      >
                        Score this battle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    )
  }

  function renderJudgeTab() {
    const selectedBattle = battles.find(
      (item) => String(item.id) === String(judgeScreenBattleId),
    )

    return (
      <section className="tab-grid">
        <article className="card judge-mobile-card">
          <h2>Judge scoring screen (mobile)</h2>
          <p className="hint">
            Open this tab on each judge phone and submit scores quickly. This works
            for qualifying and every battle phase.
          </p>
          {!selectedCompetitionId ? (
            <div className="notice">
              Select an active competition to open judge scoring.
            </div>
          ) : (
            <>
              <div className="judge-toggle">
                <button
                  type="button"
                  className={
                    judgeScreenMode === 'qualifying'
                      ? 'tab-btn tab-btn-active'
                      : 'tab-btn'
                  }
                  onClick={() => setJudgeScreenMode('qualifying')}
                >
                  Qualifying
                </button>
                <button
                  type="button"
                  className={
                    judgeScreenMode === 'battles' ? 'tab-btn tab-btn-active' : 'tab-btn'
                  }
                  onClick={() => setJudgeScreenMode('battles')}
                >
                  Battles
                </button>
              </div>

              <label className="field">
                Judge
                <select
                  value={judgeScreenJudgeId}
                  onChange={(event) => setJudgeScreenJudgeId(event.target.value)}
                >
                  {competitionJudges.map((judge) => (
                    <option key={judge.id} value={judge.id}>
                      {judge.name} (ID {judge.id})
                    </option>
                  ))}
                </select>
              </label>

              {judgeScreenMode === 'qualifying' ? (
                <form onSubmit={submitJudgeQualifyingScore} className="judge-form">
                  <label className="field">
                    Driver
                    <select
                      value={judgeScreenDriverId}
                      onChange={(event) => setJudgeScreenDriverId(event.target.value)}
                    >
                      {competitionDrivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          #{driver.number} - {driver.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    Run
                    <select
                      value={judgeScreenRun}
                      onChange={(event) => setJudgeScreenRun(Number(event.target.value))}
                    >
                      <option value={1}>Run 1</option>
                      <option value={2}>Run 2</option>
                    </select>
                  </label>

                  <label className="field">
                    Score (0 to 100)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={judgeScreenQualScore}
                      onChange={(event) => setJudgeScreenQualScore(event.target.value)}
                      placeholder="Enter score"
                    />
                  </label>

                  <button type="submit" className="judge-submit-btn">
                    Submit qualifying score
                  </button>
                </form>
              ) : (
                <form onSubmit={submitJudgeBattleScore} className="judge-form">
                  <label className="field">
                    Battle
                    <select
                      value={judgeScreenBattleId}
                      onChange={(event) => setJudgeScreenBattleId(event.target.value)}
                    >
                      {pendingBattles.length === 0 ? (
                        <option value="">No pending battles</option>
                      ) : (
                        pendingBattles.map((battle) => (
                          <option key={battle.id} value={battle.id}>
                            #{battle.id} - {battleStageLabel(battle.stage)} -{' '}
                            {driverDisplay(battle.driver1_id)} vs{' '}
                            {driverDisplay(battle.driver2_id)}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <label className="field">
                    OMT round
                    <input
                      type="number"
                      min="0"
                      value={judgeScreenBattleOmtRound}
                      onChange={(event) =>
                        setJudgeScreenBattleOmtRound(event.target.value)
                      }
                    />
                  </label>

                  <label className="field">
                    Run
                    <select
                      value={judgeScreenBattleRun}
                      onChange={(event) =>
                        setJudgeScreenBattleRun(Number(event.target.value))
                      }
                    >
                      <option value={1}>Run 1</option>
                      <option value={2}>Run 2</option>
                    </select>
                  </label>

                  <div className="judge-score-split">
                    <label className="field">
                      Driver 1 points
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        value={judgeScreenDriver1Points}
                        onChange={(event) =>
                          setJudgeScreenDriver1Points(event.target.value)
                        }
                      />
                    </label>
                    <label className="field">
                      Driver 2 points
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.01"
                        value={judgeScreenDriver2Points}
                        onChange={(event) =>
                          setJudgeScreenDriver2Points(event.target.value)
                        }
                      />
                    </label>
                  </div>

                  {selectedBattle ? (
                    <div className="notice">
                      Selected: {battleStageLabel(selectedBattle.stage)} |{' '}
                      {driverDisplay(selectedBattle.driver1_id)} vs{' '}
                      {driverDisplay(selectedBattle.driver2_id)} | next OMT:{' '}
                      {selectedBattle.next_required_omt_round}
                    </div>
                  ) : null}

                  <button type="submit" className="judge-submit-btn">
                    Submit battle score
                  </button>
                </form>
              )}
            </>
          )}
        </article>

        <article className="card">
          <h2>Quick battle queue</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Battle</th>
                  <th>Stage</th>
                  <th>Pair</th>
                  <th>Status</th>
                  <th>Next OMT</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {battles.map((battle) => (
                  <tr key={battle.id}>
                    <td>#{battle.id}</td>
                    <td>{battleStageLabel(battle.stage)}</td>
                    <td>
                      {driverDisplay(battle.driver1_id)} vs{' '}
                      {driverDisplay(battle.driver2_id)}
                    </td>
                    <td>
                      <span className={statusClass(battle.status)}>{battle.status}</span>
                    </td>
                    <td>{battle.next_required_omt_round}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        disabled={battle.status === 'completed'}
                        onClick={() => {
                          setJudgeScreenMode('battles')
                          setJudgeScreenBattleId(String(battle.id))
                        }}
                      >
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    )
  }

  function renderStandingsTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Competition standings</h2>
          {!selectedCompetitionId ? (
            <div className="notice">Select a competition to see final standings.</div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Driver</th>
                  <th>Q rank</th>
                  <th>Q score</th>
                  <th>Competition points</th>
                  <th>Qualifying points</th>
                  <th>Total points</th>
                </tr>
              </thead>
              <tbody>
                {competitionStandings.map((item) => (
                  <tr key={item.driver_id}>
                    <td>{item.final_place ?? '-'}</td>
                    <td>
                      #{item.driver_number} - {item.driver_name}
                    </td>
                    <td>{item.qualifying_rank ?? '-'}</td>
                    <td>{formatScore(item.qualifying_score)}</td>
                    <td>{formatScore(item.competition_points)}</td>
                    <td>{formatScore(item.qualifying_points)}</td>
                    <td>{formatScore(item.total_points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h2>Global classification standings</h2>
          {!selectedClassificationId ? (
            <div className="notice">Select a classification to load its global table.</div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Driver</th>
                  <th>Events</th>
                  <th>Raw total</th>
                  <th>Effective total</th>
                  <th>Drop lowest applied</th>
                </tr>
              </thead>
              <tbody>
                {classificationStandings.map((item) => (
                  <tr key={item.driver_id}>
                    <td>{item.rank}</td>
                    <td>
                      #{item.driver_number} - {item.driver_name}
                    </td>
                    <td>{item.competitions_count}</td>
                    <td>{formatScore(item.raw_total_points)}</td>
                    <td>{formatScore(item.effective_total_points)}</td>
                    <td>{item.drop_lowest_applied ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!selectedClassificationId}
              onClick={() =>
                withAction(
                  () => loadClassificationStandings(selectedClassificationId),
                  'Global standings refreshed.',
                )
              }
            >
              Refresh global standings
            </button>
          </div>
        </article>
      </section>
    )
  }

  function renderLiveTab() {
    return (
      <section className="tab-grid">
        <article className="card">
          <h2>Realtime stream</h2>
          <div className="row">
            <span className="tag tag-blue">socket status: {wsStatus}</span>
            <span className="tag tag-blue">
              active competition: {selectedCompetitionId || 'none'}
            </span>
          </div>
          <pre>{lastRealtimeEvent}</pre>
        </article>
      </section>
    )
  }

  function renderTabContent() {
    if (activeTab === 'classifications') return renderClassificationsTab()
    if (activeTab === 'competitions') return renderCompetitionsTab()
    if (activeTab === 'participants') return renderParticipantsTab()
    if (activeTab === 'qualifying') return renderQualifyingTab()
    if (activeTab === 'battles') return renderBattlesTab()
    if (activeTab === 'judge') return renderJudgeTab()
    if (activeTab === 'standings') return renderStandingsTab()
    return renderLiveTab()
  }

  return (
    <main className="page">
      <header className="hero card">
        <div className="hero-title-row">
          <div>
            <p className="kicker">Drift Master Competition System</p>
            <h1>Championship Control Center</h1>
            <p className="hero-subtext">
              Manage classifications, competitions, qualifying, battles, and live
              standings from one place.
            </p>
          </div>
          <div className="hero-meta">
            <span className="tag tag-blue">API: {API_BASE || 'same-origin'}</span>
            <span className="tag tag-blue">Competition: {selectedCompetitionId || 'none'}</span>
            <span className="tag tag-blue">
              Classification: {selectedClassificationId || 'none'}
            </span>
          </div>
        </div>

        <div className="feedback">
          <div className="ok">{message}</div>
          {error ? <div className="err">{error}</div> : null}
        </div>
      </header>

      {renderGlobalSelectors()}

      <nav className="tabs card" aria-label="Main sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn ${activeTab === tab.id ? 'tab-btn-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="tab-content">{renderTabContent()}</section>

      <footer className="footer">
        <div>
          Active classification:{' '}
          <strong>{selectedClassification?.name || 'None selected'}</strong>
        </div>
        <div>
          Active competition:{' '}
          <strong>{selectedCompetition?.name || 'None selected'}</strong>
        </div>
      </footer>
    </main>
  )
}

export default App
