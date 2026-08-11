import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"
import { fetchQuery, sdk } from "../../lib/client"
import {
  clearStoredSellerId,
  setStoredSellerId,
} from "../../lib/client/seller-context"

const vendorAuthActorType = "member"

/**
 * DW-15-170: po zalogowaniu panel MUSI poznac swoj salon.
 *
 * `ensureSellerMiddleware` odrzuca kazde zadanie `/vendor/*` bez kontekstu
 * salonu, a panel nie wolal niczego, co ten kontekst ustawia — zmierzone realna
 * przegladarka: `POST /auth/member/emailpass` -> 200, zaraz po nim
 * `GET /vendor/sellers/me` -> 400 i powrot na `/login`.
 *
 * `GET /vendor/sellers` filtruje czlonkostwa po `req.auth_context.actor_id`,
 * wiec zwraca WYLACZNIE salony zalogowanego czlonka. Rozstrzygniecie jest
 * zamierzenie GLOSNE: zero salonow i wiecej niz jeden konczą logowanie bledem
 * zamiast cichym wyborem pierwszego z brzegu — wybor salonu za uzytkownika
 * bylby wyborem TENANTA, a tego panel nie ma prawa robic domyslnie.
 */
const resolveSellerContext = async (): Promise<void> => {
  clearStoredSellerId()

  const response = (await fetchQuery("/vendor/sellers", {
    method: "GET",
    query: { fields: "seller_id" },
  })) as { seller_members?: Array<{ seller_id?: string }> } | undefined

  const sellerIds = Array.from(
    new Set(
      (response?.seller_members ?? [])
        .map((membership) => membership?.seller_id)
        .filter((sellerId): sellerId is string => Boolean(sellerId))
    )
  )

  if (sellerIds.length === 0) {
    throw new Error(
      "To konto nie nalezy do zadnego salonu — panel sprzedawcy nie ma kontekstu do pracy."
    )
  }

  if (sellerIds.length > 1) {
    throw new Error(
      "Konto nalezy do kilku salonow, a wybor salonu nie jest jeszcze obslugiwany (DW-15-170)."
    )
  }

  setStoredSellerId(sellerIds[0])
}

export const useSignInWithEmailPass = (
  options?: UseMutationOptions<
    | string
    | {
        location: string
      },
    FetchError,
    HttpTypes.AdminSignUpWithEmailPassword
  >
) => {
  return useMutation({
    mutationFn: async (payload) => {
      const result = await sdk.auth.login(
        vendorAuthActorType,
        "emailpass",
        payload
      )

      // Rozstrzygniecie salonu siedzi w `mutationFn`, a nie w `onSuccess`:
      // tylko stad jego bledy odrzucaja mutacje i trafiaja na formularz
      // logowania. W `onSuccess` wyjatek bylby polkniety, a uzytkownik
      // zobaczylby "zalogowano" i pusty panel.
      if (typeof result === "string") {
        await resolveSellerContext()
      }

      return result
    },
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useSignUpWithEmailPass = (
  options?: UseMutationOptions<
    string,
    FetchError,
    HttpTypes.AdminSignInWithEmailPassword & {
      confirmPassword: string
      name: string
    }
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.auth.register(vendorAuthActorType, "emailpass", payload),
    onSuccess: async (_, variables) => {
      const seller = {
        name: variables.name,
        member: {
          name: variables.name,
          email: variables.email,
        },
      }
      await fetchQuery("/vendor/sellers", {
        method: "POST",
        body: seller,
      })
    },
    ...options,
  })
}

export const useSignUpForInvite = (
  options?: UseMutationOptions<
    string,
    FetchError,
    HttpTypes.AdminSignInWithEmailPassword
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.auth.register(vendorAuthActorType, "emailpass", payload),
    ...options,
  })
}

export const useResetPasswordForEmailPass = (
  options?: UseMutationOptions<void, FetchError, { email: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.resetPassword(vendorAuthActorType, "emailpass", {
        identifier: payload.email,
      }),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useLogout = (options?: UseMutationOptions<void, FetchError>) => {
  return useMutation({
    mutationFn: async () => {
      // Kontekst salonu jest czescia sesji — zostawiony po wylogowaniu
      // wskazywalby salon poprzedniego uzytkownika na tej maszynie.
      clearStoredSellerId()
      await sdk.auth.logout()
    },
    ...options,
  })
}

export const useUpdateProviderForEmailPass = (
  token: string,
  options?: UseMutationOptions<void, FetchError, { password: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.updateProvider(vendorAuthActorType, "emailpass", payload, token),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}
