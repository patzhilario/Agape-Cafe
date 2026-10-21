import { useContext } from 'react'
import { CartContext } from './CartContext.js'

export function useCart() {
  const value = useContext(CartContext)
  if (!value) throw new Error('useCart must be used within a CartProvider.')
  return value
}
