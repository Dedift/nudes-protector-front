import { useEffect, useState } from 'react'
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
  const [sessionState, setSessionState] = useState({ loading: true, authenticated: false })
  const [passkeyState, setPasskeyState] = useState({ loading: false, result: 'Passkey vault is idle.', tone: '' })
  const [passkeys, setPasskeys] = useState([])

  useEffect(() => {
    refreshSession()
  }, [])

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

  async function refreshSession() {
    setSessionState((current) => ({ ...current, loading: true }))

    try {
      const response = await fetch('/users/me/passkeys', {
        credentials: 'same-origin',
      })

      if (response.ok) {
        const body = await response.json()
        setPasskeys(body)
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
      const response = await fetch('/users/me/passkeys', {
        credentials: 'same-origin',
      })
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

      setPasskeys(body)
      setSessionState({ loading: false, authenticated: true })
      setPasskeyState({
        loading: false,
        result: body.length === 0
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
    submit('/users/register', registerForm, setRegisterState, () => {
      setVerificationForm({ email: registerForm.email, code: '' })
      setLoginForm((current) => ({ ...current, email: registerForm.email }))
      setScreen('verify')
    })
  }

  function handleLoginSubmit() {
    setLoginState({ loading: true, result: 'Passing control to Spring Security...', tone: '' })
  }

  async function handleVerificationSubmit(event) {
    event.preventDefault()
    submit('/users/verify-email', verificationForm, setVerificationState, () => {
      setScreen('login')
      setLoginForm((current) => ({ ...current, email: verificationForm.email }))
    })
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
      const optionsResponse = await fetch('/webauthn/authenticate/options', {
        method: 'POST',
        credentials: 'same-origin',
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

      const authenticationResponse = await fetch('/login/webauthn', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
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
      const optionsResponse = await fetch('/webauthn/register/options', {
        method: 'POST',
        credentials: 'same-origin',
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

      const registerResponse = await fetch('/webauthn/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
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
      const response = await fetch(`/users/me/passkeys/${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
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
      await fetch('/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } finally {
      setPasskeys([])
      setSessionState({ loading: false, authenticated: false })
      setScreen('login')
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
            <p className="subtitle">Account Registry and Entry Hall</p>
            <p className="lead">
              Browse the protected wing from the main hall. Sign in with password or passkey, then manage linked authenticators from the vault.
            </p>
            <div className="status-strip">
              <span className="status-glyph" aria-hidden="true">I</span>
              <span>
                Linked to <strong>gallery</strong>, <strong>login</strong>, <strong>register</strong>, <strong>verify email</strong> and <strong>passkeys</strong>
              </span>
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
                {!sessionState.authenticated && (
                  <button type="button" className="link-button" onClick={() => setScreen('login')}>
                    Login to unlock
                  </button>
                )}
              </div>
              <p className="panel-text">
                {sessionState.authenticated
                  ? 'Session confirmed. You can attach multiple passkeys, use them for future sign-in, and remove them individually.'
                  : 'This is the main entry screen. After successful Spring Security login, the browser returns here and the gallery becomes the user landing point.'}
              </p>
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

              <div className="divider-line">
                <span>or</span>
              </div>

              <button type="button" className="secondary-action" onClick={handlePasskeyLogin} disabled={loginState.loading}>
                {loginState.loading ? 'Awaiting ceremony...' : 'Enter with Passkey'}
              </button>

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
  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json')
    ? response.json()
    : response.text()
}

function formatResult(body, status) {
  if (typeof body === 'string') {
    return `HTTP ${status}\n${body}`
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

  return { loading: false, result: 'Awaiting your command...', tone: '' }
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
