import { useCallback, useEffect, useState } from 'react'
import { CartContext } from './CartContext.js'
import { getCartItemKey } from './cartUtils.js'
import { getPublicBranches } from '../public/publicData.js'

const CART_STORAGE_KEY = 'agape-cart-v1'
const MAX_QUANTITY = 20

function readCart() {
  try {
    const storedCart = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!storedCart) return { items: [], branchId: '' }
    const stored = JSON.parse(storedCart)
    const saved = Array.isArray(stored) ? { items: stored, branchId: '' } : stored
    if (!saved || !Array.isArray(saved.items)) throw new Error('Saved cart is invalid.')
    return {
      items: saved.items.filter(
        (item) =>
          item &&
          typeof item.productId === 'string' &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0 &&
          item.quantity <= MAX_QUANTITY &&
          Array.isArray(item.addons),
      ),
      branchId: '',
    }
  } catch (error) {
    console.error('Unable to restore the saved cart.', error)
    try {
      window.localStorage.removeItem(CART_STORAGE_KEY)
    } catch (storageError) {
      console.error('Unable to clear invalid cart storage.', storageError)
    }
    return { items: [], branchId: '' }
  }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(readCart)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const openCart = useCallback(() => setIsCartOpen(true), [])
  const closeCart = useCallback(() => setIsCartOpen(false), [])

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) return undefined
    let active = true
    getPublicBranches()
      .then(([store]) => {
        if (active && store) setCart((current) => ({ ...current, branchId: store.id }))
      })
      .catch((error) => console.error('Unable to load the store location.', error))
    return () => { active = false }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart))
    } catch (error) {
      console.error('Unable to save the cart on this device.', error)
    }
  }, [cart])

  function addItem(item) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new Error(`Choose a quantity between 1 and ${MAX_QUANTITY}.`)
    }
    const incoming = {
      ...item,
      addons: [...(item.addons || [])].sort((first, second) =>
        first.id.localeCompare(second.id),
      ),
    }
    const incomingKey = getCartItemKey(incoming)
    const existing = cart.items.find((entry) => getCartItemKey(entry) === incomingKey)
    const quantity = (existing?.quantity || 0) + incoming.quantity
    if (quantity > MAX_QUANTITY) {
      throw new Error(`A cart item cannot exceed ${MAX_QUANTITY} units.`)
    }
    setCart({
      ...cart,
      items: existing
        ? cart.items.map((entry) =>
            getCartItemKey(entry) === incomingKey ? { ...entry, quantity } : entry,
          )
        : [...cart.items, incoming],
    })
    openCart()
  }

  function updateQuantity(itemKey, quantity) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error(`Choose a quantity between 1 and ${MAX_QUANTITY}.`)
    }
    setCart((current) => ({
      ...current,
      items: current.items.map((item) =>
        getCartItemKey(item) === itemKey ? { ...item, quantity } : item,
      ),
    }))
  }

  function removeItem(itemKey) {
    setCart((current) => ({
      ...current,
      items: current.items.filter((item) => getCartItemKey(item) !== itemKey),
    }))
  }

  function clearCart() {
    setCart((current) => ({ ...current, items: [] }))
  }

  const setBranchId = useCallback((branchId) => {
    setCart((current) => current.branchId === branchId ? current : { ...current, branchId })
  }, [])

  const totalQuantity = cart.items.reduce((total, item) => total + item.quantity, 0)
  const subtotal = cart.items.reduce((total, item) => {
    const unitPrice = item.variantId ? item.variantPrice : item.productPrice
    const addons = item.addons.reduce((sum, addon) => sum + addon.price, 0)
    return total + (unitPrice + addons) * item.quantity
  }, 0)
  const value = {
    items: cart.items,
    branchId: cart.branchId,
    isCartOpen,
    totalQuantity,
    subtotal,
    addItem,
    openCart,
    closeCart,
    updateQuantity,
    removeItem,
    clearCart,
    setBranchId,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
