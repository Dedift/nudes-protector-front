import { useEffect, useState } from 'react'
import './App.css'

const defaultApiBaseUrl = window.location.origin === 'http://localhost:3000'
  ? 'http://localhost:8081'
  : ''
const apiBaseUrl = (process.env.REACT_APP_API_BASE_URL || defaultApiBaseUrl).trim().replace(/\/$/, '')
const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/

const initialRegister = {
  username: '',
  email: '',
  password: '',
  mfaEnabled: false,
}

const initialLogin = {
  email: '',
  password: '',
  rememberMe: false,
}

const initialVerification = {
  email: '',
  code: '',
}

const initialMfaVerification = {
  email: '',
  code: '',
}

const initialOttRequest = {
  email: '',
}

const initialOttVerification = {
  token: '',
}

const query = new URLSearchParams(window.location.search)
const initialScreen = resolveInitialScreen(query)

function App() {
  const [screen, setScreen] = useState(initialScreen)
  const [registerForm, setRegisterForm] = useState(initialRegister)
  const [loginForm, setLoginForm] = useState(initialLogin)
  const [verificationForm, setVerificationForm] = useState(initialVerification)
  const [mfaForm, setMfaForm] = useState(initialMfaVerification)
  const [ottRequestForm, setOttRequestForm] = useState(initialOttRequest)
  const [ottForm, setOttForm] = useState(initialOttVerification)
  const [registerState, setRegisterState] = useState({ loading: false, result: 'Awaiting your command...', tone: '' })
  const [loginState, setLoginState] = useState(getInitialLoginState())
  const [verificationState, setVerificationState] = useState({ loading: false, result: 'Awaiting your command...', tone: '' })
  const [mfaState, setMfaState] = useState({ loading: false, result: 'Awaiting your command...', tone: '' })
  const [ottRequestState, setOttRequestState] = useState({ loading: false, result: 'Passwordless channel is idle.', tone: '' })
  const [ottState, setOttState] = useState({ loading: false, result: 'Awaiting one-time token...', tone: '' })
  const [sessionState, setSessionState] = useState({ loading: true, authenticated: false })
  const [passkeyState, setPasskeyState] = useState({ loading: false, result: 'Passkey vault is idle.', tone: '' })
  const [passkeys, setPasskeys] = useState([])
  const [csrfState, setCsrfState] = useState({ headerName: '', parameterName: '', token: '' })

  useEffect(() => {
    bootstrap()
  }, [])

  useEffect(() => {
    syncScreenQuery(screen)
  }, [screen])

  async function submit(path, payload, setter, onSuccess) {
    setter({ loading: true, result: 'Dispatching request to the citadel...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify(payload),
      })

      const body = await readResponseBody(response)

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
        result: formatResult(body, response.status),
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

  async function bootstrap() {
    try {
      await fetchCsrfToken()
      await refreshSession()
    } catch (error) {
      setPasskeys([])
      setSessionState({ loading: false, authenticated: false })
      setLoginState((current) => current.tone
        ? current
        : {
            loading: false,
            result: error instanceof Error ? error.message : 'Backend is unavailable.',
            tone: 'error',
          })
    }
  }

  async function fetchCsrfToken() {
    const response = await apiFetch('/csrf')
    const body = await readResponseBody(response)

    if (!response.ok) {
      throw new Error(formatResult(body, response.status))
    }

    setCsrfState(body)
    return body
  }

  async function ensureCsrfToken() {
    if (csrfState.token) {
      return csrfState
    }
    return fetchCsrfToken()
  }

  function csrfHeaders(csrf) {
    return csrf?.token
      ? { [csrf.headerName]: csrf.token }
      : {}
  }

  async function refreshSession() {
    setSessionState((current) => ({ ...current, loading: true }))

    try {
      const response = await apiFetch('/users/me/passkeys')

      if (response.ok) {
        const body = await readResponseBody(response)
        setPasskeys(Array.isArray(body) ? body : [])
        setSessionState({ loading: false, authenticated: true })
        return true
      }

      if (response.status === 401 || response.status === 403) {
        setPasskeys([])
        setSessionState({ loading: false, authenticated: false })
        return false
      }

      setSessionState({ loading: false, authenticated: false })
      return false
    } catch (_) {
      setSessionState({ loading: false, authenticated: false })
      return false
    }
  }

  async function loadPasskeys() {
    setPasskeyState({ loading: true, result: 'Inspecting registered passkeys...', tone: '' })

    try {
      const response = await apiFetch('/users/me/passkeys')
      const body = await readResponseBody(response)

      if (!response.ok) {
        setPasskeyState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        if (response.status === 401 || response.status === 403) {
          setSessionState({ loading: false, authenticated: false })
        }
        return
      }

      setPasskeys(Array.isArray(body) ? body : [])
      setSessionState({ loading: false, authenticated: true })
      setPasskeyState({
        loading: false,
        result: (Array.isArray(body) ? body.length : 0) === 0
          ? 'No passkeys linked yet.'
          : `Loaded ${body.length} passkey${body.length === 1 ? '' : 's'}.`,
        tone: 'success',
      })
    } catch (error) {
      setPasskeyState({
        loading: false,
        result: error instanceof Error ? error.message : 'Unexpected network error',
        tone: 'error',
      })
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault()
    const payload = {
      username: registerForm.username.trim(),
      email: normalizeEmail(registerForm.email),
      password: registerForm.password,
      mfaEnabled: registerForm.mfaEnabled,
    }

    submit('/users/register', payload, setRegisterState, () => {
      setVerificationForm({ email: payload.email, code: '' })
      setLoginForm((current) => ({ ...current, email: payload.email }))
      setOttRequestForm({ email: payload.email })
      setScreen('verify')
    })
  }

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setLoginState({ loading: true, result: 'Verifying credentials...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const payload = {
        email: normalizeEmail(loginForm.email),
        password: loginForm.password,
        rememberMe: loginForm.rememberMe,
      }
      const response = await apiFetch('/users/mfa/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify(payload),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setLoginState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      if (body.otpRequired) {
        setMfaForm({ email: payload.email, code: '' })
        setScreen('mfa')
        setLoginState({
          loading: false,
          result: body.message || 'OTP sent to email.',
          tone: 'success',
        })
        return
      }

      await fetchCsrfToken()
      await refreshSession()
      setScreen('gallery')
      setLoginState({
        loading: false,
        result: body.message || 'Authenticated successfully.',
        tone: 'success',
      })
    } catch (error) {
      setLoginState({
        loading: false,
        result: error instanceof Error ? error.message : 'Unexpected network error',
        tone: 'error',
      })
    }
  }

  async function handleVerificationSubmit(event) {
    event.preventDefault()
    const payload = {
      email: normalizeEmail(verificationForm.email),
      code: normalizeCode(verificationForm.code),
    }

    submit('/users/verify-email', payload, setVerificationState, () => {
      setScreen('login')
      setLoginForm((current) => ({ ...current, email: payload.email }))
    })
  }

  async function handleOttRequestSubmit(event) {
    event.preventDefault()
    setOttRequestState({ loading: true, result: 'Dispatching one-time login token...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const email = normalizeEmail(ottRequestForm.email)
      const payload = new URLSearchParams({ username: email })
      const response = await apiFetch('/ott/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          ...csrfHeaders(csrf),
        },
        body: payload.toString(),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setOttRequestState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      setLoginForm((current) => ({ ...current, email }))
      setOttRequestState({
        loading: false,
        result: formatResult(body, response.status),
        tone: 'success',
      })
    } catch (error) {
      setOttRequestState({
        loading: false,
        result: error instanceof Error ? error.message : 'One-time token request failed',
        tone: 'error',
      })
    }
  }

  async function handleOttSubmit(event) {
    event.preventDefault()
    setOttState({ loading: true, result: 'Verifying one-time token...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const payload = new URLSearchParams({ token: ottForm.token.trim() })
      const response = await apiFetch('/login/ott', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          ...csrfHeaders(csrf),
        },
        body: payload.toString(),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setOttState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      await fetchCsrfToken()
      await refreshSession()
      setScreen('gallery')
      setOttState({
        loading: false,
        result: body ? formatResult(body, response.status) : 'One-time token accepted.',
        tone: 'success',
      })
      setLoginState({
        loading: false,
        result: 'Authenticated with one-time token.',
        tone: 'success',
      })
    } catch (error) {
      setOttState({
        loading: false,
        result: error instanceof Error ? error.message : 'One-time token verification failed',
        tone: 'error',
      })
    }
  }

  function handleOAuthLogin(provider) {
    window.location.assign(toApiUrl(`/oauth2/authorization/${provider}`))
  }

  async function handleMfaSubmit(event) {
    event.preventDefault()
    setMfaState({ loading: true, result: 'Verifying one-time code...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const payload = {
        email: normalizeEmail(mfaForm.email),
        code: normalizeCode(mfaForm.code),
      }
      const response = await apiFetch('/users/mfa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify(payload),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setMfaState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      await fetchCsrfToken()
      await refreshSession()
      setScreen('gallery')
      setMfaState({
        loading: false,
        result: body.message || 'Authenticated successfully.',
        tone: 'success',
      })
    } catch (error) {
      setMfaState({
        loading: false,
        result: error instanceof Error ? error.message : 'OTP verification failed',
        tone: 'error',
      })
    }
  }

  async function handlePasskeyLogin() {
    if (!window.PublicKeyCredential || !navigator.credentials?.get) {
      setLoginState({
        loading: false,
        result: 'This browser does not support passkeys.',
        tone: 'error',
      })
      return
    }

    setLoginState({ loading: true, result: 'Requesting WebAuthn challenge...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const optionsResponse = await apiFetch('/webauthn/authenticate/options', {
        method: 'POST',
        headers: csrfHeaders(csrf),
      })
      const optionsBody = await readResponseBody(optionsResponse)

      if (!optionsResponse.ok) {
        setLoginState({
          loading: false,
          result: formatResult(optionsBody, optionsResponse.status),
          tone: 'error',
        })
        return
      }

      const credential = await navigator.credentials.get({
        publicKey: decodeRequestOptions(optionsBody),
      })

      if (!credential) {
        setLoginState({
          loading: false,
          result: 'Passkey authentication was cancelled.',
          tone: 'error',
        })
        return
      }

      const authenticationResponse = await apiFetch('/login/webauthn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify(serializeAuthenticationCredential(credential)),
      })
      const authenticationBody = await readResponseBody(authenticationResponse)

      if (!authenticationResponse.ok) {
        setLoginState({
          loading: false,
          result: formatResult(authenticationBody, authenticationResponse.status),
          tone: 'error',
        })
        return
      }

      await fetchCsrfToken()
      await refreshSession()
      setScreen('gallery')
      setLoginState({
        loading: false,
        result: 'Passkey accepted. The hall is open.',
        tone: 'success',
      })
      setPasskeyState({
        loading: false,
        result: 'Passkey sign-in completed successfully.',
        tone: 'success',
      })
    } catch (error) {
      setLoginState({
        loading: false,
        result: error instanceof Error ? error.message : 'Passkey authentication failed',
        tone: 'error',
      })
    }
  }

  async function handlePasskeyRegistration() {
    if (!window.PublicKeyCredential || !navigator.credentials?.create) {
      setPasskeyState({
        loading: false,
        result: 'This browser does not support passkey registration.',
        tone: 'error',
      })
      return
    }

    setPasskeyState({ loading: true, result: 'Preparing passkey registration ceremony...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const optionsResponse = await apiFetch('/webauthn/register/options', {
        method: 'POST',
        headers: csrfHeaders(csrf),
      })
      const optionsBody = await readResponseBody(optionsResponse)

      if (!optionsResponse.ok) {
        setPasskeyState({
          loading: false,
          result: formatResult(optionsBody, optionsResponse.status),
          tone: 'error',
        })
        if (optionsResponse.status === 401 || optionsResponse.status === 403) {
          setSessionState({ loading: false, authenticated: false })
        }
        return
      }

      const label = buildPasskeyLabel()
      const credential = await navigator.credentials.create({
        publicKey: decodeCreationOptions(optionsBody),
      })

      if (!credential) {
        setPasskeyState({
          loading: false,
          result: 'Passkey registration was cancelled.',
          tone: 'error',
        })
        return
      }

      const registerResponse = await apiFetch('/webauthn/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify({
          publicKey: {
            credential: serializeRegistrationCredential(credential),
            label,
          },
        }),
      })
      const registerBody = await readResponseBody(registerResponse)

      if (!registerResponse.ok) {
        setPasskeyState({
          loading: false,
          result: formatResult(registerBody, registerResponse.status),
          tone: 'error',
        })
        return
      }

      await loadPasskeys()
      setPasskeyState({
        loading: false,
        result: `Passkey "${label}" linked successfully.`,
        tone: 'success',
      })
    } catch (error) {
      setPasskeyState({
        loading: false,
        result: error instanceof Error ? error.message : 'Passkey registration failed',
        tone: 'error',
      })
    }
  }

  async function handlePasskeyDelete(credentialId) {
    setPasskeyState({ loading: true, result: 'Removing passkey from vault...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch(`/users/me/passkeys/${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
        headers: csrfHeaders(csrf),
      })

      if (!response.ok) {
        const body = await readResponseBody(response)
        setPasskeyState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      await loadPasskeys()
      setPasskeyState({
        loading: false,
        result: 'Passkey removed.',
        tone: 'success',
      })
    } catch (error) {
      setPasskeyState({
        loading: false,
        result: error instanceof Error ? error.message : 'Passkey deletion failed',
        tone: 'error',
      })
    }
  }

  async function handleLogout() {
    setPasskeyState({ loading: true, result: 'Closing current session...', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch('/logout', {
        method: 'POST',
        headers: csrfHeaders(csrf),
      })
      if (!response.ok) {
        const body = await readResponseBody(response)
        throw new Error(formatResult(body, response.status))
      }
    } catch (_) {
      // Backend logout can invalidate the session before the client refreshes its CSRF token.
    } finally {
      try {
        await fetchCsrfToken()
      } catch (_) {
        setCsrfState({ headerName: '', parameterName: '', token: '' })
      }
      setPasskeys([])
      setSessionState({ loading: false, authenticated: false })
      setScreen('gallery')
      setPasskeyState({
        loading: false,
        result: 'Session closed.',
        tone: 'success',
      })
    }
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
            {screen === 'gallery' && !sessionState.authenticated && (
              <button type="button" className="nav-pill nav-pill-compact" onClick={() => setScreen('login')}>
                Login
              </button>
            )}
            {screen === 'gallery' && sessionState.authenticated && (
              <button type="button" className="nav-pill nav-pill-compact" onClick={handleLogout}>
                Logout
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
                {!sessionState.authenticated && (
                  <button type="button" className="link-button" onClick={() => setScreen('login')}>
                    Login to unlock
                  </button>
                )}
              </div>
              <div className="gallery-grid" aria-label="Gallery preview">
                {Array.from({ length: 10 }, (_, index) => (
                  <div key={index} className="gallery-card">
                    <div className="gallery-thumb" />
                    <div className="gallery-meta">
                      <strong>Vault Frame {index + 1}</strong>
                      <span>{sessionState.authenticated ? 'Unlocked preview' : 'Blurred preview'}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="vault-shell">
                <div className="vault-heading">
                  <div>
                    <p className="panel-label">Passkey vault</p>
                    <h3>Manage linked passkeys</h3>
                  </div>
                  <span className={`vault-badge ${sessionState.authenticated ? 'online' : ''}`}>
                    {sessionState.loading ? 'Checking session' : sessionState.authenticated ? 'Authenticated' : 'Guest'}
                  </span>
                </div>

                <div className="vault-actions">
                  <button type="button" className="nav-pill" onClick={loadPasskeys} disabled={passkeyState.loading}>
                    Refresh passkeys
                  </button>
                  <button
                    type="button"
                    className="nav-pill"
                    onClick={handlePasskeyRegistration}
                    disabled={passkeyState.loading || !sessionState.authenticated}
                  >
                    Add passkey
                  </button>
                  {!sessionState.authenticated && (
                    <button type="button" className="nav-pill" onClick={() => setScreen('login')}>
                      Login first
                    </button>
                  )}
                </div>

                {passkeys.length === 0 ? (
                  <div className="empty-vault">
                    {sessionState.authenticated
                      ? 'No passkeys registered yet.'
                      : 'Login first to inspect or register passkeys.'}
                  </div>
                ) : (
                  <div className="passkey-list">
                    {passkeys.map((passkey) => (
                      <article key={passkey.id} className="passkey-card">
                        <div className="passkey-copy">
                          <strong>{passkey.label || 'Unnamed passkey'}</strong>
                          <span>ID: {passkey.id}</span>
                          <span>Created: {formatDate(passkey.createdAt)}</span>
                          <span>Last used: {formatDate(passkey.lastUsedAt)}</span>
                          <span>Transports: {passkey.transports.length ? passkey.transports.join(', ') : 'n/a'}</span>
                        </div>
                        <button
                          type="button"
                          className="link-button danger-link"
                          onClick={() => handlePasskeyDelete(passkey.id)}
                          disabled={passkeyState.loading}
                        >
                          Delete
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                <pre className={`result-box compact-result ${passkeyState.tone}`}>{passkeyState.result}</pre>
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
              <p className="panel-text">Enter with your email and password, or use a registered passkey for passwordless entry.</p>

              <form className="auth-form" onSubmit={handleLoginSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
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

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={loginForm.rememberMe}
                    onChange={(event) => setLoginForm((current) => ({ ...current, rememberMe: event.target.checked }))}
                  />
                  <strong>Remember this browser</strong>
                </label>

                <button type="submit" disabled={loginState.loading}>
                  {loginState.loading ? 'Verifying...' : 'Enter the Hall'}
                </button>
              </form>

              <div className="divider-line">
                <span>or</span>
              </div>

              <button type="button" className="secondary-action" onClick={handlePasskeyLogin} disabled={loginState.loading}>
                {loginState.loading ? 'Awaiting ceremony...' : 'Enter with Passkey'}
              </button>

              <div className="divider-line">
                <span>oauth2</span>
              </div>

              <div className="panel-actions auth-provider-actions">
                <button type="button" className="nav-pill" onClick={() => handleOAuthLogin('google')} disabled={loginState.loading}>
                  Continue with Google
                </button>
                <button type="button" className="nav-pill" onClick={() => handleOAuthLogin('github')} disabled={loginState.loading}>
                  Continue with GitHub
                </button>
              </div>

              <div className="divider-line">
                <span>one-time token</span>
              </div>

              <form className="auth-form" onSubmit={handleOttRequestSubmit}>
                <label>
                  <span>Email for OTT</span>
                  <input
                    type="email"
                    value={ottRequestForm.email}
                    onChange={(event) => setOttRequestForm({ email: event.target.value })}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <button type="submit" disabled={ottRequestState.loading}>
                  {ottRequestState.loading ? 'Sending token...' : 'Send one-time token'}
                </button>
              </form>

              <pre className={`result-box compact-result ${ottRequestState.tone}`}>{ottRequestState.result}</pre>

              <form className="auth-form" onSubmit={handleOttSubmit}>
                <label>
                  <span>OTT token</span>
                  <input
                    type="text"
                    value={ottForm.token}
                    onChange={(event) => setOttForm({ token: event.target.value.trim() })}
                    placeholder="Paste one-time token"
                    required
                  />
                </label>

                <button type="submit" disabled={ottState.loading}>
                  {ottState.loading ? 'Checking token...' : 'Login with one-time token'}
                </button>
              </form>

              <pre className={`result-box compact-result ${ottState.tone}`}>{ottState.result}</pre>

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

          {screen === 'mfa' && (
            <article className="command-panel single-panel command-panel-accent">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Multi-factor check</p>
              <h2>Enter login code</h2>
              <p className="panel-text">Enter the 6-digit code sent after password verification.</p>

              <form className="auth-form" onSubmit={handleMfaSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={mfaForm.email}
                    onChange={(event) => setMfaForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <label>
                  <span>One-time code</span>
                  <input
                    type="text"
                    value={mfaForm.code}
                    onChange={(event) => setMfaForm((current) => ({ ...current, code: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="123456"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength="6"
                    required
                  />
                </label>

                <button type="submit" disabled={mfaState.loading}>
                  {mfaState.loading ? 'Confirming...' : 'Complete Login'}
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

              <pre className={`result-box ${mfaState.tone}`}>{mfaState.result}</pre>
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
                    pattern={passwordPattern.source}
                    required
                  />
                  <p className="field-hint">Minimum 8 characters with letters, digits, and a special character.</p>
                </label>

                <label>
                  <span>Enable email MFA</span>
                  <input
                    type="checkbox"
                    checked={registerForm.mfaEnabled}
                    onChange={(event) => setRegisterForm((current) => ({ ...current, mfaEnabled: event.target.checked }))}
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
              <p className="panel-text">Use the 6-digit code sent after registration. Once confirmed, you can return to login and attach passkeys after your first authenticated session.</p>

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

async function readResponseBody(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return text
  }

  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

function formatResult(body, status) {
  if (body == null) {
    return `HTTP ${status}`
  }

  if (typeof body === 'string') {
    return `HTTP ${status}\n${body}`
  }

  if (typeof body === 'object' && typeof body.message === 'string' && body.message.trim()) {
    return body.message
  }

  return `HTTP ${status}\n${JSON.stringify(body, null, 2)}`
}

function getInitialLoginState() {
  const error = query.get('error')
  const logout = query.get('logout')

  if (logout === 'true') {
    return {
      loading: false,
      result: 'Session closed.',
      tone: 'success',
    }
  }

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

  if (error) {
    return {
      loading: false,
      result: `Authentication failed: ${error}`,
      tone: 'error',
    }
  }

  return { loading: false, result: 'Awaiting your command...', tone: '' }
}

function resolveInitialScreen(currentQuery) {
  if (currentQuery.get('error') || currentQuery.get('logout')) {
    return 'gallery'
  }

  return currentQuery.get('screen') || 'gallery'
}

function syncScreenQuery(screen) {
  const next = new URLSearchParams(window.location.search)

  next.delete('error')
  next.delete('logout')

  if (screen === 'gallery') {
    next.delete('screen')
  } else {
    next.set('screen', screen)
  }

  const nextQuery = next.toString()
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', nextUrl)
}

function apiFetch(path, init = {}) {
  return fetch(toApiUrl(path), {
    credentials: 'include',
    ...init,
  })
}

function toApiUrl(path) {
  if (!apiBaseUrl) {
    return path
  }

  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeEmail(value) {
  return value.trim().toLowerCase()
}

function normalizeCode(value) {
  return value.replace(/\D/g, '').slice(0, 6)
}

function decodeCreationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToBuffer(options.user.id),
    },
    excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
      ...credential,
      id: base64UrlToBuffer(credential.id),
    })),
  }
}

function decodeRequestOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((credential) => ({
      ...credential,
      id: base64UrlToBuffer(credential.id),
    })),
  }
}

function serializeRegistrationCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    response: {
      attestationObject: bufferToBase64Url(credential.response.attestationObject),
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      transports: typeof credential.response.getTransports === 'function'
        ? credential.response.getTransports()
        : undefined,
    },
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  }
}

function serializeAuthenticationCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    response: {
      authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      signature: bufferToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? bufferToBase64Url(credential.response.userHandle)
        : null,
    },
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment,
  }
}

function base64UrlToBuffer(value) {
  const padding = '='.repeat((4 - (value.length % 4 || 4)) % 4)
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = window.atob(normalized)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

function bufferToBase64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function buildPasskeyLabel() {
  const date = new Date().toLocaleString()
  return `Passkey ${date}`
}

function formatDate(value) {
  return new Date(value).toLocaleString()
}

export default App
