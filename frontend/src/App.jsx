import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

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

function parseIdList(value) {
  return value
    .split(',')
    .map((chunk) => Number.parseInt(chunk.trim(), 10))
    .filter((num) => Number.isFinite(num) && num > 0)
}

function App() {
  const wsRef = useRef(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Ready.')

  const [classifications, setClassifications] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [drivers, setDrivers] = useState([])
  const [judges, setJudges] = useState([])

  const [selectedClassificationId, setSelectedClassificationId] = useState('')
  const [selectedCompetitionId, setSelectedCompetitionId] = useState('')
  const [classificationName, setClassificationName] = useState('')
  const [competitionName, setCompetitionName] = useState('')
  const [driverName, setDriverName] = useState('')
  const [driverNumber, setDriverNumber] = useState('')
  const [judgeName, setJudgeName] = useState('')

  const [assignDriverIds, setAssignDriverIds] = useState('')
  const [assignJudgeIds, setAssignJudgeIds] = useState('')

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

  const [qualifyingLeaderboard, setQualifyingLeaderboard] = useState([])
  const [battles, setBattles] = useState([])
  const [competitionStandings, setCompetitionStandings] = useState([])
  const [classificationStandings, setClassificationStandings] = useState([])

  const [lastRealtimeEvent, setLastRealtimeEvent] = useState('No events yet.')
  const [wsStatus, setWsStatus] = useState('disconnected')

  const currentCompetition = useMemo(
    () => competitions.find((item) => String(item.id) === String(selectedCompetitionId)),
    [competitions, selectedCompetitionId],
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
    const [lb, allBattles, standings] = await Promise.all([
      apiRequest(`/competitions/${competitionId}/qualifying/leaderboard`),
      apiRequest(`/competitions/${competitionId}/battles`),
      apiRequest(`/competitions/${competitionId}/standings`),
    ])
    setQualifyingLeaderboard(lb.leaderboard || [])
    setBattles(allBattles.battles || [])
    setCompetitionStandings(standings.standings || [])
  }

  async function loadClassificationStandings(classificationId) {
    if (!classificationId) {
      return
    }
    const payload = await apiRequest(`/classifications/${classificationId}/standings`)
    setClassificationStandings(payload.standings || [])
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
    if (selectedCompetitionId) {
      withAction(
        () => loadCompetitionData(selectedCompetitionId),
        `Loaded competition ${selectedCompetitionId} data.`,
      )
    } else {
      setQualifyingLeaderboard([])
      setBattles([])
      setCompetitionStandings([])
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
    const p1 = Number.parseFloat(battleDriver1Points)
    if (Number.isFinite(p1)) {
      setBattleDriver2Points(Number((10 - p1).toFixed(3)))
    }
  }, [battleDriver1Points])

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
    }, 'Classification created.')
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
    }, 'Competition created.')
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

  async function assignDrivers(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    await withAction(async () => {
      const driver_ids = parseIdList(assignDriverIds)
      await apiRequest(`/competitions/${selectedCompetitionId}/drivers`, {
        method: 'POST',
        body: { driver_ids },
      })
      setAssignDriverIds('')
      await loadLookups()
      await loadCompetitionData(selectedCompetitionId)
    }, 'Drivers assigned to competition.')
  }

  async function assignJudges(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    await withAction(async () => {
      const judge_ids = parseIdList(assignJudgeIds)
      await apiRequest(`/competitions/${selectedCompetitionId}/judges`, {
        method: 'POST',
        body: { judge_ids },
      })
      setAssignJudgeIds('')
      await loadLookups()
      await loadCompetitionData(selectedCompetitionId)
    }, 'Judges assigned to competition.')
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

  async function startTournament(event) {
    event.preventDefault()
    if (!selectedCompetitionId) return
    await withAction(async () => {
      await apiRequest(`/competitions/${selectedCompetitionId}/tournament/start`, {
        method: 'POST',
      })
      await loadLookups()
      await loadCompetitionData(selectedCompetitionId)
    }, 'Tournament started.')
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

  return (
    <main className="page">
      <header className="hero">
        <h1>Drift Master Dashboard (React)</h1>
        <p>
          Full competition control panel for qualifying, tournament battles, OMT, and
          standings.
        </p>
        <div className="status-row">
          <span>
            <strong>API base:</strong> {API_BASE || '(same-origin)'}
          </span>
          <span>
            <strong>WebSocket:</strong> {wsStatus}
          </span>
        </div>
        <div className="feedback">
          <div className="ok">{message}</div>
          {error ? <div className="err">{error}</div> : null}
        </div>
      </header>

      <section className="grid two">
        <article className="card">
          <h2>Classifications</h2>
          <form onSubmit={createClassification} className="row">
            <input
              value={classificationName}
              onChange={(event) => setClassificationName(event.target.value)}
              placeholder="Classification name (e.g. RMDS_2026)"
            />
            <button type="submit">Create</button>
          </form>
          <label>
            Active classification
            <select
              value={selectedClassificationId}
              onChange={(event) => setSelectedClassificationId(event.target.value)}
            >
              <option value="">Select classification</option>
              {classifications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} - {item.name} {item.is_closed ? '(closed)' : ''}
                </option>
              ))}
            </select>
          </label>
          <form onSubmit={closeClassification} className="row">
            <button type="submit" disabled={!selectedClassificationId}>
              Close classification
            </button>
            <button
              type="button"
              onClick={() =>
                withAction(
                  () => loadClassificationStandings(selectedClassificationId),
                  'Classification standings refreshed.',
                )
              }
              disabled={!selectedClassificationId}
            >
              Refresh standings
            </button>
          </form>
        </article>

        <article className="card">
          <h2>Competitions</h2>
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
          <label>
            Active competition
            <select
              value={selectedCompetitionId}
              onChange={(event) => setSelectedCompetitionId(event.target.value)}
            >
              <option value="">Select competition</option>
              {competitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} - {item.name} [{item.status}]
                </option>
              ))}
            </select>
          </label>
          <div className="pill">
            {currentCompetition
              ? `${currentCompetition.driver_count} drivers / ${currentCompetition.judge_count} judges`
              : 'No competition selected'}
          </div>
          <div className="row">
            <button type="button" onClick={connectSocket} disabled={!selectedCompetitionId}>
              Connect live
            </button>
            <button type="button" onClick={closeSocket}>
              Disconnect live
            </button>
            <button
              type="button"
              onClick={() =>
                withAction(
                  () => loadCompetitionData(selectedCompetitionId),
                  'Competition data refreshed.',
                )
              }
              disabled={!selectedCompetitionId}
            >
              Refresh
            </button>
          </div>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Create drivers and judges</h2>
          <form onSubmit={createDriver} className="row">
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
            <button type="submit">Add driver</button>
          </form>
          <form onSubmit={createJudge} className="row">
            <input
              value={judgeName}
              onChange={(event) => setJudgeName(event.target.value)}
              placeholder="Judge name"
            />
            <button type="submit">Add judge</button>
          </form>
          <div className="list-wrap">
            <div>
              <h3>Drivers</h3>
              <ul>
                {drivers.map((item) => (
                  <li key={item.id}>
                    #{item.number} - {item.name} (ID {item.id})
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Judges</h3>
              <ul>
                {judges.map((item) => (
                  <li key={item.id}>
                    {item.name} (ID {item.id})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>Assign to competition</h2>
          <form onSubmit={assignDrivers} className="stack">
            <label>
              Driver IDs (comma separated)
              <input
                value={assignDriverIds}
                onChange={(event) => setAssignDriverIds(event.target.value)}
                placeholder="1,2,3,4"
              />
            </label>
            <button type="submit" disabled={!selectedCompetitionId}>
              Assign drivers
            </button>
          </form>
          <form onSubmit={assignJudges} className="stack">
            <label>
              Judge IDs (comma separated)
              <input
                value={assignJudgeIds}
                onChange={(event) => setAssignJudgeIds(event.target.value)}
                placeholder="1,2,3"
              />
            </label>
            <button type="submit" disabled={!selectedCompetitionId}>
              Assign judges
            </button>
          </form>
          <form onSubmit={startTournament}>
            <button type="submit" disabled={!selectedCompetitionId}>
              Start tournament
            </button>
          </form>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Submit qualifying score</h2>
          <form onSubmit={submitQualifyingScore} className="row">
            <input
              type="number"
              value={qualDriverId}
              onChange={(event) => setQualDriverId(event.target.value)}
              placeholder="Driver ID"
            />
            <input
              type="number"
              value={qualJudgeId}
              onChange={(event) => setQualJudgeId(event.target.value)}
              placeholder="Judge ID"
            />
            <select value={qualRun} onChange={(event) => setQualRun(Number(event.target.value))}>
              <option value={1}>Run 1</option>
              <option value={2}>Run 2</option>
            </select>
            <input
              type="number"
              step="0.001"
              min="0"
              max="100"
              value={qualScore}
              onChange={(event) => setQualScore(event.target.value)}
              placeholder="Score"
            />
            <button type="submit" disabled={!selectedCompetitionId}>
              Submit
            </button>
          </form>

          <h3>Qualifying leaderboard</h3>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Driver</th>
                <th>Run1</th>
                <th>Run2</th>
                <th>Total</th>
                <th>Complete</th>
              </tr>
            </thead>
            <tbody>
              {qualifyingLeaderboard.map((item) => (
                <tr key={item.driver_id}>
                  <td>{item.rank}</td>
                  <td>
                    #{item.driver_number} {item.driver_name}
                  </td>
                  <td>{item.run1_avg}</td>
                  <td>{item.run2_avg}</td>
                  <td>{item.qualifying_score}</td>
                  <td>{item.is_complete ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card">
          <h2>Submit battle score</h2>
          <form onSubmit={submitBattleScore} className="row">
            <input
              type="number"
              value={battleId}
              onChange={(event) => setBattleId(event.target.value)}
              placeholder="Battle ID"
            />
            <input
              type="number"
              value={battleJudgeId}
              onChange={(event) => setBattleJudgeId(event.target.value)}
              placeholder="Judge ID"
            />
            <input
              type="number"
              min="0"
              value={battleOmtRound}
              onChange={(event) => setBattleOmtRound(event.target.value)}
              placeholder="OMT round"
            />
            <select
              value={battleRun}
              onChange={(event) => setBattleRun(Number(event.target.value))}
            >
              <option value={1}>Run 1</option>
              <option value={2}>Run 2</option>
            </select>
            <input
              type="number"
              step="0.001"
              min="0"
              max="10"
              value={battleDriver1Points}
              onChange={(event) => setBattleDriver1Points(event.target.value)}
              placeholder="Driver1 points"
            />
            <input
              type="number"
              step="0.001"
              min="0"
              max="10"
              value={battleDriver2Points}
              onChange={(event) => setBattleDriver2Points(event.target.value)}
              placeholder="Driver2 points"
            />
            <button type="submit">Submit</button>
          </form>

          <h3>Battles</h3>
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
                  <td>{item.status}</td>
                  <td>{item.winner_id || '-'}</td>
                  <td>{item.next_required_omt_round}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      <section className="grid two">
        <article className="card">
          <h2>Competition standings</h2>
          <table>
            <thead>
              <tr>
                <th>Place</th>
                <th>Driver</th>
                <th>Q rank</th>
                <th>Q score</th>
                <th>Comp points</th>
                <th>Q points</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {competitionStandings.map((item) => (
                <tr key={item.driver_id}>
                  <td>{item.final_place ?? '-'}</td>
                  <td>
                    #{item.driver_number} {item.driver_name}
                  </td>
                  <td>{item.qualifying_rank ?? '-'}</td>
                  <td>{item.qualifying_score}</td>
                  <td>{item.competition_points}</td>
                  <td>{item.qualifying_points}</td>
                  <td>{item.total_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="card">
          <h2>Global classification standings</h2>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Driver</th>
                <th>Events</th>
                <th>Raw total</th>
                <th>Effective total</th>
                <th>Drop lowest?</th>
              </tr>
            </thead>
            <tbody>
              {classificationStandings.map((item) => (
                <tr key={item.driver_id}>
                  <td>{item.rank}</td>
                  <td>
                    #{item.driver_number} {item.driver_name}
                  </td>
                  <td>{item.competitions_count}</td>
                  <td>{item.raw_total_points}</td>
                  <td>{item.effective_total_points}</td>
                  <td>{item.drop_lowest_applied ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      <section className="card">
        <h2>Last realtime event</h2>
        <pre>{lastRealtimeEvent}</pre>
      </section>

      <footer className="footer">
        <a href="/docs" target="_blank" rel="noreferrer">
          Open API docs
        </a>
        <button type="button" onClick={() => withAction(loadLookups, 'Lookups refreshed.')}>
          Refresh all base data
        </button>
      </footer>
    </main>
  )
}

export default App
