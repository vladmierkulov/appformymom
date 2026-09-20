// Ignore snapshots taken before a local change or while a form is being edited.
// Scheduling stays in the UI; this gate also coalesces focus/online/timer events.
export function createBackgroundRefresh({ canRefresh, revision, fetchSnapshot, applySnapshot, onError }) {
  let running = false;
  return async function refresh() {
    if (running || !canRefresh()) return;
    const startedAt = revision();
    const isCurrent = () => revision() === startedAt && canRefresh();
    running = true;
    try {
      const snapshot = await fetchSnapshot();
      if (isCurrent()) applySnapshot(snapshot);
    } catch (error) {
      if (isCurrent()) onError(error);
    } finally {
      running = false;
    }
  };
}
