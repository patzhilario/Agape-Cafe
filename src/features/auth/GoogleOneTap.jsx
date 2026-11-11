import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Alert, Box } from '@mui/material'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
let googleScript
let googleInitialization
let credentialReceiver
let hasPrompted = false

function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => {
        if (window.google?.accounts?.id) resolve(window.google.accounts.id)
        else reject(new Error('Google Identity Services did not load.'))
      }
      script.onerror = () => reject(new Error('Google Identity Services could not load.'))
      document.head.append(script)
    }).catch((error) => {
      googleScript = undefined
      throw error
    })
  }
  return googleScript
}

function initializeGoogleIdentity() {
  if (!googleInitialization) {
    googleInitialization = (async () => {
      const nonce = crypto.randomUUID()
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))
      const hashedNonce = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      const identity = await loadGoogleIdentity()
      identity.initialize({
        client_id: clientId,
        nonce: hashedNonce,
        use_fedcm_for_button: true,
        callback: ({ credential }) => credentialReceiver?.(credential, nonce),
      })
      return identity
    })().catch((error) => {
      googleInitialization = undefined
      throw error
    })
  }
  return googleInitialization
}

export function GoogleOneTap({ disabled, isSignUp, onCredential }) {
  const buttonRef = useRef(null)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const receiveCredential = useEffectEvent((credential, nonce) => {
    if (!disabled && credential) void onCredential(credential, nonce)
  })

  useEffect(() => {
    if (!clientId) return undefined
    let active = true
    let identity
    const button = buttonRef.current
    const handleCredential = (credential, nonce) => {
      if (active) receiveCredential(credential, nonce)
    }

    async function renderGoogleSignIn() {
      identity = await initializeGoogleIdentity()
      if (!active) return
      credentialReceiver = handleCredential
      identity.renderButton(button, {
        theme: 'outline',
        size: 'large',
        text: isSignUp ? 'signup_with' : 'signin_with',
      })
      if (!hasPrompted) {
        hasPrompted = true
        identity.prompt()
      }
    }

    void renderGoogleSignIn().catch(() => {
      if (active) setIsUnavailable(true)
    })
    return () => {
      active = false
      if (credentialReceiver === handleCredential) {
        credentialReceiver = undefined
        identity?.cancel()
      }
      button?.replaceChildren()
    }
  }, [isSignUp])

  if (!clientId) return null
  return (
    <>
      <Box ref={buttonRef} inert={disabled} sx={{ alignSelf: 'center' }} />
      {isUnavailable && <Alert severity="info">Google is unavailable. You can continue with email.</Alert>}
    </>
  )
}
