import { QueryClient, QueryClientProvider, keepPreviousData } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, placeholderData: keepPreviousData, refetchOnWindowFocus: true, retry: 1 },
    mutations: { retry: 0 },
  },
});

export default function ShellEntry() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
