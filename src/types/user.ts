import { HttpTypes } from "@medusajs/types"

export interface Review {
  id: string
  rating: number
  reference: "product" | "seller"
  customer_note: string | null
  customer_id: string
  seller_note: string | null
  created_at: string
  updated_at?: string | null
  customer?: HttpTypes.AdminCustomer
}

export interface StoreVendor {
  id?: string
  name?: string
  phone?: string
  email?: string
  description?: string
  handle?: string
  photo?: string
  created_at?: string
  product?: HttpTypes.StoreProduct[]
  review?: Review | Review[]
  address_line?: string
  postal_code?: string
  city?: string
  country_code?: string
  tax_id?: string
  // Mercur 2 SellerStatus values (lowercase). Mercur 1.5 used "ACTIVE"/"SUSPENDED"/"INACTIVE" (uppercase).
  // Narrowed to the two values actually consumed by vendor-panel today (shell.tsx checks
  // store_status === "suspended"). Review-fix VP-1 v160-cleanup-62a: dropped speculative
  // "closed" entry (no callsite, INACTIVE→closed mapping was unjustified per OQ#2).
  // Add new state explicitly with Mercur 2 SellerStatus key when a feature needs it.
  store_status?: "open" | "suspended"
}

export type VendorSeller = StoreVendor

export interface TeamMemberProps {
  id: string
  seller_id: string
  name: string
  email?: string
  photo?: string
  bio?: string
  phone?: string
  role: string
}
