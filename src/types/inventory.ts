import { InventoryTypes, StockLocationDTO } from "@medusajs/types"

export interface InventoryItemLocationLevel
  extends InventoryTypes.InventoryLevelDTO {
  stock_locations: StockLocationDTO[]
  reserved_quantity: number
  stocked_quantity: number
  available_quantity: number
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
