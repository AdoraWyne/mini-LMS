"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiClientError } from "@/lib/client/api-client";

/** Session expired or cookie gone: our API answers 401 (decision 14), so send the user to log in. */
function redirectToLoginOn401(error: unknown) {
  if (error instanceof ApiClientError && error.status === 401) {
    window.location.assign("/auth/login");
  }
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: redirectToLoginOn401 }),
    mutationCache: new MutationCache({ onError: redirectToLoginOn401 }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retrying a 4xx can't help (the request itself is wrong, or not allowed); retry other failures twice.
        retry: (failureCount, error) =>
          !(error instanceof ApiClientError && error.status < 500) && failureCount < 2,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // useState: one QueryClient per browser tab, created once (not on every render),
  // and never shared between users on the server.
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
