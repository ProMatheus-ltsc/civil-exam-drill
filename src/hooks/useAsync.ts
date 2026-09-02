import { useState } from "react";
import { useToast } from "@shared/core/hooks/useToast";

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "操作失败",
        "error",
        5000,
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
