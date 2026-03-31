import { useState } from 'react'
import './App.css'

const initialRegister = {
  username: '',
  email: '',
  password: '',
}

const initialLogin = {
  email: '',
  password: '',
}

const initialVerification = {
  email: '',
  code: '',
}

const query = new URLSearchParams(window.location.search)
const initialScreen = query.get('screen') || 'gallery'

function App() {
  const [screen, setScreen] = useState(initialScreen)
  const [registerForm, setRegisterForm] = useState(initialRegister)
  const [loginForm, setLoginForm] = useState(initialLogin)
  const [verificationForm, setVerificationForm] = useState(initialVerification)
  const [registerState, setRegisterState] = useState({ loading: false, result: 'Awaiting your command...', tone: '' })
  const [loginState, setLoginState] = useState(getInitialLoginState())
  const [verificationState, setVerificationState] = useState({ loading: false, result: 'Awaiting your command...', tone: '' })

  async function submit(path, payload, setter, onSuccess) {
    setter({ loading: true, result: 'Dispatching request to the citadel...', tone: '' })

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const contentType = response.headers.get('content-type') || ''
      const body = contentType.includes('application/json')
        ? await response.json()
        : await response.text()

      if (!response.ok) {
        setter({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      setter({
        loading: false,
        result: JSON.stringify(body, null, 2),
        tone: 'success',
      })

      if (onSuccess) {
        onSuccess(body)
      }
    } catch (error) {
      setter({
        loading: false,
        result: error instanceof Error ? error.message : 'Unexpected network error',
        tone: 'error',
      })
    }
  }

  function handleRegisterSubmit(event) {
    event.preventDefault()
    submit('/users/register', registerForm, setRegisterState, () => {
      setVerificationForm({ email: registerForm.email, code: '' })
      setLoginForm((current) => ({ ...current, email: registerForm.email }))
      setScreen('verify')
    })
  }

  function handleLoginSubmit(event) {
    setLoginState({ loading: true, result: 'Passing control to Spring Security...', tone: '' })
  }

  function handleVerificationSubmit(event) {
    event.preventDefault()
    submit('/users/verify-email', verificationForm, setVerificationState, () => {
      setScreen('login')
      setLoginForm((current) => ({ ...current, email: verificationForm.email }))
    })
  }

  return (
    <main className="war-room">
      <section className="citadel-shell">
        <div className="citadel-spire citadel-spire-left" aria-hidden="true" />
        <div className="citadel-spire citadel-spire-right" aria-hidden="true" />
        <div className="crown-rim crown-rim-left" aria-hidden="true" />
        <div className="crown-rim crown-rim-right" aria-hidden="true" />

        <section className="banner-panel">
          <div className="banner-actions">
            {screen === 'gallery' && (
              <button type="button" className="nav-pill nav-pill-compact" onClick={() => setScreen('login')}>
                Login
              </button>
            )}
          </div>
          <div className="banner-ornament" aria-hidden="true">
            <div className="frost-crown">
              <span className="frost-crown-spike spike-a" />
              <span className="frost-crown-spike spike-b" />
              <span className="frost-crown-spike spike-c" />
              <span className="frost-crown-spike spike-d" />
              <div className="frost-core" />
            </div>
          </div>

          <div className="banner-copy">
            <p className="overline">Nudes Protector</p>
            <h1>Gate of the Citadel</h1>
            <p className="subtitle">Account Registry and Entry Hall</p>
            <p className="lead">
              Browse the protected wing from the main hall. Sign in only when you want the blur lifted and full access granted.
            </p>
            <div className="status-strip">
              <span className="status-glyph" aria-hidden="true">I</span>
              <span>Linked to <strong>gallery</strong>, <strong>login</strong>, <strong>register</strong> and <strong>verify email</strong> flows</span>
            </div>
          </div>
        </section>

        <section className="screen-shell">
          {screen === 'gallery' && (
            <article className="command-panel gallery-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="gallery-heading">
                <div>
                  <p className="panel-label">Protected wing</p>
                  <h2>Gallery</h2>
                </div>
                <button type="button" className="link-button" onClick={() => setScreen('login')}>
                  Login to unlock
                </button>
              </div>
              <p className="panel-text">
                This is the main entry screen. After successful Spring Security login, the browser returns here and the gallery becomes the user landing point.
              </p>
              <div className="gallery-grid" aria-label="Gallery preview">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="gallery-card">
                    <div className="gallery-thumb" />
                    <div className="gallery-meta">
                      <strong>Vault Frame {index + 1}</strong>
                      <span>Blurred preview</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          )}

          {screen === 'login' && (
            <article className="command-panel single-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Main hall</p>
              <h2>Login</h2>
              <p className="panel-text">Enter with your email and password. Access remains blocked until email verification is complete.</p>

              <form className="auth-form" method="post" action="/login" onSubmit={handleLoginSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    name="username"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    name="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="StrongPass123!"
                    minLength="8"
                    required
                  />
                </label>

                <button type="submit" disabled={loginState.loading}>
                  {loginState.loading ? 'Verifying...' : 'Enter the Hall'}
                </button>
              </form>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => setScreen('register')}>
                  Register
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('gallery')}>
                  Back to gallery
                </button>
              </div>

              <pre className={`result-box ${loginState.tone}`}>{loginState.result}</pre>
            </article>
          )}

          {screen === 'register' && (
            <article className="command-panel single-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Create account</p>
              <h2>Register</h2>
              <p className="panel-text">Create the account first. After success, the next screen will ask for the verification code.</p>

              <form className="auth-form" onSubmit={handleRegisterSubmit}>
                <label>
                  <span>Username</span>
                  <input
                    type="text"
                    value={registerForm.username}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="warden"
                    minLength="3"
                    maxLength="50"
                    required
                  />
                </label>

                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={registerForm.password}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="StrongPass123!"
                    minLength="8"
                    required
                  />
                </label>

                <button type="submit" disabled={registerState.loading}>
                  {registerState.loading ? 'Binding...' : 'Seal the Account'}
                </button>
              </form>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => setScreen('login')}>
                  Back to login
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('gallery')}>
                  Back to gallery
                </button>
              </div>

              <pre className={`result-box ${registerState.tone}`}>{registerState.result}</pre>
            </article>
          )}

          {screen === 'verify' && (
            <article className="command-panel single-panel command-panel-accent">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Email verification</p>
              <h2>Enter code</h2>
              <p className="panel-text">Use the 6-digit code sent after registration. Once confirmed, you can return to the main login screen.</p>

              <form className="auth-form" onSubmit={handleVerificationSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={verificationForm.email}
                    onChange={(event) => setVerificationForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <label>
                  <span>Verification code</span>
                  <input
                    type="text"
                    value={verificationForm.code}
                    onChange={(event) => setVerificationForm((current) => ({ ...current, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="123456"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength="6"
                    required
                  />
                </label>

                <button type="submit" disabled={verificationState.loading}>
                  {verificationState.loading ? 'Confirming...' : 'Verify Email'}
                </button>
              </form>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => setScreen('login')}>
                  Back to login
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('register')}>
                  Back to register
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('gallery')}>
                  Back to gallery
                </button>
              </div>
              <pre className={`result-box ${verificationState.tone}`}>{verificationState.result}</pre>
            </article>
          )}
        </section>
      </section>
    </main>
  )
}

function formatResult(body, status) {
  if (typeof body === 'string') {
    return `HTTP ${status}\n${body}`
  }

  return `HTTP ${status}\n${JSON.stringify(body, null, 2)}`
}

export default App

function getInitialLoginState() {
  const error = query.get('error')

  if (error === 'bad_credentials') {
    return {
      loading: false,
      result: 'Invalid email or password.',
      tone: 'error',
    }
  }

  if (error === 'account_locked') {
    return {
      loading: false,
      result: 'Account is locked for 15 minutes after too many failed login attempts.',
      tone: 'error',
    }
  }

  if (error === 'email_not_verified') {
    return {
      loading: false,
      result: 'Email is not verified yet.',
      tone: 'error',
    }
  }

  return { loading: false, result: 'Awaiting your command...', tone: '' }
}
