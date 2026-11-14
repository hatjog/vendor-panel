// @vitest-environment jsdom
/**
 * v1.16.0 Story 5.4 AC1 (AD-34) — po realizacji vouchera usługowego panel
 * pokazuje STAN TERMINALNY odczytany z serwera ponownym lookupem.
 *
 * Mierzone wykonaniem: kolejność i nagłówki wywołań (`x-seller-id` przez
 * `sellerId` — aktor `member` + salon), oraz zdanie na ekranie po polsku.
 * Podmieniony jest WYŁĄCZNIE `voucherFetch` i `useMe` (jak w `voucher-redeem.spec.tsx`).
 */
import { TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../i18n/__tests__/test-i18n"

const fetchQuery = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/client/voucher-client", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/client/voucher-client")
  >("../../../lib/client/voucher-client")
  return { ...actual, voucherFetch: fetchQuery }
})
vi.mock("../../../hooks/api/users", () => ({
  useMe: () => ({ seller: { id: "sel_story54" } }),
}))

import { VoucherRedeem } from "../voucher-redeem"

const CODE = "GP-SERV-0054"

const view = (status: string) => ({
  code: CODE,
  seller_id: "sel_story54",
  seller_name: "Salon",
  seller_handle: "salon",
  product_title: "Zabieg na twarz",
  value_minor: 34000,
  currency_code: "PLN",
  status,
  market_id: "bonbeauty",
  expires_at: null,
})

const redeemOk = {
  ok: true,
  idempotent: false,
  outcome: "redeemed_now",
  status: "claimed",
  envelope: {
    audit_log_id: "aud_story54",
    vendor_id: "ven_story54",
    seller_id: "sel_story54",
    market_id: "bonbeauty",
    code: CODE,
    prior_status: "idle",
    new_status: "claimed",
    claimed_at: "2026-11-14T10:00:00.000Z",
  },
}

let i18n: Awaited<ReturnType<typeof createTestI18n>>
beforeAll(async () => {
  i18n = await createTestI18n("pl")
})
afterEach(cleanup)
beforeEach(() => fetchQuery.mockReset())

const renderScreen = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/vouchers/redeem"]}>
            <VoucherRedeem />
          </MemoryRouter>
        </I18nextProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

async function redeemFlow() {
  const user = userEvent.setup()
  renderScreen()
  await user.type(screen.getByLabelText("Kod vouchera"), CODE)
  await user.click(screen.getByRole("button", { name: "Sprawdź kod" }))
  await user.click(
    await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
  )
  return screen.findByTestId("voucher-redeem-confirmation")
}

describe("Story 5.4 AC1 — stan terminalny widoczny z panelu", () => {
  it("po realizacji panel ponownie czyta voucher i pokazuje stan zapisany na serwerze", async () => {
    fetchQuery
      .mockResolvedValueOnce({ voucher: view("idle") })
      .mockResolvedValueOnce(redeemOk)
      .mockResolvedValueOnce({ voucher: view("claimed") })

    const done = await redeemFlow()
    const terminal = await within(done).findByTestId(
      "voucher-confirmation-terminal-state",
    )
    expect(terminal.textContent).toBe("Stan vouchera: Zrealizowany")

    // Trzy wywołania: lookup → redeem → lookup potwierdzający, każde w zakresie salonu.
    expect(fetchQuery).toHaveBeenCalledTimes(3)
    const [lookupCall, redeemCall, rereadCall] = fetchQuery.mock.calls
    expect(lookupCall[0]).toBe(`/vendor/vouchers/${CODE}/lookup`)
    expect(redeemCall[0]).toBe(`/vendor/vouchers/${CODE}/redeem`)
    expect(redeemCall[1]).toMatchObject({ method: "POST", sellerId: "sel_story54" })
    expect(redeemCall[1].headers["Idempotency-Key"]).toEqual(expect.any(String))
    expect(rereadCall[0]).toBe(`/vendor/vouchers/${CODE}/lookup`)
    expect(rereadCall[1]).toMatchObject({ method: "GET", sellerId: "sel_story54" })
  })

  it("ekran mówi stan Z SERWERA, nie z odpowiedzi (kontrola: serwer zwraca inny stan)", async () => {
    fetchQuery
      .mockResolvedValueOnce({ voucher: view("idle") })
      .mockResolvedValueOnce(redeemOk)
      .mockResolvedValueOnce({ voucher: view("refunded") })

    const done = await redeemFlow()
    await vi.waitFor(() =>
      expect(
        within(done).getByTestId("voucher-confirmation-terminal-state").textContent,
      ).toBe("Stan vouchera: Zwrócony — pieniądze wróciły do klientki"),
    )
  })

  it("nieudany odczyt potwierdzający nie psuje potwierdzenia — stan z koperty zdarzenia", async () => {
    fetchQuery
      .mockResolvedValueOnce({ voucher: view("idle") })
      .mockResolvedValueOnce(redeemOk)
      .mockRejectedValueOnce(new Error("network"))

    const done = await redeemFlow()
    expect(
      within(done).getByTestId("voucher-confirmation-terminal-state").textContent,
    ).toBe("Stan vouchera: Zrealizowany")
    expect(done.textContent).toContain("Voucher oznaczony jako zrealizowany.")
  })
})
