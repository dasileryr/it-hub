import { useEffect, useState } from 'react'
import { getPushConfig, removePushSubscription, savePushSubscription } from '../lib/api'

function urlBase64ToBytes(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export default function PushNotificationsButton() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'off' | 'on' | 'busy'>('loading')
  const [publicKey, setPublicKey] = useState<string | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported')
      return
    }
    getPushConfig().then(async (config) => {
      if (!config.enabled || !config.publicKey) return setState('unsupported')
      setPublicKey(config.publicKey)
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      setState((await registration.pushManager.getSubscription()) ? 'on' : 'off')
    }).catch(() => setState('unsupported'))
  }, [])

  async function toggle() {
    if (!publicKey || state === 'busy') return
    setState('busy')
    try {
      const registration = await navigator.serviceWorker.ready
      const current = await registration.pushManager.getSubscription()
      if (current) {
        await removePushSubscription(current.endpoint)
        await current.unsubscribe()
        setState('off')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('Разрешение на уведомления не предоставлено.')
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      })
      await savePushSubscription(subscription.toJSON())
      setState('on')
    } catch (error) {
      setState('off')
      alert(`${(error as Error).message}\n\nНа iPhone уведомления доступны после добавления приложения на экран «Домой».`)
    }
  }

  if (state === 'loading' || state === 'unsupported') return null
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={state === 'busy'}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${state === 'on' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
      title={state === 'on' ? 'Отключить push-уведомления' : 'Включить push-уведомления'}
    >
      {state === 'busy' ? 'Подключаем…' : state === 'on' ? 'Уведомления ✓' : 'Включить уведомления'}
    </button>
  )
}
