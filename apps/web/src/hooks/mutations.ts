import { useMutation, useQueryClient } from "@tanstack/react-query";
import { placeBet, joinQueue } from "@/lib/api";

export function usePlaceBet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: placeBet,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bettingPool", variables.tableId] });
    },
  });
}

export function useJoinQueue() {
  return useMutation({ mutationFn: joinQueue });
}
