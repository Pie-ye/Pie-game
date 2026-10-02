/** 官方遊戲掛載介面：mount(root, sdk)。牌面由各遊戲自己 import cards.js。 */
export function createOfficialSdk({
  api,
  getBalance,
  isPlayMoney = () => false,
  setBalance,
  toast,
  refreshHistory,
  roundId,
  user,
}) {
  return {
    api,
    getBalance,
    isPlayMoney,
    setBalance,
    toast,
    refreshHistory,
    roundId,
    user,
  };
}
