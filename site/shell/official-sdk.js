/** 官方遊戲掛載介面。P3 移植時依此呼叫 mount(root, sdk)。 */
export function createOfficialSdk({
  api,
  getBalance,
  setBalance,
  toast,
  refreshHistory,
  roundId,
  renderPcard,
  user,
}) {
  return {
    api,
    getBalance,
    setBalance,
    toast,
    refreshHistory,
    roundId,
    renderPcard,
    user,
  };
}
