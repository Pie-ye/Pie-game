/** 官方遊戲掛載介面：mount(root, sdk)。牌面由各遊戲自己 import cards.js。 */
export function createOfficialSdk({
  api,
  getBalance,
  setBalance,
  toast,
  refreshHistory,
  roundId,
  user,
}) {
  return {
    api,
    getBalance,
    setBalance,
    toast,
    refreshHistory,
    roundId,
    user,
  };
}
