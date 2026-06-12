import { InventoryTypes, StockLocationDTO } from "@medusajs/types"

export interface InventoryItemLocationLevel
  extends InventoryTypes.InventoryLevelDTO {
  stock_locations: StockLocationDTO[]
  reserved_quantity: number
  stocked_quantity: number
  available_quantity: number
  // NOTE: Medusa's own `AdminInventoryLevel` declares these as `Date`, and
  // `EditReservationForm` consumes this type where an `AdminInventoryLevel[]`
  // is required — so they MUST stay `Date` here to keep the assignment typed
  // (removing them regresses the build). Over the HTTP boundary the values
  // actually arrive as ISO strings; reconciling that real string-vs-Date drift
  // belongs upstream in @medusajs/types and is deferred (architectural).
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface InventoryItemWithLevels {
  inventory_item_id: string
  location_levels: InventoryItemLocationLevel[]
}

export interface UseMultipleInventoryItemLevelsReturn {
  inventoryItemsWithLevels: InventoryItemWithLevels[]
  allLocationLevels: InventoryItemLocationLevel[]
  isPending: boolean
  isRefetching: boolean
  isError: boolean
  error: unknown
  refetch: () => Promise<void>
}
