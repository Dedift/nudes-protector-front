import { useEffect, useRef, useState } from 'react'
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

const initialPasskeyForm = {
  label: '',
}

const initialPasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

const placeholderGalleryItems = Array.from({ length: 10 }, (_, index) => ({
  id: `placeholder-${index + 1}`,
  title: `Vault Frame ${index + 1}`,
  imageUrl: '',
}))

function buildGallerySlots(items) {
  return placeholderGalleryItems.map((placeholder, index) => ({
    ...placeholder,
    ...(items[index] || {}),
  }))
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
  const [registerState, setRegisterState] = useState({ loading: false, result: '', tone: '' })
  const [loginState, setLoginState] = useState(getInitialLoginState())
  const [verificationState, setVerificationState] = useState({ loading: false, result: '', tone: '' })
  const [mfaState, setMfaState] = useState({ loading: false, result: '', tone: '' })
  const [ottRequestState, setOttRequestState] = useState({ loading: false, result: '', tone: '' })
  const [sessionState, setSessionState] = useState({ loading: true, authenticated: false })
  const [passkeyState, setPasskeyState] = useState({ loading: false, result: '', tone: '' })
  const [passkeys, setPasskeys] = useState([])
  const [passkeyForm, setPasskeyForm] = useState(initialPasskeyForm)
  const [oauth2Accounts, setOauth2Accounts] = useState([])
  const [oauth2State, setOauth2State] = useState({ loading: false, result: '', tone: '' })
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm)
  const [csrfState, setCsrfState] = useState({ headerName: '', parameterName: '', token: '' })
  const [profileState, setProfileState] = useState({
    loading: false,
    username: '',
    email: '',
    createdAt: '',
    mfaEnabled: false,
    result: '',
    tone: '',
  })
  const [passwordState, setPasswordState] = useState({ loading: false, result: '', tone: '' })
  const [galleryItems, setGalleryItems] = useState(() => buildGallerySlots([]))
  const [galleryState, setGalleryState] = useState({ loading: false, result: '', tone: '' })
  const [galleryCacheKey, setGalleryCacheKey] = useState(() => Date.now())
  const galleryRequestRef = useRef(0)

  useEffect(() => {
    bootstrap()
  }, [])

  useEffect(() => {
    syncScreenQuery(screen)
  }, [screen])

  useEffect(() => {
    if (!sessionState.loading && !sessionState.authenticated && (screen === 'profile' || screen === 'change-password')) {
      setScreen('login')
    }
  }, [screen, sessionState.authenticated, sessionState.loading])

  useEffect(() => {
    if (!sessionState.loading && screen === 'gallery') {
      loadGalleryItems()
    }
  }, [screen, sessionState.authenticated, sessionState.loading])

  async function submit(path, payload, setter, onSuccess) {
    setter({ loading: true, result: '', tone: '' })

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

      setter({ loading: false, result: '', tone: '' })

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
      if (isAuthenticationRedirect(response)) {
        setPasskeys([])
        setCsrfState({ headerName: '', parameterName: '', token: '' })
        setSessionState({ loading: false, authenticated: false })
        return false
      }

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
    setPasskeyState({ loading: true, result: '', tone: '' })

    try {
      const response = await apiFetch('/users/me/passkeys')
      if (isAuthenticationRedirect(response)) {
        setPasskeys([])
        setSessionState({ loading: false, authenticated: false })
        setPasskeyState({ loading: false, result: '', tone: '' })
        return
      }
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
        result: '',
        tone: '',
      })
    } catch (error) {
      setPasskeyState({
        loading: false,
        result: error instanceof Error ? error.message : 'Unexpected network error',
        tone: 'error',
      })
    }
  }

  async function loadGalleryItems() {
    const requestId = galleryRequestRef.current + 1
    galleryRequestRef.current = requestId
    const cacheKey = Date.now()
    setGalleryCacheKey(cacheKey)
    setGalleryItems(buildGallerySlots([]))
    setGalleryState({ loading: true, result: '', tone: '' })

    try {
      const response = await apiFetch('/api/images')
      const body = await readResponseBody(response)

      if (galleryRequestRef.current !== requestId) {
        return
      }

      if (!response.ok) {
        setGalleryState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        if (response.status === 401 || response.status === 403) {
          setSessionState({ loading: false, authenticated: false })
        }
        return
      }

      const items = Array.isArray(body) ? body.slice(0, 10) : []

      setGalleryItems(buildGallerySlots(items))
      setGalleryState({ loading: false, result: '', tone: '' })
    } catch (error) {
      if (galleryRequestRef.current !== requestId) {
        return
      }
      setGalleryState({
        loading: false,
        result: error instanceof Error ? error.message : 'Failed to load gallery.',
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
    setLoginState({ loading: true, result: '', tone: '' })

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
          result: '',
          tone: '',
        })
        return
      }

      await fetchCsrfToken()
      await refreshSession()
      setScreen('gallery')
      setLoginState({
        loading: false,
        result: '',
        tone: '',
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
    setOttRequestState({ loading: true, result: '', tone: '' })

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
        result: '',
        tone: '',
      })
      setScreen('ott-wait')
    } catch (error) {
      setOttRequestState({
        loading: false,
        result: error instanceof Error ? error.message : 'Magic link request failed',
        tone: 'error',
      })
    }
  }

  function handleOAuthLogin(provider) {
    window.location.assign(toApiUrl(`/oauth2/authorization/${provider}`))
  }

  async function handleMfaSubmit(event) {
    event.preventDefault()
    setMfaState({ loading: true, result: '', tone: '' })

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
        result: '',
        tone: '',
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

    setLoginState({ loading: true, result: '', tone: '' })

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
        result: '',
        tone: '',
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

    setPasskeyState({ loading: true, result: '', tone: '' })

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

      const label = buildPasskeyLabel(passkeyForm.label)
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
      setPasskeyForm(initialPasskeyForm)
      setPasskeyState({
        loading: false,
        result: '',
        tone: '',
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
    setPasskeyState({ loading: true, result: '', tone: '' })

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
        result: '',
        tone: '',
      })
    } catch (error) {
      setPasskeyState({
        loading: false,
        result: error instanceof Error ? error.message : 'Passkey deletion failed',
        tone: 'error',
      })
    }
  }

  async function loadProfileSettings() {
    setProfileState((current) => ({ ...current, loading: true, result: '', tone: '' }))

    try {
      const response = await apiFetch('/users/me/settings')
      if (isAuthenticationRedirect(response)) {
        setSessionState({ loading: false, authenticated: false })
        setProfileState({
          loading: false,
          username: '',
          email: '',
          createdAt: '',
          mfaEnabled: false,
          result: '',
          tone: '',
        })
        return
      }
      const body = await readResponseBody(response)

      if (!response.ok) {
        setProfileState({
          loading: false,
          username: '',
          email: '',
          createdAt: '',
          mfaEnabled: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      setProfileState({
        loading: false,
        username: body?.username || '',
        email: body?.email || '',
        createdAt: body?.createdAt || '',
        mfaEnabled: Boolean(body?.mfaEnabled),
        result: '',
        tone: '',
      })
    } catch (error) {
      setProfileState({
        loading: false,
        username: '',
        email: '',
        createdAt: '',
        mfaEnabled: false,
        result: error instanceof Error ? error.message : 'Failed to load profile settings.',
        tone: 'error',
      })
    }
  }

  async function loadOauth2Accounts() {
    setOauth2State({ loading: true, result: '', tone: '' })

    try {
      const response = await apiFetch('/users/me/oauth2-accounts')
      if (isAuthenticationRedirect(response)) {
        setSessionState({ loading: false, authenticated: false })
        setOauth2Accounts([])
        setOauth2State({ loading: false, result: '', tone: '' })
        return
      }
      const body = await readResponseBody(response)

      if (!response.ok) {
        setOauth2State({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      setOauth2Accounts(Array.isArray(body) ? body : [])
      setOauth2State({ loading: false, result: '', tone: '' })
    } catch (error) {
      setOauth2State({
        loading: false,
        result: error instanceof Error ? error.message : 'Failed to load linked accounts.',
        tone: 'error',
      })
    }
  }

  async function handleProfileMfaToggle(event) {
    const enabled = event.target.checked
    setProfileState((current) => ({ ...current, loading: true, mfaEnabled: enabled, result: '', tone: '' }))

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch('/users/me/settings/mfa', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify({ enabled }),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setProfileState((current) => ({
          ...current,
          loading: false,
          mfaEnabled: !enabled,
          result: formatResult(body, response.status),
          tone: 'error',
        }))
        return
      }

      setProfileState({
        loading: false,
        mfaEnabled: Boolean(body?.mfaEnabled),
        result: '',
        tone: '',
      })
    } catch (error) {
      setProfileState((current) => ({
        ...current,
        loading: false,
        mfaEnabled: !enabled,
        result: error instanceof Error ? error.message : 'Failed to update email MFA.',
        tone: 'error',
      }))
    }
  }

  async function handlePasswordUpdateSubmit(event) {
    event.preventDefault()

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordState({
        loading: false,
        result: 'New passwords do not match.',
        tone: 'error',
      })
      return
    }

    setPasswordState({ loading: true, result: '', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch('/users/me/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...csrfHeaders(csrf),
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })
      const body = await readResponseBody(response)

      if (!response.ok) {
        setPasswordState({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      setPasswordForm(initialPasswordForm)
      setPasswordState({
        loading: false,
        result: 'Password updated successfully.',
        tone: 'success',
      })
    } catch (error) {
      setPasswordState({
        loading: false,
        result: error instanceof Error ? error.message : 'Password update failed.',
        tone: 'error',
      })
    }
  }

  async function handleOauth2Unlink(provider) {
    setOauth2State({ loading: true, result: '', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch(`/users/me/oauth2-accounts/${encodeURIComponent(provider)}`, {
        method: 'DELETE',
        headers: csrfHeaders(csrf),
      })

      if (!response.ok) {
        const body = await readResponseBody(response)
        setOauth2State({
          loading: false,
          result: formatResult(body, response.status),
          tone: 'error',
        })
        return
      }

      await loadOauth2Accounts()
    } catch (error) {
      setOauth2State({
        loading: false,
        result: error instanceof Error ? error.message : 'Failed to unlink account.',
        tone: 'error',
      })
    }
  }

  async function handleLogout() {
    setPasskeyState({ loading: true, result: '', tone: '' })

    try {
      const csrf = await ensureCsrfToken()
      const response = await apiFetch('/logout', {
        method: 'POST',
        headers: csrfHeaders(csrf),
      })
      if (!response.ok) {
        await readResponseBody(response)
      }
    } catch (_) {
      // Backend logout can invalidate the session before the client refreshes its CSRF token.
    } finally {
      setCsrfState({ headerName: '', parameterName: '', token: '' })
      setPasskeys([])
      setSessionState({ loading: false, authenticated: false })
      setScreen('gallery')
      setPasskeyState({
        loading: false,
        result: '',
        tone: '',
      })
    }
  }

  function openProfile() {
    setScreen('profile')
    setPasswordState({ loading: false, result: '', tone: '' })
    loadPasskeys()
    loadProfileSettings()
    loadOauth2Accounts()
  }

  function openChangePassword() {
    setPasswordState({ loading: false, result: '', tone: '' })
    setScreen('change-password')
  }

  return (
    <main className="war-room">
      <section className="citadel-shell">
        <div className="citadel-spire citadel-spire-left" aria-hidden="true" />
        <div className="citadel-spire citadel-spire-right" aria-hidden="true" />
        <div className="crown-rim crown-rim-left" aria-hidden="true" />
        <div className="crown-rim crown-rim-right" aria-hidden="true" />

        {screen !== 'login' && screen !== 'register' && screen !== 'change-password' ? (
          <section className="banner-panel">
            <div className="banner-actions">
              {screen === 'gallery' && sessionState.authenticated && (
                <button type="button" className="nav-pill nav-pill-compact" onClick={openProfile}>
                  Profile
                </button>
              )}
              {screen !== 'gallery' && sessionState.authenticated && (
                <button type="button" className="nav-pill nav-pill-compact" onClick={() => setScreen('gallery')}>
                  Gallery
                </button>
              )}
              {sessionState.authenticated && (
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
        ) : null}

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
                {galleryItems.map((item) => (
                  <div key={item.id} className="gallery-card">
                    {item.imageUrl ? (
                      <img
                        className="gallery-thumb gallery-thumb-image"
                        src={withCacheKey(toApiUrl(item.imageUrl), galleryCacheKey)}
                        crossOrigin="use-credentials"
                        alt={item.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className="gallery-thumb" />
                    )}
                  </div>
                ))}
              </div>

              {galleryState.tone === 'error' && galleryState.result && (
                <pre className={`result-box compact-result ${galleryState.tone}`}>{galleryState.result}</pre>
              )}
            </article>
          )}

          {screen === 'profile' && sessionState.authenticated && (
            <article className="command-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="vault-shell">
                <div className="vault-heading">
                  <div>
                    <p className="panel-label">Profile</p>
                    <h2>Passkey vault</h2>
                  </div>
                </div>

                <div className="profile-settings">
                  <section className="profile-summary">
                    <div className="profile-summary-item">
                      <span>Username</span>
                      <strong>{profileState.username || 'Not available'}</strong>
                    </div>
                    <div className="profile-summary-item">
                      <span>Email</span>
                      <strong>{profileState.email || 'Not available'}</strong>
                    </div>
                    <div className="profile-summary-item">
                      <span>Registered</span>
                      <strong>{profileState.createdAt ? formatDate(profileState.createdAt) : 'Not available'}</strong>
                    </div>
                  </section>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={profileState.mfaEnabled}
                      onChange={handleProfileMfaToggle}
                      disabled={profileState.loading}
                    />
                    <strong>Enable email MFA</strong>
                  </label>
                  {profileState.tone === 'error' && profileState.result && (
                    <pre className={`result-box compact-result ${profileState.tone}`}>{profileState.result}</pre>
                  )}
                </div>

                <section className="profile-section">
                  <div className="vault-heading vault-heading-compact">
                    <div>
                      <p className="panel-label">Security</p>
                      <h3>Change password</h3>
                    </div>
                  </div>

                  <p className="panel-text">Open a dedicated page to verify your current password and set a new one.</p>

                  <div className="panel-actions">
                    <button type="button" className="nav-pill" onClick={openChangePassword}>
                      Change password
                    </button>
                  </div>
                </section>

                <section className="profile-section">
                  <div className="vault-heading vault-heading-compact">
                    <div>
                      <p className="panel-label">Linked accounts</p>
                      <h3>OAuth2</h3>
                    </div>
                  </div>

                  {oauth2Accounts.length === 0 ? (
                    <div className="empty-vault">No linked Google or GitHub accounts yet.</div>
                  ) : (
                    <div className="oauth2-account-list">
                      {oauth2Accounts.map((account) => (
                        <article key={account.provider} className="passkey-card">
                          <div className="passkey-copy">
                            <strong>{formatOauth2Provider(account.provider)}</strong>
                            <span>Linked: {formatDate(account.createdAt)}</span>
                          </div>
                          <button
                            type="button"
                            className="link-button danger-link"
                            onClick={() => handleOauth2Unlink(account.provider)}
                            disabled={oauth2State.loading}
                          >
                            Unlink
                          </button>
                        </article>
                      ))}
                    </div>
                  )}

                  {oauth2State.tone === 'error' && oauth2State.result && (
                    <pre className={`result-box compact-result ${oauth2State.tone}`}>{oauth2State.result}</pre>
                  )}
                </section>

                <div className="vault-actions">
                  <label className="passkey-name-field">
                    <span>Passkey name</span>
                    <input
                      type="text"
                      value={passkeyForm.label}
                      onChange={(event) => setPasskeyForm({ label: event.target.value })}
                      placeholder="iPhone, MacBook, Work laptop"
                      maxLength="80"
                    />
                  </label>
                  <button
                    type="button"
                    className="nav-pill"
                    onClick={handlePasskeyRegistration}
                    disabled={passkeyState.loading}
                  >
                    Add passkey
                  </button>
                </div>

                {passkeys.length === 0 ? (
                  <div className="empty-vault">No passkeys registered yet.</div>
                ) : (
                  <div className="passkey-list">
                    {passkeys.map((passkey, index) => (
                      <article key={passkey.id} className="passkey-card">
                        <div className="passkey-copy">
                          <strong>{formatPasskeyLabel(passkey, index)}</strong>
                          <span>Created: {formatDate(passkey.createdAt)}</span>
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

                {passkeyState.tone === 'error' && passkeyState.result && (
                  <pre className={`result-box compact-result ${passkeyState.tone}`}>{passkeyState.result}</pre>
                )}
              </div>
            </article>
          )}

          {screen === 'login' && (
            <article className="command-panel single-panel auth-screen-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="login-citadel-mark login-citadel-mark-inline" aria-hidden="true">
                <div className="frost-crown">
                  <span className="frost-crown-spike spike-a" />
                  <span className="frost-crown-spike spike-b" />
                  <span className="frost-crown-spike spike-c" />
                  <span className="frost-crown-spike spike-d" />
                  <div className="frost-core" />
                </div>
              </div>
              <p className="panel-label">Main hall</p>
              <h2>Login</h2>

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
                  Enter the Hall
                </button>

                <p className="mini-auth-label">Login with:</p>

                <div className="auth-provider-row auth-provider-row-compact">
                  <button type="button" className="nav-pill" onClick={() => handleOAuthLogin('google')} disabled={loginState.loading}>
                    Google
                  </button>
                  <button type="button" className="nav-pill" onClick={() => handleOAuthLogin('github')} disabled={loginState.loading}>
                    GitHub
                  </button>
                </div>

                <div className="auth-provider-row auth-provider-row-compact">
                  <button type="button" className="nav-pill" onClick={() => setScreen('ott-request')} disabled={loginState.loading}>
                    Email
                  </button>
                  <button type="button" className="nav-pill" onClick={handlePasskeyLogin} disabled={loginState.loading}>
                    Passkey
                  </button>
                </div>
              </form>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => setScreen('register')}>
                  Register
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('gallery')}>
                  Back to gallery
                </button>
              </div>

              {loginState.tone === 'error' && loginState.result && (
                <pre className={`result-box ${loginState.tone}`}>{loginState.result}</pre>
              )}
            </article>
          )}

          {screen === 'ott-request' && (
            <article className="command-panel single-panel auth-screen-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Magic link</p>
              <h2>Login by Email</h2>
              <p className="panel-text">Enter your email address. We will send a magic link to it.</p>

              <form className="auth-form" onSubmit={handleOttRequestSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={ottRequestForm.email}
                    onChange={(event) => setOttRequestForm({ email: event.target.value })}
                    placeholder="warden@citadel.com"
                    required
                  />
                </label>

                <button type="submit" disabled={ottRequestState.loading}>
                  Send magic link
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

              {ottRequestState.tone === 'error' && ottRequestState.result && (
                <pre className={`result-box ${ottRequestState.tone}`}>{ottRequestState.result}</pre>
              )}
            </article>
          )}

          {screen === 'ott-wait' && (
            <article className="command-panel single-panel command-panel-accent">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="panel-label">Magic link</p>
              <h2>Check your email</h2>
              <p className="panel-text">Wait for the message and open the magic link to sign in.</p>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={() => setScreen('ott-request')}>
                  Change email
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('login')}>
                  Back to login
                </button>
              </div>
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
                  Complete Login
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

              {mfaState.tone === 'error' && mfaState.result && (
                <pre className={`result-box ${mfaState.tone}`}>{mfaState.result}</pre>
              )}
            </article>
          )}

          {screen === 'register' && (
            <article className="command-panel single-panel auth-screen-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="login-citadel-mark login-citadel-mark-inline" aria-hidden="true">
                <div className="frost-crown">
                  <span className="frost-crown-spike spike-a" />
                  <span className="frost-crown-spike spike-b" />
                  <span className="frost-crown-spike spike-c" />
                  <span className="frost-crown-spike spike-d" />
                  <div className="frost-core" />
                </div>
              </div>
              <p className="panel-label">Main hall</p>
              <h2>Register</h2>

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

                <button type="submit" disabled={registerState.loading}>
                  Register Account
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

              {registerState.tone === 'error' && registerState.result && (
                <pre className={`result-box ${registerState.tone}`}>{registerState.result}</pre>
              )}
            </article>
          )}

          {screen === 'change-password' && sessionState.authenticated && (
            <article className="command-panel single-panel auth-screen-panel">
              <div className="frame-ribs" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="login-citadel-mark login-citadel-mark-inline" aria-hidden="true">
                <div className="frost-crown">
                  <span className="frost-crown-spike spike-a" />
                  <span className="frost-crown-spike spike-b" />
                  <span className="frost-crown-spike spike-c" />
                  <span className="frost-crown-spike spike-d" />
                  <div className="frost-core" />
                </div>
              </div>
              <p className="panel-label">Security</p>
              <h2>Change Password</h2>
              <p className="panel-text">Confirm your current password, then set a new one using the same rules as registration.</p>

              <form className="auth-form" onSubmit={handlePasswordUpdateSubmit}>
                <label>
                  <span>Current password</span>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    placeholder="Current password"
                    required
                  />
                </label>

                <label>
                  <span>New password</span>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    placeholder="StrongPass123!"
                    minLength="8"
                    pattern={passwordPattern.source}
                    required
                  />
                  <p className="field-hint">Minimum 8 characters with letters, digits, and a special character.</p>
                </label>

                <label>
                  <span>Confirm new password</span>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    placeholder="Repeat new password"
                    minLength="8"
                    pattern={passwordPattern.source}
                    required
                  />
                </label>

                <button type="submit" disabled={passwordState.loading}>
                  Change password
                </button>
              </form>

              <div className="panel-actions">
                <button type="button" className="link-button" onClick={openProfile}>
                  Back to profile
                </button>
                <button type="button" className="link-button" onClick={() => setScreen('gallery')}>
                  Back to gallery
                </button>
              </div>

              {passwordState.result && passwordState.tone && (
                <pre className={`result-box ${passwordState.tone}`}>{passwordState.result}</pre>
              )}
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
                  Verify Email
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
              {verificationState.tone === 'error' && verificationState.result && (
                <pre className={`result-box ${verificationState.tone}`}>{verificationState.result}</pre>
              )}
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
    return { loading: false, result: '', tone: '' }
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

  return { loading: false, result: '', tone: '' }
}

function resolveInitialScreen(currentQuery) {
  const supportedScreens = new Set([
    'gallery',
    'profile',
    'change-password',
    'login',
    'ott-request',
    'ott-wait',
    'mfa',
    'register',
    'verify',
  ])

  if (currentQuery.get('error') || currentQuery.get('logout')) {
    return 'gallery'
  }

  const requestedScreen = currentQuery.get('screen')
  return supportedScreens.has(requestedScreen) ? requestedScreen : 'gallery'
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

function isAuthenticationRedirect(response) {
  if (!response.redirected) {
    return false
  }

  try {
    const url = new URL(response.url)
    return url.pathname === '/login'
  } catch (_) {
    return false
  }
}

function toApiUrl(path) {
  if (!apiBaseUrl) {
    return path
  }

  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function withCacheKey(url, cacheKey) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${cacheKey}`
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

function buildPasskeyLabel(value) {
  const normalized = (value || '').trim()
  return normalized || 'Passkey'
}

function formatDate(value) {
  return new Date(value).toLocaleString()
}

function formatPasskeyLabel(passkey, index) {
  const label = (passkey.label || '').trim()

  if (!label || label.toLowerCase() === 'passkey' || label.startsWith('Passkey ')) {
    return `Passkey ${index + 1}`
  }

  return label
}

function formatOauth2Provider(provider) {
  const normalizedProvider = (provider || '').trim().toLowerCase()

  if (normalizedProvider === 'google') {
    return 'Google'
  }

  if (normalizedProvider === 'github') {
    return 'GitHub'
  }

  return provider
}

export default App

